"""The two-layer RBAC engine.

- **Resource-level gate** — per (role, resource_type, operation). `check_resource_permission`.
  It is also where the role itself is validated: an unknown or inactive role is 403.
- **Attribute-level filter** — per (role, entity_type, attr_key).
  `filter_readable_attrs` strips unreadable keys from a response. On the write side
  `assert_writable_attrs` *rejects* (403) a payload naming a key the role may not write —
  removing a key is a write too, so a PATCH must merge onto the stored bag and run this
  check on the keys it names (see `m_dpp_common.orm.apply_attrs_patch`). The older
  `filter_writable_attrs` silently drops denied keys and is kept only for callers that
  knowingly want that. **Resolve inheritance first, then filter the resolved result** —
  a rule follows an attribute through inheritance.

The engine is entity-agnostic: `entity_type` and `resource_type` are opaque strings
the service chooses (e.g. `"products"`), and roles are whatever rows the service's
`roles` table holds. No wildcards — every rule is specific to one entity type and key.

**Several roles, union semantics.** A principal carries ``roles`` (the roles of the
organisation it represents). An action is allowed if *any* held role allows it; a
key is readable/writable if *any* held role may read/write it. Every call point
accepts either one role name or a list — pass ``principal["roles"]`` (or the
principal itself to the resource gate). The singular ``principal["role"]`` is kept
for compatibility and means "that one role".

The *mechanism* is shared; the *policy* (which rows exist) is seeded per service.
Dev posture: absence of a matching permission row = allow. Production should seed
default-deny.
"""

from collections.abc import Sequence

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

Roles = str | Sequence[str]


def principal_roles(principal: dict) -> list[str]:
    """The role names a principal holds: ``roles`` if present, else ``[role]``."""
    roles = principal.get("roles")
    if roles:
        return list(roles)
    role = principal.get("role")
    return [role] if role else []


def as_roles(roles: Roles) -> list[str]:
    """Normalise a role name or a sequence of names to a list."""
    if isinstance(roles, str):
        return [roles]
    return list(roles)


def _role_pred(column, roles: list[str]):
    # one role → `=` (keeps SQL, and the mocks in consuming test suites, unchanged)
    return column == roles[0] if len(roles) == 1 else column.in_(roles)


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

    async def active_roles(self, roles: Roles, db: AsyncSession) -> list[str]:
        """The subset of `roles` that are stored and active. 403 when none is —
        a principal must hold at least one usable role."""
        names = as_roles(roles)
        if self._Role is None:
            return names
        active = []
        for name in names:
            row = (await db.execute(select(self._Role).where(self._Role.name == name))).scalar_one_or_none()
            if row is not None and row.active:
                active.append(name)
        if not active:
            raise HTTPException(
                status_code=403,
                detail=f"Role(s) {', '.join(names) or '(none)'} unknown or inactive",
            )
        return active

    # --------------------------------------------------------- resource gate

    async def check_resource_permission(
        self, principal: dict, action: str, resource_type: str, db: AsyncSession
    ) -> None:
        """Raise 403 if the principal's role cannot perform `action` on `resource_type`.

        action: 'list' | 'read' | 'create' | 'update' | 'delete'.
        At least one held role must exist and be active. Union over the roles;
        a role with no matching row is allowed (dev posture).
        """
        roles = await self.active_roles(principal_roles(principal), db)
        Res = self._Res
        result = await db.execute(
            select(Res).where(_role_pred(Res.role_name, roles), Res.resource_type == resource_type)
        )
        rows = result.scalars().all()
        col = f"can_{action}"
        if len(roles) == 1:
            allowed = not rows or any(getattr(row, col) for row in rows)
        else:
            by_role: dict[str, list] = {}
            for row in rows:
                by_role.setdefault(row.role_name, []).append(row)
            allowed = any(
                role not in by_role or any(getattr(r, col) for r in by_role[role])
                for role in roles
            )
        if not allowed:
            # Blaming the role is misleading whenever the role is only a
            # fallback. "Role(s) public not permitted" reads as a permissions
            # problem to someone who plainly holds the role — the actual fix is
            # usually to choose an organisation, to link the subject in this
            # app, or to give the organisation a role HERE as well as in the
            # other one. The principal already knows why it fell back; say so.
            #
            # Keyed on `reason`, not on `anonymous`: the most confusing case of
            # all — a known subject, a known organisation, but that organisation
            # holds no role in THIS service — is not anonymous at all.
            detail = f"Role(s) {', '.join(roles)} not permitted to {action} {resource_type}"
            if principal.get("reason"):
                detail += f" — {principal['reason']}"
                org = (principal.get("organisation") or {}).get("name")
                if org:
                    detail += f" (acting for {org})"
                if principal.get("anonymous") and principal.get("organisations"):
                    names = ", ".join(o.get("name", "?") for o in principal["organisations"])
                    detail += f" (you may act for: {names})"
            raise HTTPException(status_code=403, detail=detail)

    # ------------------------------------------------------ attribute filter

    async def _denied_keys_one(
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
        return set(result.scalars().all())

    async def _denied_keys(
        self, attrs: dict, roles: Roles, db: AsyncSession, *, entity_type: str, column: str
    ) -> set[str]:
        """Keys denied for *every* held role (union of permissions = intersection of denials)."""
        names = as_roles(roles)
        if not names:
            return set()
        denied: set[str] | None = None
        for name in names:
            d = await self._denied_keys_one(attrs, name, db, entity_type=entity_type, column=column)
            denied = d if denied is None else denied & d
            if not denied:
                break
        return denied or set()

    async def filter_readable_attrs(
        self, attrs: dict | None, role_name: Roles, db: AsyncSession, *, entity_type: str
    ) -> dict | None:
        """Strip keys none of the role(s) may read on `entity_type`. Call on *resolved* attrs."""
        if not attrs:
            return attrs
        denied = await self._denied_keys(
            attrs, role_name, db, entity_type=entity_type, column="can_read"
        )
        return {k: v for k, v in attrs.items() if k not in denied}

    async def filter_writable_attrs(
        self, attrs: dict | None, role_name: Roles, db: AsyncSession, *, entity_type: str
    ) -> dict | None:
        """Strip keys the role may not write on `entity_type` before persisting.

        Prefer :meth:`assert_writable_attrs` in request handlers: silently dropping a
        key returns 2xx for a write that did not happen, and a caller cannot tell.
        """
        if not attrs:
            return attrs
        denied = await self._denied_keys(
            attrs, role_name, db, entity_type=entity_type, column="can_write"
        )
        return {k: v for k, v in attrs.items() if k not in denied}

    async def assert_writable_attrs(
        self, attrs: dict | None, role_name: Roles, db: AsyncSession, *, entity_type: str
    ) -> None:
        """403 if `attrs` names a key none of the role(s) may write on `entity_type`.

        Pass the keys the request *touches* — setting a value and removing one (a
        `null` in a PATCH) are both writes. Keys the request does not name are not
        checked, so a PATCH that merges onto the stored bag leaves protected keys
        intact rather than wiping them.
        """
        if not attrs:
            return
        denied = await self._denied_keys(
            attrs, role_name, db, entity_type=entity_type, column="can_write"
        )
        if denied:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Role(s) {', '.join(as_roles(role_name))} not permitted to write "
                    f"{', '.join(sorted(denied))} on {entity_type}"
                ),
            )

    # ------------------------------------------------------------- binding

    def for_entity(self, entity_type: str) -> "BoundRbac":
        """The call points with `entity_type` bound — what a service exports::

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
        self, attrs: dict | None, role_name: Roles, db: AsyncSession
    ) -> dict | None:
        return await self.engine.filter_readable_attrs(
            attrs, role_name, db, entity_type=self.entity_type
        )

    async def filter_writable_attrs(
        self, attrs: dict | None, role_name: Roles, db: AsyncSession
    ) -> dict | None:
        return await self.engine.filter_writable_attrs(
            attrs, role_name, db, entity_type=self.entity_type
        )

    async def assert_writable_attrs(
        self, attrs: dict | None, role_name: Roles, db: AsyncSession
    ) -> None:
        await self.engine.assert_writable_attrs(
            attrs, role_name, db, entity_type=self.entity_type
        )
