"""A parametrised ``/organisations`` CRUD router.

``dpp-app`` and ``mdpp-app`` mount the *same* endpoints against their *own*
``organisations`` table and ``@context`` document, so those are constructor
arguments. The RBAC checks route through the service's :class:`RbacEngine`
instance; auth defaults to the shared dev stub.

A GLN is optional and lives in ``attrs["gln"]`` (see
:mod:`m_dpp_common.organisation.models`), so the by-GLN lookup is a JSONB query
and the JSON-LD ``@id`` falls back to a ``urn:uuid:`` when there is no GLN.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from m_dpp_common.auth import get_principal as _default_get_principal
from m_dpp_common.organisation.schemas import OrganisationCreate, OrganisationUpdate


def make_organisation_router(
    *,
    get_db,
    organisation_model,
    rbac_engine,
    context_url: str,
    get_principal=_default_get_principal,
    resource_name: str = "organisations",
    prefix: str = "/organisations",
) -> APIRouter:
    Organisation = organisation_model
    _RESOURCE = resource_name

    router = APIRouter(prefix=prefix, tags=[resource_name])

    def _identifier(org) -> str:
        """GS1 party URI when the organisation declares a GLN, else a UUID URN."""
        gln = (org.attrs or {}).get("gln")
        return f"https://id.gs1.org/417/{gln}" if gln else f"urn:uuid:{org.id}"

    def _to_jsonld(org, attrs=None) -> dict:
        return {
            "@context": context_url,
            "@id": _identifier(org),
            "@type": "schema:Organization",
            "id": str(org.id),
            "name": org.name,
            "attrs": attrs if attrs is not None else org.attrs,
            "created_at": org.created_at.isoformat(),
            "updated_at": org.updated_at.isoformat(),
            "removed_at": org.removed_at.isoformat() if org.removed_at else None,
        }

    @router.post("", status_code=201)
    async def create_organisation(
        body: OrganisationCreate,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "create", _RESOURCE, db)
        data = body.model_dump()
        if data.get("attrs"):
            data["attrs"] = await rbac_engine.filter_writable_attrs(
                data["attrs"], principal["role"], db
            )
        obj = Organisation(**data)
        db.add(obj)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=409, detail="An organisation with this GLN already exists"
            )
        await db.refresh(obj)
        readable_attrs = await rbac_engine.filter_readable_attrs(obj.attrs, principal["role"], db)
        return _to_jsonld(obj, readable_attrs)

    @router.get("")
    async def list_organisations(
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "list", _RESOURCE, db)
        result = await db.execute(select(Organisation).where(Organisation.removed_at.is_(None)))
        orgs = result.scalars().all()
        out = []
        for org in orgs:
            readable_attrs = await rbac_engine.filter_readable_attrs(
                org.attrs, principal["role"], db
            )
            out.append(_to_jsonld(org, readable_attrs))
        return out

    @router.get("/by-gln/{gln}")
    async def get_organisation_by_gln(
        gln: str,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        """Secondary lookup — only finds organisations that declare `attrs.gln`."""
        await rbac_engine.check_resource_permission(principal, "read", _RESOURCE, db)
        result = await db.execute(
            select(Organisation).where(Organisation.attrs["gln"].astext == gln)
        )
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Organisation not found")
        readable_attrs = await rbac_engine.filter_readable_attrs(obj.attrs, principal["role"], db)
        return _to_jsonld(obj, readable_attrs)

    @router.get("/{organisation_id}")
    async def get_organisation(
        organisation_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "read", _RESOURCE, db)
        result = await db.execute(select(Organisation).where(Organisation.id == organisation_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Organisation not found")
        readable_attrs = await rbac_engine.filter_readable_attrs(obj.attrs, principal["role"], db)
        return _to_jsonld(obj, readable_attrs)

    @router.patch("/{organisation_id}")
    async def update_organisation(
        organisation_id: uuid.UUID,
        body: OrganisationUpdate,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "update", _RESOURCE, db)
        result = await db.execute(select(Organisation).where(Organisation.id == organisation_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Organisation not found")
        if obj.removed_at is not None:
            raise HTTPException(
                status_code=409, detail="Cannot update: Organisation has been removed"
            )
        for field in body.model_fields_set:
            value = getattr(body, field)
            if field == "attrs" and value is not None:
                value = await rbac_engine.filter_writable_attrs(value, principal["role"], db)
            setattr(obj, field, value)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=409, detail="An organisation with this GLN already exists"
            )
        await db.refresh(obj)
        return _to_jsonld(obj)

    @router.delete("/{organisation_id}")
    async def remove_organisation(
        organisation_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        principal: dict = Depends(get_principal),
    ):
        await rbac_engine.check_resource_permission(principal, "delete", _RESOURCE, db)
        result = await db.execute(select(Organisation).where(Organisation.id == organisation_id))
        obj = result.scalar_one_or_none()
        if obj is None:
            raise HTTPException(status_code=404, detail="Organisation not found")
        if obj.removed_at is not None:
            raise HTTPException(status_code=409, detail="Organisation already removed")
        obj.removed_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(obj)
        return _to_jsonld(obj)

    return router
