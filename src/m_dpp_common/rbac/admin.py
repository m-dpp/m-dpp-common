"""A parametrised `/admin/rbac` router + dashboard.

`dpp-app` and `mdpp-app` differ only in which resource tables carry an `attrs`
bag and whether an Operator entity exists, so those are constructor arguments.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

_TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

_DEFAULT_PERMISSIONS: dict[str, dict] = {
    "public": {"can_read": True, "can_write": False},
    "end_user_professional": {"can_read": True, "can_write": False},
    "recycler": {"can_read": True, "can_write": False},    
    "supply_chain_professional": {"can_read": True, "can_write": True},
    "economic_operator": {"can_read": True, "can_write": True},
    "laboratory": {"can_read": True, "can_write": True},
    "end_user_professional": {"can_read": True, "can_write": False},
    
    
    "authority": {"can_read": True, "can_write": False},
}


class AttrPermissionUpdate(BaseModel):
    can_read: bool | None = None
    can_write: bool | None = None


class OperatorRoleCreate(BaseModel):
    operator_gln: str
    role_name: str


class ResourcePermissionUpdate(BaseModel):
    can_list: bool | None = None
    can_read: bool | None = None
    can_create: bool | None = None
    can_update: bool | None = None
    can_delete: bool | None = None


def _attr_keys_sql(resource_tables: dict[str, type]):
    """SQL selecting every distinct `attrs` key across the given entity tables.

    Attribute ACLs are flat (keyed by name only), so the resource type each key came
    from doesn't matter here — only the set of names in use.
    """
    parts = []
    for model in resource_tables.values():
        table = model.__tablename__
        if not table.isidentifier():
            raise ValueError(f"unsafe table name: {table!r}")
        parts.append(
            f"SELECT DISTINCT jsonb_object_keys(attrs) AS attr_key "
            f"FROM {table} WHERE jsonb_typeof(attrs) = 'object'"
        )
    return text("\nUNION\n".join(parts) + "\nORDER BY attr_key")


def make_rbac_router(
    *,
    get_db,
    role_model,
    attr_permission_model,
    operator_role_model,
    resource_permission_model,
    resource_tables: dict[str, type],
    operator_model=None,
    prefix: str = "/admin/rbac",
) -> APIRouter:
    Role = role_model
    AttrPermission = attr_permission_model
    OperatorRole = operator_role_model
    ResourcePermission = resource_permission_model
    attr_keys_sql = _attr_keys_sql(resource_tables)

    router = APIRouter(prefix=prefix, tags=["admin-rbac"])

    @router.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request):
        return _TEMPLATES.TemplateResponse(request, "rbac_dashboard.html")

    @router.get("/roles")
    async def list_roles(db: AsyncSession = Depends(get_db)):
        result = await db.execute(select(Role).order_by(Role.name))
        return [{"name": r.name, "description": r.description} for r in result.scalars().all()]

    @router.get("/permissions")
    async def list_permissions(db: AsyncSession = Depends(get_db)):
        result = await db.execute(
            select(AttrPermission).order_by(AttrPermission.attr_key, AttrPermission.role_name)
        )
        return [
            {
                "id": str(p.id),
                "attr_key": p.attr_key,
                "role_name": p.role_name,
                "can_read": p.can_read,
                "can_write": p.can_write,
            }
            for p in result.scalars().all()
        ]

    @router.patch("/permissions/{permission_id}")
    async def update_permission(
        permission_id: uuid.UUID,
        body: AttrPermissionUpdate,
        db: AsyncSession = Depends(get_db),
    ):
        result = await db.execute(select(AttrPermission).where(AttrPermission.id == permission_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Permission not found")
        if body.can_read is not None:
            obj.can_read = body.can_read
        if body.can_write is not None:
            obj.can_write = body.can_write
        await db.commit()
        await db.refresh(obj)
        return {
            "id": str(obj.id),
            "attr_key": obj.attr_key,
            "role_name": obj.role_name,
            "can_read": obj.can_read,
            "can_write": obj.can_write,
        }

    @router.post("/sync-attrs")
    async def sync_attrs(db: AsyncSession = Depends(get_db)):
        discovered = [k for (k,) in (await db.execute(attr_keys_sql)).all()]

        roles_result = await db.execute(select(Role.name))
        role_names = [r for (r,) in roles_result.all()]

        existing_result = await db.execute(
            select(AttrPermission.attr_key, AttrPermission.role_name)
        )
        existing = {(ak, rn) for ak, rn in existing_result.all()}

        inserted = 0
        for attr_key in discovered:
            for role_name in role_names:
                if (attr_key, role_name) not in existing:
                    defaults = _DEFAULT_PERMISSIONS.get(
                        role_name, {"can_read": True, "can_write": False}
                    )
                    db.add(
                        AttrPermission(
                            attr_key=attr_key,
                            role_name=role_name,
                            can_read=defaults["can_read"],
                            can_write=defaults["can_write"],
                        )
                    )
                    inserted += 1

        if inserted > 0:
            await db.commit()

        return {"inserted": inserted, "discovered": len(discovered)}

    @router.get("/resource-permissions")
    async def list_resource_permissions(
        resource_type: str | None = None, db: AsyncSession = Depends(get_db)
    ):
        q = select(ResourcePermission)
        if resource_type:
            q = q.where(ResourcePermission.resource_type == resource_type)
        result = await db.execute(
            q.order_by(ResourcePermission.resource_type, ResourcePermission.role_name)
        )
        return [
            {
                "id": str(p.id),
                "resource_type": p.resource_type,
                "role_name": p.role_name,
                "can_list": p.can_list,
                "can_read": p.can_read,
                "can_create": p.can_create,
                "can_update": p.can_update,
                "can_delete": p.can_delete,
            }
            for p in result.scalars().all()
        ]

    @router.patch("/resource-permissions/{permission_id}")
    async def update_resource_permission(
        permission_id: uuid.UUID,
        body: ResourcePermissionUpdate,
        db: AsyncSession = Depends(get_db),
    ):
        result = await db.execute(
            select(ResourcePermission).where(ResourcePermission.id == permission_id)
        )
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Resource permission not found")
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(obj, field, value)
        await db.commit()
        await db.refresh(obj)
        return {
            "id": str(obj.id),
            "resource_type": obj.resource_type,
            "role_name": obj.role_name,
            "can_list": obj.can_list,
            "can_read": obj.can_read,
            "can_create": obj.can_create,
            "can_update": obj.can_update,
            "can_delete": obj.can_delete,
        }

    @router.get("/operator-roles")
    async def list_operator_roles(db: AsyncSession = Depends(get_db)):
        result = await db.execute(
            select(OperatorRole).order_by(OperatorRole.operator_gln, OperatorRole.role_name)
        )
        assignments = result.scalars().all()

        name_by_gln: dict[str, str] = {}
        if operator_model is not None and assignments:
            glns = list({a.operator_gln for a in assignments})
            ops_result = await db.execute(
                select(operator_model).where(operator_model.gln.in_(glns))
            )
            name_by_gln = {op.gln: op.name for op in ops_result.scalars().all()}

        return [
            {
                "id": str(a.id),
                "operator_gln": a.operator_gln,
                "operator_name": name_by_gln.get(a.operator_gln),
                "role_name": a.role_name,
            }
            for a in assignments
        ]

    @router.post("/operator-roles", status_code=201)
    async def create_operator_role(
        body: OperatorRoleCreate, db: AsyncSession = Depends(get_db)
    ):
        obj = OperatorRole(operator_gln=body.operator_gln, role_name=body.role_name)
        db.add(obj)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="This operator already has that role")
        await db.refresh(obj)
        return {"id": str(obj.id), "operator_gln": obj.operator_gln, "role_name": obj.role_name}

    @router.delete("/operator-roles/{assignment_id}", status_code=204)
    async def delete_operator_role(
        assignment_id: uuid.UUID, db: AsyncSession = Depends(get_db)
    ):
        result = await db.execute(select(OperatorRole).where(OperatorRole.id == assignment_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Assignment not found")
        await db.delete(obj)
        await db.commit()

    return router
