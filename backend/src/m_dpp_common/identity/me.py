"""`GET /me` for an APP — the principal, plus what it may do **here**.

Not a duplicate of m-dpp-identity's `/me`, and the difference matters.

The principal itself — subject, acting organisation, roles — is identity's
answer and is authoritative; this router simply passes it through. What it adds
is the resource gate **for this app's own resource types**: `products` in
dpp-app, `declarations` / `tests` / `fibre_nodes` in mdpp-app. Identity cannot
answer those, because it has never heard of them.

So a front-end asks both and merges: identity for `organisations`, `subjects`
and `rbac`, the app for its own entities. A UI that asked only one would hide
half its navigation, and neither service would be lying.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

RESOURCE_ACTIONS = ("list", "read", "create", "update", "delete")


async def effective_permissions(
    roles: list[str],
    resource_types: list[str],
    resource_permission_model,
    db: AsyncSession,
) -> dict:
    """Union over the principal's roles of the resource gate, per resource type.

    Mirrors the engine's dev posture: a role with no row for a type may do
    everything. That is deliberate — a newly added entity is open until someone
    writes a policy for it — and it is why the seed fans rows out over every
    role rather than leaving gaps.
    """
    Res = resource_permission_model
    rows = (
        await db.execute(
            select(Res).where(
                Res.role_name.in_(roles), Res.resource_type.in_(resource_types)
            )
        )
    ).scalars().all()
    by_type: dict[str, dict[str, list]] = {t: {} for t in resource_types}
    for r in rows:
        by_type[r.resource_type].setdefault(r.role_name, []).append(r)
    out = {}
    for t in resource_types:
        per_role = by_type[t]
        out[t] = {
            action: any(
                (role not in per_role) or any(getattr(r, f"can_{action}") for r in per_role[role])
                for role in roles
            )
            for action in RESOURCE_ACTIONS
        }
    return out


def make_me_router(
    *,
    get_db,
    get_principal,
    resource_permission_model,
    resource_types: list[str],
    prefix: str = "",
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=["auth"])

    @router.get("/me")
    async def me(db: AsyncSession = Depends(get_db), principal: dict = Depends(get_principal)):
        return {
            **principal,
            "permissions": await effective_permissions(
                principal["roles"], resource_types, resource_permission_model, db
            ),
        }

    return router
