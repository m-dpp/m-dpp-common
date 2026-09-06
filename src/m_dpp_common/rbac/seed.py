"""Role seed data (JRC five-tier) + an idempotent seeder.

The role list is shared; the resource-type list and the per-role resource defaults
are passed in by each service (that is the service's policy, not the mechanism).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

JRC_ROLES: list[tuple[str, str]] = [
    ("public", "Public access — read-only, restricted attributes"),
    ("end_user_professional", "End-user professional (e.g. retailer, stylist)"),
    ("recycler", "End-of-life operator / recycler"),
    ("supply_chain_professional", "Supply chain professional — full read/write"),
    ("authority", "Regulatory authority — full read access"),
]


async def seed_rbac(
    db: AsyncSession,
    *,
    role_model,
    resource_permission_model,
    resource_types: list[str],
    resource_defaults: dict[str, dict],
    roles: list[tuple[str, str]] = JRC_ROLES,
) -> None:
    """Insert any missing roles and any missing (role, resource_type) permission rows."""
    for name, description in roles:
        existing = await db.execute(select(role_model).where(role_model.name == name))
        if existing.scalar_one_or_none() is None:
            db.add(role_model(name=name, description=description))

    for role_name, defaults in resource_defaults.items():
        for resource_type in resource_types:
            existing = await db.execute(
                select(resource_permission_model).where(
                    resource_permission_model.role_name == role_name,
                    resource_permission_model.resource_type == resource_type,
                )
            )
            if existing.scalar_one_or_none() is None:
                db.add(
                    resource_permission_model(
                        role_name=role_name, resource_type=resource_type, **defaults
                    )
                )

    await db.commit()
