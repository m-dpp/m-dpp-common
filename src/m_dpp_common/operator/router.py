"""A parametrised ``/operators`` CRUD router.

``dpp-app`` and ``mdpp-app`` mount the *same* endpoints against their *own*
``operators`` table and ``@context`` document, so those are constructor
arguments. The RBAC checks route through the service's :class:`RbacEngine`
instance; auth defaults to the shared dev stub.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from m_dpp_common.auth import get_principal as _default_get_principal
from m_dpp_common.operator.schemas import OperatorCreate, OperatorUpdate


def make_operator_router(
    *,
    get_db,
    operator_model,
    rbac_engine,
    context_url: str,
    get_principal=_default_get_principal,
    resource_name: str = "operators",
    prefix: str = "/operators",
) -> APIRouter:
    Operator = operator_model
    _RESOURCE = resource_name

    router = APIRouter(prefix=prefix, tags=[resource_name])

    def _to_jsonld(op, attrs=None) -> dict:
        return {
            "@context": context_url,
            "@id": f"https://id.gs1.org/417/{op.gln}",
            "@type": "schema:Organization",
            "id": str(op.id),
            "gln": op.gln,
            "name": op.name,
            "attrs": attrs if attrs is not None else op.attrs,
            "created_at": op.created_at.isoformat(),
            "updated_at": op.updated_at.isoformat(),
            "removed_at": op.removed_at.isoformat() if op.removed_at else None,
        }

    @router.post("", status_code=201)
    async def create_operator(
        body: OperatorCreate,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "create", _RESOURCE, db)
        data = body.model_dump()
        if data.get("attrs"):
            data["attrs"] = await rbac_engine.filter_writable_attrs(
                data["attrs"], principal["role"], db
            )
        obj = Operator(**data)
        db.add(obj)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Operator with this GLN already exists")
        await db.refresh(obj)
        readable_attrs = await rbac_engine.filter_readable_attrs(obj.attrs, principal["role"], db)
        return _to_jsonld(obj, readable_attrs)

    @router.get("")
    async def list_operators(
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "list", _RESOURCE, db)
        result = await db.execute(select(Operator).where(Operator.removed_at.is_(None)))
        ops = result.scalars().all()
        out = []
        for op in ops:
            readable_attrs = await rbac_engine.filter_readable_attrs(op.attrs, principal["role"], db)
            out.append(_to_jsonld(op, readable_attrs))
        return out

    @router.get("/gln/{gln}")
    async def get_operator_by_gln(
        gln: str,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "read", _RESOURCE, db)
        result = await db.execute(select(Operator).where(Operator.gln == gln))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Operator not found")
        readable_attrs = await rbac_engine.filter_readable_attrs(obj.attrs, principal["role"], db)
        return _to_jsonld(obj, readable_attrs)

    @router.get("/{operator_id}")
    async def get_operator(
        operator_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "read", _RESOURCE, db)
        result = await db.execute(select(Operator).where(Operator.id == operator_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Operator not found")
        readable_attrs = await rbac_engine.filter_readable_attrs(obj.attrs, principal["role"], db)
        return _to_jsonld(obj, readable_attrs)

    @router.patch("/{operator_id}")
    async def update_operator(
        operator_id: uuid.UUID,
        body: OperatorUpdate,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "update", _RESOURCE, db)
        result = await db.execute(select(Operator).where(Operator.id == operator_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Operator not found")
        if obj.removed_at is not None:
            raise HTTPException(status_code=409, detail="Cannot update: Operator has been removed")
        for field in body.model_fields_set:
            value = getattr(body, field)
            if field == "attrs" and value is not None:
                value = await rbac_engine.filter_writable_attrs(value, principal["role"], db)
            setattr(obj, field, value)
        await db.commit()
        await db.refresh(obj)
        return _to_jsonld(obj)

    @router.delete("/{operator_id}")
    async def remove_operator(
        operator_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "delete", _RESOURCE, db)
        result = await db.execute(select(Operator).where(Operator.id == operator_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Operator not found")
        if obj.removed_at is not None:
            raise HTTPException(status_code=409, detail="Operator already removed")
        obj.removed_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(obj)
        return _to_jsonld(obj)

    return router
