"""The two-layer RBAC engine: a resource-level gate and an attribute-level filter.

The *mechanism* is shared; the *policy* (which rows exist) is seeded per service.
Dev posture: absence of a matching row = allow. Production should seed default-deny.
"""

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession


class RbacEngine:
    def __init__(self, *, attr_permission_model, resource_permission_model):
        self._Attr = attr_permission_model
        self._Res = resource_permission_model

    async def _denied_keys(
        self, attrs: dict, role_name: str, resource_type: str, db: AsyncSession, *, column: str
    ) -> set[str] | None:
        """Return the set of denied keys, or None meaning 'deny everything' (a '*' row)."""
        Attr = self._Attr
        keys = list(attrs.keys())
        result = await db.execute(
            select(Attr).where(
                Attr.role_name == role_name,
                or_(Attr.resource_type == resource_type, Attr.resource_type == "*"),
                or_(Attr.attr_key.in_(keys), Attr.attr_key == "*"),
                getattr(Attr, column) == False,  # noqa: E712
            )
        )
        denied: set[str] = set()
        for row in result.scalars().all():
            if row.attr_key == "*":
                return None
            denied.add(row.attr_key)
        return denied

    async def filter_readable_attrs(
        self, attrs: dict | None, role_name: str, resource_type: str, db: AsyncSession
    ) -> dict | None:
        if not attrs:
            return attrs
        denied = await self._denied_keys(attrs, role_name, resource_type, db, column="can_read")
        if denied is None:
            return {}
        return {k: v for k, v in attrs.items() if k not in denied}

    async def filter_writable_attrs(
        self, attrs: dict | None, role_name: str, resource_type: str, db: AsyncSession
    ) -> dict | None:
        if not attrs:
            return attrs
        denied = await self._denied_keys(attrs, role_name, resource_type, db, column="can_write")
        if denied is None:
            return {}
        return {k: v for k, v in attrs.items() if k not in denied}

    async def check_resource_permission(
        self, principal: dict, action: str, resource_type: str, db: AsyncSession
    ) -> None:
        """Raise 403 if the principal's role cannot perform `action` on `resource_type`.

        action: 'list' | 'read' | 'create' | 'update' | 'delete'.
        No matching row → allowed (default-open before seeding / in dev).
        """
        Res = self._Res
        role_name = principal["role"]
        result = await db.execute(
            select(Res).where(
                Res.role_name == role_name,
                or_(Res.resource_type == resource_type, Res.resource_type == "*"),
            )
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
