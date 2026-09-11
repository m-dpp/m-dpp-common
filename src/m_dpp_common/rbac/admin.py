"""A parametrised `/admin/rbac` router + dashboard.

Everything here treats roles and entity types as **data**:

- roles come from the service's `roles` table (list / create / deactivate here);
- entity types are the keys of `resource_tables` — the service's attrs-bearing
  entities (e.g. ``{"products": Product, "organisations": Organisation}``);
- attributes live in the `rbac_attributes` registry per entity type, either
  *discovered* from stored ``attrs`` (``POST /sync-attrs``) or registered
  *manually* (``POST /attributes`` — for computed fields that are never stored).

Creating a role or registering an attribute fans out the missing permission rows
so the grid stays complete (see :mod:`m_dpp_common.rbac.seed`).
"""

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, field_validator
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from m_dpp_common.rbac.models import ATTR_ORIGIN_DISCOVERED, ATTR_ORIGIN_MANUAL
from m_dpp_common.rbac.seed import fan_out_attribute, fan_out_role

_TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

_ROLE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
_ATTR_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.\-]{0,127}$")


# ------------------------------------------------------------------ schemas

class RoleCreate(BaseModel):
    name: str
    label: str | None = None
    description: str = ""

    @field_validator("name")
    @classmethod
    def _slug(cls, v: str) -> str:
        v = v.strip()
        if not _ROLE_NAME_RE.fullmatch(v):
            raise ValueError("role name must be snake_case: lowercase letters, digits, '_' (2–64 chars)")
        return v


class RoleUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    active: bool | None = None


class AttributeCreate(BaseModel):
    entity_type: str
    attr_key: str
    description: str = ""

    @field_validator("attr_key")
    @classmethod
    def _key(cls, v: str) -> str:
        v = v.strip()
        if not _ATTR_KEY_RE.fullmatch(v):
            raise ValueError("attribute key has an unsupported character or is too long")
        return v


class AttrPermissionUpdate(BaseModel):
    can_read: bool | None = None
    can_write: bool | None = None


class OrganisationRoleCreate(BaseModel):
    organisation_id: uuid.UUID
    role_name: str


class ResourcePermissionUpdate(BaseModel):
    can_list: bool | None = None
    can_read: bool | None = None
    can_create: bool | None = None
    can_update: bool | None = None
    can_delete: bool | None = None


# ------------------------------------------------------------------ helpers

def _attr_keys_sql(table: str):
    """SQL selecting every distinct `attrs` key stored in one entity table."""
    if not table.isidentifier():
        raise ValueError(f"unsafe table name: {table!r}")
    return text(
        f"SELECT DISTINCT jsonb_object_keys(attrs) AS attr_key "
        f"FROM {table} WHERE jsonb_typeof(attrs) = 'object' ORDER BY attr_key"
    )


def _role_out(r) -> dict:
    return {
        "name": r.name,
        "label": r.label or r.name,
        "description": r.description,
        "active": r.active,
        "sort_order": r.sort_order,
    }


def _attribute_out(a) -> dict:
    return {
        "id": str(a.id),
        "entity_type": a.entity_type,
        "attr_key": a.attr_key,
        "origin": a.origin,
        "description": a.description,
    }


def _perm_out(p) -> dict:
    return {
        "id": str(p.id),
        "entity_type": p.entity_type,
        "attr_key": p.attr_key,
        "role_name": p.role_name,
        "can_read": p.can_read,
        "can_write": p.can_write,
    }


def _res_perm_out(p) -> dict:
    return {
        "id": str(p.id),
        "resource_type": p.resource_type,
        "role_name": p.role_name,
        "can_list": p.can_list,
        "can_read": p.can_read,
        "can_create": p.can_create,
        "can_update": p.can_update,
        "can_delete": p.can_delete,
    }


# ------------------------------------------------------------------ router

def make_rbac_router(
    *,
    get_db,
    role_model,
    attr_permission_model,
    attribute_model,
    organisation_role_model,
    resource_permission_model,
    resource_tables: dict[str, type],
    resource_types: list[str] | None = None,
    organisation_model=None,
    prefix: str = "/admin/rbac",
) -> APIRouter:
    """
    resource_tables: entity_type → ORM model whose ``attrs`` bag is scanned by sync;
                     its keys are the entity types attributes can be registered for.
    resource_types:  every resource type the resource gate knows (superset of the
                     entity types — e.g. entities without an attrs bag). A new role
                     is fanned out over these. Defaults to ``resource_tables`` keys.
    """
    Role = role_model
    AttrPermission = attr_permission_model
    RbacAttribute = attribute_model
    OrganisationRole = organisation_role_model
    ResourcePermission = resource_permission_model
    entity_types = sorted(resource_tables.keys())
    all_resource_types = sorted(set(resource_types or []) | set(entity_types))
    attr_keys_sql = {et: _attr_keys_sql(model.__tablename__) for et, model in resource_tables.items()}

    router = APIRouter(prefix=prefix, tags=["admin-rbac"])

    @router.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request):
        return _TEMPLATES.TemplateResponse(request, "rbac_dashboard.html")

    @router.get("/entity-types")
    async def list_entity_types():
        return entity_types

    # ---------------------------------------------------------------- roles

    @router.get("/roles")
    async def list_roles(db: AsyncSession = Depends(get_db)):
        result = await db.execute(select(Role).order_by(Role.sort_order, Role.name))
        return [_role_out(r) for r in result.scalars().all()]

    @router.post("/roles", status_code=201)
    async def create_role(body: RoleCreate, db: AsyncSession = Depends(get_db)):
        if (await db.execute(select(Role).where(Role.name == body.name))).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Role already exists")
        max_order = (await db.execute(select(Role.sort_order).order_by(Role.sort_order.desc()).limit(1))).scalar()
        role = Role(
            name=body.name,
            label=body.label,
            description=body.description,
            active=True,
            sort_order=(max_order or 0) + 1,
        )
        db.add(role)
        await db.flush()
        fanned = await fan_out_role(
            db,
            body.name,
            resource_permission_model=ResourcePermission,
            resource_types=all_resource_types,
            attr_permission_model=AttrPermission,
            attribute_model=RbacAttribute,
        )
        await db.commit()
        await db.refresh(role)
        return {**_role_out(role), "fanned_out": fanned}

    @router.patch("/roles/{name}")
    async def update_role(name: str, body: RoleUpdate, db: AsyncSession = Depends(get_db)):
        role = (await db.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
        if role is None:
            raise HTTPException(status_code=404, detail="Role not found")
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(role, field, value)
        await db.commit()
        await db.refresh(role)
        return _role_out(role)

    # ----------------------------------------------------------- attributes

    @router.get("/attributes")
    async def list_attributes(entity_type: str | None = None, db: AsyncSession = Depends(get_db)):
        q = select(RbacAttribute)
        if entity_type:
            q = q.where(RbacAttribute.entity_type == entity_type)
        result = await db.execute(q.order_by(RbacAttribute.entity_type, RbacAttribute.attr_key))
        return [_attribute_out(a) for a in result.scalars().all()]

    @router.post("/attributes", status_code=201)
    async def create_attribute(body: AttributeCreate, db: AsyncSession = Depends(get_db)):
        if body.entity_type not in entity_types:
            raise HTTPException(
                status_code=422,
                detail=f"unknown entity_type — expected one of {', '.join(entity_types)}",
            )
        exists = (
            await db.execute(
                select(RbacAttribute).where(
                    RbacAttribute.entity_type == body.entity_type,
                    RbacAttribute.attr_key == body.attr_key,
                )
            )
        ).scalar_one_or_none()
        if exists is not None:
            raise HTTPException(
                status_code=409, detail=f"Attribute already registered ({exists.origin})"
            )
        attr = RbacAttribute(
            entity_type=body.entity_type,
            attr_key=body.attr_key,
            origin=ATTR_ORIGIN_MANUAL,
            description=body.description,
        )
        db.add(attr)
        await db.flush()
        inserted = await fan_out_attribute(
            db, body.entity_type, body.attr_key,
            role_model=Role, attr_permission_model=AttrPermission,
        )
        await db.commit()
        await db.refresh(attr)
        return {**_attribute_out(attr), "permission_rows": inserted}

    @router.delete("/attributes/{attribute_id}", status_code=204)
    async def delete_attribute(attribute_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
        attr = (
            await db.execute(select(RbacAttribute).where(RbacAttribute.id == attribute_id))
        ).scalar_one_or_none()
        if attr is None:
            raise HTTPException(status_code=404, detail="Attribute not found")
        if attr.origin != ATTR_ORIGIN_MANUAL:
            raise HTTPException(
                status_code=409,
                detail="Only manually registered attributes can be removed; this one was discovered from stored data",
            )
        # attr_permissions rows follow via ON DELETE CASCADE
        await db.delete(attr)
        await db.commit()

    @router.post("/sync-attrs")
    async def sync_attrs(db: AsyncSession = Depends(get_db)):
        """Discover attribute keys from stored data, register the new ones, and fan
        out permission rows. Never deletes — manual registrations are untouched."""
        registered_pairs = {
            (et, ak)
            for et, ak in (
                await db.execute(select(RbacAttribute.entity_type, RbacAttribute.attr_key))
            ).all()
        }
        discovered = 0
        new_pairs: list[tuple[str, str]] = []
        for entity_type, sql in attr_keys_sql.items():
            keys = [k for (k,) in (await db.execute(sql)).all()]
            discovered += len(keys)
            for key in keys:
                if (entity_type, key) not in registered_pairs:
                    db.add(
                        RbacAttribute(
                            entity_type=entity_type, attr_key=key, origin=ATTR_ORIGIN_DISCOVERED
                        )
                    )
                    new_pairs.append((entity_type, key))
        if new_pairs:
            await db.flush()

        # fan out every registered attribute (new *and* old — a role may have been added)
        all_pairs = registered_pairs | set(new_pairs)
        inserted = 0
        for entity_type, key in sorted(all_pairs):
            inserted += await fan_out_attribute(
                db, entity_type, key, role_model=Role, attr_permission_model=AttrPermission
            )
        if new_pairs or inserted:
            await db.commit()
        return {"discovered": discovered, "registered": len(new_pairs), "inserted": inserted}

    # ------------------------------------------------- attribute permissions

    @router.get("/permissions")
    async def list_permissions(entity_type: str | None = None, db: AsyncSession = Depends(get_db)):
        q = select(AttrPermission)
        if entity_type:
            q = q.where(AttrPermission.entity_type == entity_type)
        result = await db.execute(
            q.order_by(AttrPermission.entity_type, AttrPermission.attr_key, AttrPermission.role_name)
        )
        return [_perm_out(p) for p in result.scalars().all()]

    @router.patch("/permissions/{permission_id}")
    async def update_permission(
        permission_id: uuid.UUID,
        body: AttrPermissionUpdate,
        db: AsyncSession = Depends(get_db),
    ):
        obj = (
            await db.execute(select(AttrPermission).where(AttrPermission.id == permission_id))
        ).scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Permission not found")
        if body.can_read is not None:
            obj.can_read = body.can_read
        if body.can_write is not None:
            obj.can_write = body.can_write
        await db.commit()
        await db.refresh(obj)
        return _perm_out(obj)

    # -------------------------------------------------- resource permissions

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
        return [_res_perm_out(p) for p in result.scalars().all()]

    @router.patch("/resource-permissions/{permission_id}")
    async def update_resource_permission(
        permission_id: uuid.UUID,
        body: ResourcePermissionUpdate,
        db: AsyncSession = Depends(get_db),
    ):
        obj = (
            await db.execute(
                select(ResourcePermission).where(ResourcePermission.id == permission_id)
            )
        ).scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Resource permission not found")
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(obj, field, value)
        await db.commit()
        await db.refresh(obj)
        return _res_perm_out(obj)

    # ------------------------------------------------- organisation roles

    @router.get("/organisation-roles")
    async def list_organisation_roles(db: AsyncSession = Depends(get_db)):
        result = await db.execute(
            select(OrganisationRole).order_by(
                OrganisationRole.organisation_id, OrganisationRole.role_name
            )
        )
        assignments = result.scalars().all()

        info_by_id: dict[uuid.UUID, tuple[str, str | None]] = {}
        if organisation_model is not None and assignments:
            org_ids = list({a.organisation_id for a in assignments})
            orgs_result = await db.execute(
                select(organisation_model).where(organisation_model.id.in_(org_ids))
            )
            info_by_id = {
                org.id: (org.name, (org.attrs or {}).get("gln"))
                for org in orgs_result.scalars().all()
            }

        return [
            {
                "id": str(a.id),
                "organisation_id": str(a.organisation_id),
                "organisation_name": info_by_id.get(a.organisation_id, (None, None))[0],
                "organisation_gln": info_by_id.get(a.organisation_id, (None, None))[1],
                "role_name": a.role_name,
            }
            for a in assignments
        ]

    @router.post("/organisation-roles", status_code=201)
    async def create_organisation_role(
        body: OrganisationRoleCreate, db: AsyncSession = Depends(get_db)
    ):
        role = (await db.execute(select(Role).where(Role.name == body.role_name))).scalar_one_or_none()
        if role is None or not role.active:
            raise HTTPException(status_code=422, detail="Unknown or inactive role")
        obj = OrganisationRole(organisation_id=body.organisation_id, role_name=body.role_name)
        db.add(obj)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=409,
                detail="This organisation already has that role, or it does not exist",
            )
        await db.refresh(obj)
        return {
            "id": str(obj.id),
            "organisation_id": str(obj.organisation_id),
            "role_name": obj.role_name,
        }

    @router.delete("/organisation-roles/{assignment_id}", status_code=204)
    async def delete_organisation_role(
        assignment_id: uuid.UUID, db: AsyncSession = Depends(get_db)
    ):
        obj = (
            await db.execute(select(OrganisationRole).where(OrganisationRole.id == assignment_id))
        ).scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Assignment not found")
        await db.delete(obj)
        await db.commit()

    return router
