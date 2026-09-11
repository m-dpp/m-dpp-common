"""The two-layer RBAC engine.

- **Resource-level gate** — per (role, resource_type, operation). `check_resource_permission`.
  It is also where the role itself is validated: an unknown or inactive role is 403.
- **Attribute-level filter** — per (role, entity_type, attr_key).
  `filter_readable_attrs` / `filter_writable_attrs`. **Resolve inheritance first, then
  filter the resolved result** — a rule follows an attribute through inheritance.

The engine is entity-agnostic: `entity_type` and `resource_type` are opaque strings
the service chooses (e.g. `"products"`), and roles are whatever rows the service's
`roles` table holds. No wildcards — every rule is specific to one entity type and key.

The *mechanism* is shared; the *policy* (which rows exist) is seeded per service.
Dev posture: absence of a matching permission row = allow. Production should seed
default-deny.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class RbacEngine:
    def __init__(self, *, attr_permission_model, resource_permission_model, role_model=None):
        self._Attr = attr_permission_model
        self._Res = resource_permission_model
        self._Role = role_model  # optional: when given, roles are validated against it

    # ------------------------------------------------------------------ roles

    async def assert_active_role(self, role_name: str, db: AsyncSession) -> None:
        """403 unless `role_name` is a stored, active role (no-op without a role model)."""
        if self._Role is None:
            return
        result = await db.execute(select(self._Role).where(self._Role.name == role_name))
        role = result.scalar_one_or_none()
        if role is None or not role.active:
            raise HTTPException(
                status_code=403, detail=f"Role '{role_name}' is unknown or inactive"
            )

    # --------------------------------------------------------- resource gate

    async def check_resource_permission(
        self, principal: dict, action: str, resource_type: str, db: AsyncSession
    ) -> None:
        """Raise 403 if the principal's role cannot perform `action` on `resource_type`.

        action: 'list' | 'read' | 'create' | 'update' | 'delete'.
        The role must exist and be active. No matching row → allowed (dev posture).
        """
        role_name = principal["role"]
        await self.assert_active_role(role_name, db)
        Res = self._Res
        result = await db.execute(
            select(Res).where(Res.role_name == role_name, Res.resource_type == resource_type)
        )
        rows = result.scalars().all()
        if not rows:
            return
        col = f"can_{action}"
        if not any(getattr(row, col) for row in rows):
            raise HTTPException(
                status_code=403,
                detail=f"Role '{role_name}' is not permitted to {action} {resource_type}",
            )

    # ------------------------------------------------------ attribute filter

    async def _denied_keys(
        self, attrs: dict, role_name: str, db: AsyncSession, *, entity_type: str, column: str
    ) -> set[str]:
        Attr = self._Attr
        result = await db.execute(
            select(Attr.attr_key).where(
                Attr.entity_type == entity_type,
                Attr.role_name == role_name,
                Attr.attr_key.in_(list(attrs.keys())),
                getattr(Attr, column) == False,  # noqa: E712
            )
        )
        return {row[0] if isinstance(row, tuple) else row for row in result.all()}

    async def filter_readable_attrs(
        self, attrs: dict | None, role_name: str, db: AsyncSession, *, entity_type: str
    ) -> dict | None:
        """Strip keys the role may not read on `entity_type`. Call on *resolved* attrs."""
        if not attrs:
            return attrs
        denied = await self._denied_keys(
            attrs, role_name, db, entity_type=entity_type, column="can_read"
        )
        return {k: v for k, v in attrs.items() if k not in denied}

    async def filter_writable_attrs(
        self, attrs: dict | None, role_name: str, db: AsyncSession, *, entity_type: str
    ) -> dict | None:
        """Strip keys the role may not write on `entity_type` before persisting."""
        if not attrs:
            return attrs
        denied = await self._denied_keys(
            attrs, role_name, db, entity_type=entity_type, column="can_write"
        )
        return {k: v for k, v in attrs.items() if k not in denied}

    # ------------------------------------------------------------- binding

    def for_entity(self, entity_type: str) -> "BoundRbac":
        """The three call points with `entity_type` bound — what a service exports::

            _bound = engine.for_entity("products")
            filter_readable_attrs = _bound.filter_readable_attrs   # (attrs, role, db)
        """
        return BoundRbac(self, entity_type)


class BoundRbac:
    """`RbacEngine` with one `entity_type` fixed for the attribute filters.
    `check_resource_permission` passes through unchanged (it already takes the type)."""

    def __init__(self, engine: RbacEngine, entity_type: str):
        self.engine = engine
        self.entity_type = entity_type

    async def check_resource_permission(
        self, principal: dict, action: str, resource_type: str, db: AsyncSession
    ) -> None:
        await self.engine.check_resource_permission(principal, action, resource_type, db)

    async def filter_readable_attrs(
        self, attrs: dict | None, role_name: str, db: AsyncSession
    ) -> dict | None:
        return await self.engine.filter_readable_attrs(
            attrs, role_name, db, entity_type=self.entity_type
        )

    async def filter_writable_attrs(
        self, attrs: dict | None, role_name: str, db: AsyncSession
    ) -> dict | None:
        return await self.engine.filter_writable_attrs(
            attrs, role_name, db, entity_type=self.entity_type
        )
