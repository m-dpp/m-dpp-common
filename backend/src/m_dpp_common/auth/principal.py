"""Principal resolution: identity → subject → organisation → roles.

This is the **real** resolution path; only the *source* of the identity
(:mod:`m_dpp_common.auth.dev_identity`) is temporary.

The principal is a plain dict the RBAC engine understands::

    {
      "sub": "auth0|abc" | None,
      "anonymous": bool,             # True when no organisation could be resolved
      "reason": str | None,          # why the fallback applied (dev diagnostics)
      "subject": {"id", "sub", "email", "display_name"} | None,
      "organisation": {"id", "name"} | None,   # the ACTING organisation
      "is_org_admin": bool,                    # ...of that one membership
      "organisations": [{"id", "name", "is_org_admin"}, ...],  # all it may act for
      "roles": ["economic_operator", ...],   # the acting organisation's active roles
      "role": "economic_operator",           # compat: roles[0] (deprecated)
    }

**Who you are and who you are acting as are two different things.** The identity
source answers the first; ``acting_organisation`` answers the second. A subject
may hold several memberships, and holds exactly ONE organisation's authority at
a time — ``roles`` is never a union across memberships. Merging them would
invent a principal that exists in no organisation, able to write in one tenant
with a role it holds only in another, and would make "on whose behalf was this
written?" unanswerable afterwards.

``organisations`` lists what the subject *may* act for, so a UI can offer the
switch and a read can optionally span them. It confers no authority by itself.

Authority always comes from the ACTING organisation's roles. The single
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

from m_dpp_common.auth.acting_organisation import acting_organisation as dev_acting_organisation
from m_dpp_common.auth.dev_identity import identity as dev_identity

ANONYMOUS_ROLE_ENV = "RBAC_ANONYMOUS_ROLE"


def anonymous_role() -> str:
    return os.getenv(ANONYMOUS_ROLE_ENV, "public")


def _fallback(sub: str | None, role: str, reason: str, *, subject=None, organisations=None) -> dict:
    return {
        "sub": sub,
        "anonymous": True,
        "reason": reason,
        "is_org_admin": False,
        "organisations": organisations or [],
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
    acting_organisation: str | uuid.UUID | None = None,
) -> dict:
    anon = anonymous or anonymous_role()
    if sub is None:
        return _fallback(None, anon, "no identity supplied")

    Subject, Membership, Organisation = subject_model, membership_model, organisation_model

    subject = (await db.execute(select(Subject).where(Subject.sub == sub))).scalar_one_or_none()
    if subject is None:
        return _fallback(sub, anon, "unknown subject")

    memberships = list(
        (
            await db.execute(
                select(Membership).where(Membership.subject_id == subject.id)
            )
        ).scalars().all()
    )
    if not memberships:
        return _fallback(sub, anon, "subject is not linked to an organisation", subject=subject_out(subject))

    # Every organisation this subject MAY act for. Offered to the UI as choices;
    # it grants nothing on its own.
    orgs_by_id = {}
    choices = []
    for m in memberships:
        o = await db.get(Organisation, m.organisation_id)
        if o is None or getattr(o, "removed_at", None) is not None:
            continue
        orgs_by_id[str(o.id)] = (o, m)
        choices.append({"id": str(o.id), "name": o.name, "is_org_admin": bool(m.is_org_admin)})
    if not choices:
        return _fallback(
            sub, anon, "linked organisation is missing or removed",
            subject=subject_out(subject),
        )

    # Pick the ONE organisation being acted as. An explicit choice must be one
    # the subject actually holds a membership for — otherwise it is refused
    # rather than quietly falling back to another, which would silently write on
    # behalf of an organisation the caller did not name.
    if acting_organisation is not None:
        picked = orgs_by_id.get(str(acting_organisation))
        if picked is None:
            return _fallback(
                sub, anon, "not a member of the requested organisation",
                subject=subject_out(subject), organisations=choices,
            )
    else:
        # No choice made: only unambiguous when there is exactly one membership.
        # With several, defaulting would make authority depend on row order.
        if len(choices) > 1:
            return _fallback(
                sub, anon, "several organisations available — choose one to act as",
                subject=subject_out(subject), organisations=choices,
            )
        picked = orgs_by_id[choices[0]["id"]]

    org, membership = picked

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
        "is_org_admin": bool(membership.is_org_admin),
        "organisations": choices,
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
    acting=dev_acting_organisation,
    anonymous: str | None = None,
):
    """Build the service's ``get_principal`` FastAPI dependency.

    ``identity`` answers *who* (default: the dev header); replacing it with a
    JWT-validating dependency is the whole production switch. ``acting`` answers
    *on whose behalf* — a selector among the subject's own memberships, never a
    credential.
    """

    async def get_principal(
        sub: str | None = Depends(identity),
        acting_org: str | None = Depends(acting),
        db: AsyncSession = Depends(get_db),
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
            acting_organisation=acting_org,
        )

    return get_principal
