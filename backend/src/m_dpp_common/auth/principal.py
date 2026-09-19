"""Principal resolution: identity → subject → organisation → roles.

This is the **real** resolution path; only the *source* of the identity
(:mod:`m_dpp_common.auth.dev_identity`) is temporary.

The principal is a plain dict the RBAC engine understands::

    {
      "sub": "auth0|abc" | None,
      "anonymous": bool,             # True when no organisation could be resolved
      "reason": str | None,          # why the fallback applied (dev diagnostics)
      "subject": {"id", "sub", "email", "display_name"} | None,
      "organisation": {"id", "name"} | None,
      "roles": ["economic_operator", ...],   # the organisation's active roles
      "role": "economic_operator",           # compat: roles[0] (deprecated)
    }

Authority always comes from the resolved organisation's roles. The single
deliberate constant is the **anonymous role** used when nothing resolves
(no identity, unknown subject, unlinked subject, or an organisation without an
active role): ``RBAC_ANONYMOUS_ROLE``, default ``public`` — a floor, never a
privileged default.
"""

import os
import uuid

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from m_dpp_common.auth.dev_identity import identity as dev_identity

ANONYMOUS_ROLE_ENV = "RBAC_ANONYMOUS_ROLE"


def anonymous_role() -> str:
    return os.getenv(ANONYMOUS_ROLE_ENV, "public")


def _fallback(sub: str | None, role: str, reason: str, *, subject=None) -> dict:
    return {
        "sub": sub,
        "anonymous": True,
        "reason": reason,
        "subject": subject,
        "organisation": None,
        "roles": [role],
        "role": role,
    }


def subject_out(s) -> dict:
    return {"id": str(s.id), "sub": s.sub, "email": s.email, "display_name": s.display_name}


async def organisation_role_names(
    organisation_id: uuid.UUID,
    db: AsyncSession,
    *,
    organisation_role_model,
    role_model=None,
) -> list[str]:
    """The organisation's role names, active ones only when a role model is given,
    in the roles table's sort order."""
    OrgRole = organisation_role_model
    if role_model is None:
        stmt = (
            select(OrgRole.role_name)
            .where(OrgRole.organisation_id == organisation_id)
            .order_by(OrgRole.role_name)
        )
    else:
        Role = role_model
        stmt = (
            select(OrgRole.role_name)
            .join(Role, Role.name == OrgRole.role_name)
            .where(OrgRole.organisation_id == organisation_id, Role.active.is_(True))
            .order_by(Role.sort_order, Role.name)
        )
    return [name for (name,) in (await db.execute(stmt)).all()]


async def resolve_principal(
    sub: str | None,
    db: AsyncSession,
    *,
    subject_model,
    membership_model,
    organisation_model,
    organisation_role_model,
    role_model=None,
    anonymous: str | None = None,
) -> dict:
    anon = anonymous or anonymous_role()
    if sub is None:
        return _fallback(None, anon, "no identity supplied")

    Subject, Membership, Organisation = subject_model, membership_model, organisation_model

    subject = (await db.execute(select(Subject).where(Subject.sub == sub))).scalar_one_or_none()
    if subject is None:
        return _fallback(sub, anon, "unknown subject")

    membership = (
        await db.execute(select(Membership).where(Membership.subject_id == subject.id))
    ).scalar_one_or_none()
    if membership is None:
        return _fallback(sub, anon, "subject is not linked to an organisation", subject=subject_out(subject))

    org = await db.get(Organisation, membership.organisation_id)
    if org is None or getattr(org, "removed_at", None) is not None:
        return _fallback(sub, anon, "linked organisation is missing or removed", subject=subject_out(subject))

    roles = await organisation_role_names(
        org.id, db, organisation_role_model=organisation_role_model, role_model=role_model
    )
    reason = None
    if not roles:
        roles, reason = [anon], "organisation holds no active role"

    return {
        "sub": sub,
        "anonymous": False,
        "reason": reason,
        "subject": subject_out(subject),
        "organisation": {"id": str(org.id), "name": org.name},
        "roles": roles,
        "role": roles[0],
    }


def make_get_principal(
    *,
    get_db,
    subject_model,
    membership_model,
    organisation_model,
    organisation_role_model,
    role_model=None,
    identity=dev_identity,
    anonymous: str | None = None,
):
    """Build the service's ``get_principal`` FastAPI dependency.

    ``identity`` is the identity source (default: the dev header). Replacing it
    with a JWT-validating dependency is the whole production switch.
    """

    async def get_principal(
        sub: str | None = Depends(identity), db: AsyncSession = Depends(get_db)
    ) -> dict:
        return await resolve_principal(
            sub,
            db,
            subject_model=subject_model,
            membership_model=membership_model,
            organisation_model=organisation_model,
            organisation_role_model=organisation_role_model,
            role_model=role_model,
            anonymous=anonymous,
        )

    return get_principal
