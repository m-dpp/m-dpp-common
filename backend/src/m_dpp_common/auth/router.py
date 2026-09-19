"""A parametrised router for subjects, memberships and the current principal.

Both apps need these endpoints identically (the shared *Users & links* and
*acting as* screens talk to them), so the router lives here and each service
mounts it against its own tables — the organisation pattern.

    GET    /subjects            known identities + the organisation each represents + its roles
    POST   /subjects            create one by hand (no real identity provider yet)
    DELETE /subjects/{id}       remove (its membership goes with it)
    GET    /memberships
    POST   /memberships         link a subject to an organisation (409 if already linked)
    DELETE /memberships/{id}    unlink
    GET    /me                  the resolved principal + its effective resource permissions

``GET /subjects`` and ``GET /me`` stay open: the development "acting as" switcher
must be able to list identities before one is chosen. Everything else passes the
resource gate for ``resource_type`` (default ``"subjects"``) when ``rbac_engine``
is given: memberships GET → list, POST → create, DELETE → delete.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from m_dpp_common.auth.principal import subject_out

RESOURCE_ACTIONS = ("list", "read", "create", "update", "delete")


class SubjectCreate(BaseModel):
    sub: str
    email: str | None = None
    display_name: str | None = None

    @field_validator("sub")
    @classmethod
    def _sub(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("sub must not be empty")
        return v


class MembershipCreate(BaseModel):
    subject_id: uuid.UUID
    organisation_id: uuid.UUID


def make_subjects_router(
    *,
    get_db,
    get_principal,
    subject_model,
    membership_model,
    organisation_model,
    organisation_role_model,
    role_model=None,
    resource_permission_model=None,
    resource_types: list[str] | None = None,
    prefix: str = "",
    rbac_engine=None,
    resource_type: str = "subjects",
) -> APIRouter:
    Subject, Membership, Organisation = subject_model, membership_model, organisation_model
    OrgRole, Role, Res = organisation_role_model, role_model, resource_permission_model
    router = APIRouter(prefix=prefix, tags=["auth"])

    def gate(action: str):
        async def _dep(db: AsyncSession = Depends(get_db), principal: dict = Depends(get_principal)):
            if rbac_engine is not None:
                await rbac_engine.check_resource_permission(principal, action, resource_type, db)
        return Depends(_dep)

    LIST, CREATE, DELETE = gate("list"), gate("create"), gate("delete")

    async def _roles_by_org(org_ids: list[uuid.UUID], db: AsyncSession) -> dict[uuid.UUID, list[str]]:
        if not org_ids:
            return {}
        if Role is None:
            stmt = select(OrgRole.organisation_id, OrgRole.role_name).where(
                OrgRole.organisation_id.in_(org_ids)
            ).order_by(OrgRole.role_name)
        else:
            stmt = (
                select(OrgRole.organisation_id, OrgRole.role_name)
                .join(Role, Role.name == OrgRole.role_name)
                .where(OrgRole.organisation_id.in_(org_ids), Role.active.is_(True))
                .order_by(Role.sort_order, Role.name)
            )
        out: dict[uuid.UUID, list[str]] = {}
        for org_id, role_name in (await db.execute(stmt)).all():
            out.setdefault(org_id, []).append(role_name)
        return out

    async def _orgs_by_id(org_ids: list[uuid.UUID], db: AsyncSession) -> dict:
        if not org_ids:
            return {}
        rows = (await db.execute(select(Organisation).where(Organisation.id.in_(org_ids)))).scalars().all()
        return {o.id: o for o in rows}

    # ---------------------------------------------------------------- subjects

    @router.get("/subjects")
    async def list_subjects(db: AsyncSession = Depends(get_db)):
        subjects = (await db.execute(select(Subject).order_by(Subject.sub))).scalars().all()
        memberships = (await db.execute(select(Membership))).scalars().all()
        by_subject = {m.subject_id: m for m in memberships}
        org_ids = list({m.organisation_id for m in memberships})
        orgs = await _orgs_by_id(org_ids, db)
        roles = await _roles_by_org(org_ids, db)
        out = []
        for s in subjects:
            m = by_subject.get(s.id)
            org = orgs.get(m.organisation_id) if m else None
            out.append(
                {
                    **subject_out(s),
                    "membership": (
                        {
                            "id": str(m.id),
                            "organisation": {"id": str(org.id), "name": org.name} if org else None,
                        }
                        if m
                        else None
                    ),
                    "roles": roles.get(m.organisation_id, []) if m else [],
                }
            )
        return out

    @router.post("/subjects", status_code=201, dependencies=[CREATE])
    async def create_subject(body: SubjectCreate, db: AsyncSession = Depends(get_db)):
        obj = Subject(**body.model_dump())
        db.add(obj)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="A subject with this sub already exists")
        await db.refresh(obj)
        return {**subject_out(obj), "membership": None, "roles": []}

    @router.delete("/subjects/{subject_id}", status_code=204, dependencies=[DELETE])
    async def delete_subject(subject_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
        obj = await db.get(Subject, subject_id)
        if obj is None:
            raise HTTPException(status_code=404, detail="Subject not found")
        await db.delete(obj)
        await db.commit()

    # ------------------------------------------------------------- memberships

    def _membership_out(m, subject=None, org=None) -> dict:
        return {
            "id": str(m.id),
            "subject_id": str(m.subject_id),
            "organisation_id": str(m.organisation_id),
            "sub": subject.sub if subject else None,
            "organisation_name": org.name if org else None,
        }

    @router.get("/memberships", dependencies=[LIST])
    async def list_memberships(db: AsyncSession = Depends(get_db)):
        memberships = (await db.execute(select(Membership))).scalars().all()
        subjects = {
            s.id: s
            for s in (
                await db.execute(select(Subject).where(Subject.id.in_([m.subject_id for m in memberships])))
            ).scalars().all()
        } if memberships else {}
        orgs = await _orgs_by_id(list({m.organisation_id for m in memberships}), db)
        return [
            _membership_out(m, subjects.get(m.subject_id), orgs.get(m.organisation_id))
            for m in memberships
        ]

    @router.post("/memberships", status_code=201, dependencies=[CREATE])
    async def create_membership(body: MembershipCreate, db: AsyncSession = Depends(get_db)):
        subject = await db.get(Subject, body.subject_id)
        if subject is None:
            raise HTTPException(status_code=422, detail="subject_id does not reference a subject")
        org = await db.get(Organisation, body.organisation_id)
        if org is None or getattr(org, "removed_at", None) is not None:
            raise HTTPException(status_code=422, detail="organisation_id does not reference an active organisation")
        obj = Membership(subject_id=body.subject_id, organisation_id=body.organisation_id)
        db.add(obj)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=409,
                detail="This subject already represents an organisation — unlink it first",
            )
        await db.refresh(obj)
        return _membership_out(obj, subject, org)

    @router.delete("/memberships/{membership_id}", status_code=204, dependencies=[DELETE])
    async def delete_membership(membership_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
        obj = await db.get(Membership, membership_id)
        if obj is None:
            raise HTTPException(status_code=404, detail="Membership not found")
        await db.delete(obj)
        await db.commit()

    # ---------------------------------------------------------------------- me

    async def _effective_permissions(roles: list[str], db: AsyncSession) -> dict:
        """Union over the principal's roles of the resource gate, per resource type.
        Mirrors the engine's dev posture: a role with no row for a type may do everything."""
        types = list(resource_types or [])
        if Res is None or not types:
            return {}
        rows = (
            await db.execute(select(Res).where(Res.role_name.in_(roles), Res.resource_type.in_(types)))
        ).scalars().all()
        by_type: dict[str, dict[str, list]] = {t: {} for t in types}
        for r in rows:
            by_type[r.resource_type].setdefault(r.role_name, []).append(r)
        out = {}
        for t in types:
            per_role = by_type[t]
            allowed = {}
            for action in RESOURCE_ACTIONS:
                col = f"can_{action}"
                allowed[action] = any(
                    (role not in per_role) or any(getattr(r, col) for r in per_role[role])
                    for role in roles
                )
            out[t] = allowed
        return out

    @router.get("/me")
    async def me(db: AsyncSession = Depends(get_db), principal: dict = Depends(get_principal)):
        return {**principal, "permissions": await _effective_permissions(principal["roles"], db)}

    return router
