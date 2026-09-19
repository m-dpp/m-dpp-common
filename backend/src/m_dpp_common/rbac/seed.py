"""Role seed data + idempotent seeding and fan-out helpers.

Roles are **data**: the list below is only the initial seed (JRC five-tier, plus
the two the project needs). New roles are created at runtime through the admin
API and get the same fan-out as seeded ones.

Fan-out keeps the permission grid complete: every (role × resource_type) has a
resource row and every (role × registered attribute) has an attribute row, so a
new role never lands in the "no row = allow" gap of the dev posture.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# (name, label, description)
JRC_ROLES: list[tuple[str, str, str]] = [
    ("public", "Public", "Public access — read-only, restricted attributes"),
    ("end_user_professional", "End User Professional", "End-user professional (e.g. retailer, stylist)"),
    ("recycler", "Recycler", "End-of-life operator / recycler"),
    ("supply_chain_professional", "Supply Chain Pro", "Supply chain professional — full read/write"),
    ("authority", "Authority", "Regulatory authority — full read access"),
    ("economic_operator", "Economic Operator", "Economic operator — full read/write"),
    ("laboratory", "Laboratory", "Laboratory (e.g. CoE HAN BioCentre)"),
]

# Safe defaults for a role the service's policy does not mention (e.g. one created
# at runtime): may see, may not change. Tighten/loosen in the dashboard.
NEW_ROLE_RESOURCE_DEFAULTS: dict = dict(
    can_list=True, can_read=True, can_create=False, can_update=False, can_delete=False
)
NEW_ROLE_ATTR_DEFAULTS: dict = dict(can_read=True, can_write=False)


def _unpack_role(entry) -> tuple[str, str | None, str]:
    """Accept (name, description) — the v0.6 shape — or (name, label, description)."""
    if len(entry) == 2:
        name, description = entry
        return name, None, description
    name, label, description = entry
    return name, label, description


async def fan_out_role(
    db: AsyncSession,
    role_name: str,
    *,
    resource_permission_model,
    resource_types: list[str],
    resource_defaults: dict | None = None,
    attr_permission_model=None,
    attribute_model=None,
    attr_defaults: dict | None = None,
) -> dict:
    """Add the missing permission rows for one role. Does not commit."""
    Res = resource_permission_model
    res_defaults = resource_defaults or NEW_ROLE_RESOURCE_DEFAULTS
    existing = {
        rt
        for (rt,) in (
            await db.execute(select(Res.resource_type).where(Res.role_name == role_name))
        ).all()
    }
    added_res = 0
    for resource_type in resource_types:
        if resource_type not in existing:
            db.add(Res(role_name=role_name, resource_type=resource_type, **res_defaults))
            added_res += 1

    added_attr = 0
    if attr_permission_model is not None and attribute_model is not None:
        Attr, Reg = attr_permission_model, attribute_model
        a_defaults = attr_defaults or NEW_ROLE_ATTR_DEFAULTS
        registered = (await db.execute(select(Reg.entity_type, Reg.attr_key))).all()
        have = {
            (et, ak)
            for et, ak in (
                await db.execute(
                    select(Attr.entity_type, Attr.attr_key).where(Attr.role_name == role_name)
                )
            ).all()
        }
        for entity_type, attr_key in registered:
            if (entity_type, attr_key) not in have:
                db.add(
                    Attr(
                        entity_type=entity_type,
                        attr_key=attr_key,
                        role_name=role_name,
                        **a_defaults,
                    )
                )
                added_attr += 1
    return {"resource_rows": added_res, "attr_rows": added_attr}


async def fan_out_attribute(
    db: AsyncSession,
    entity_type: str,
    attr_key: str,
    *,
    role_model,
    attr_permission_model,
    attr_defaults: dict | None = None,
) -> int:
    """Add the missing (attribute × role) rows for one registered attribute. Does not commit."""
    Attr = attr_permission_model
    a_defaults = attr_defaults or NEW_ROLE_ATTR_DEFAULTS
    role_names = [n for (n,) in (await db.execute(select(role_model.name))).all()]
    have = {
        rn
        for (rn,) in (
            await db.execute(
                select(Attr.role_name).where(
                    Attr.entity_type == entity_type, Attr.attr_key == attr_key
                )
            )
        ).all()
    }
    added = 0
    for role_name in role_names:
        if role_name not in have:
            db.add(
                Attr(entity_type=entity_type, attr_key=attr_key, role_name=role_name, **a_defaults)
            )
            added += 1
    return added


async def seed_rbac(
    db: AsyncSession,
    *,
    role_model,
    resource_permission_model,
    resource_types: list[str],
    resource_defaults: dict[str, dict],
    roles: list[tuple] = JRC_ROLES,
    attr_permission_model=None,
    attribute_model=None,
) -> None:
    """Insert any missing roles, then fan out permission rows for *every* stored role
    (seeded or created at runtime). Idempotent; commits once."""
    for position, entry in enumerate(roles):
        name, label, description = _unpack_role(entry)
        existing = await db.execute(select(role_model).where(role_model.name == name))
        if existing.scalar_one_or_none() is None:
            db.add(
                role_model(
                    name=name, label=label, description=description, sort_order=position
                )
            )
    await db.flush()

    all_roles = [n for (n,) in (await db.execute(select(role_model.name))).all()]
    for role_name in all_roles:
        await fan_out_role(
            db,
            role_name,
            resource_permission_model=resource_permission_model,
            resource_types=resource_types,
            resource_defaults=resource_defaults.get(role_name),
            attr_permission_model=attr_permission_model,
            attribute_model=attribute_model,
        )

    await db.commit()
