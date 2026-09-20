"""Platform-wide definitions (§4.5) and the three tenancy scopes (§2.2)."""

import uuid

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.rbac import (
    COMMON_RESOURCE_DEFAULTS,
    COMMON_RESOURCE_TYPES,
    FULL,
    READ,
    merge_resource_defaults,
    permissions_checksum,
)
from m_dpp_common.scoping import model_level, owned_by, owned_by_any, readable, visible_to_role


class Base(DeclarativeBase):
    pass


class Row(Base):
    __tablename__ = "rows"
    id = Column(PGUUID(as_uuid=True), primary_key=True)
    gs1_path = Column(String)
    operator_id = Column(PGUUID(as_uuid=True))


# ── the shared definition ────────────────────────────────────────────────

def test_only_platform_admin_may_change_the_policy_surface():
    """An operator that could edit the RBAC matrices could widen what `public`
    sees of its own data — the thing tenancy exists to prevent."""
    assert COMMON_RESOURCE_DEFAULTS["platform_admin"]["rbac"]["can_update"] is True
    for role, per_resource in COMMON_RESOURCE_DEFAULTS.items():
        if role == "platform_admin":
            continue
        assert per_resource["rbac"]["can_update"] is False, role
        assert per_resource["rbac"]["can_create"] is False, role


def test_administrator_operates_but_does_not_define():
    """The deliberate split: it runs the installation (identities), it does not
    set policy."""
    admin = COMMON_RESOURCE_DEFAULTS["administrator"]
    assert admin["subjects"]["can_create"] is True      # operates
    assert admin["rbac"]["can_read"] is True            # can see the rules
    assert admin["rbac"]["can_update"] is False         # cannot redefine them


def test_every_role_can_at_least_list_organisations():
    """Shared in existence: an operator must be able to find a laboratory, and a
    lab must see who requested a test."""
    for role, per_resource in COMMON_RESOURCE_DEFAULTS.items():
        assert per_resource["organisations"]["can_list"] is True, role


def test_no_tenant_role_touches_subjects():
    for role in ("economic_operator", "laboratory", "recycler", "authority", "public"):
        assert COMMON_RESOURCE_DEFAULTS[role]["subjects"]["can_read"] is False


def test_an_app_adds_its_own_entities_without_restating_the_shared_ones():
    merged = merge_resource_defaults(
        COMMON_RESOURCE_DEFAULTS, {"economic_operator": {"products": FULL}}
    )
    assert merged["economic_operator"]["products"] == FULL
    assert merged["economic_operator"]["organisations"] == COMMON_RESOURCE_DEFAULTS[
        "economic_operator"
    ]["organisations"]


def test_checksum_is_stable_under_reordering_but_moves_on_a_real_change():
    """Reformatting must not read as drift; a widened permission must."""
    a = permissions_checksum(COMMON_RESOURCE_TYPES, COMMON_RESOURCE_DEFAULTS)
    b = permissions_checksum(list(reversed(COMMON_RESOURCE_TYPES)), dict(reversed(list(COMMON_RESOURCE_DEFAULTS.items()))))
    assert a == b

    widened = merge_resource_defaults(COMMON_RESOURCE_DEFAULTS, {"public": {"rbac": READ}})
    assert permissions_checksum(COMMON_RESOURCE_TYPES, widened) != a


# ── the three scopes ─────────────────────────────────────────────────────

def _sql(clause) -> str:
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


def test_owning_nothing_matches_nothing_not_everything():
    """An unattributed caller owns no rows — the failure mode must be empty, not
    the whole table."""
    assert _sql(owned_by(Row.operator_id, None)) == "false"
    assert _sql(owned_by_any(Row.operator_id, [])) == "false"


def test_model_level_is_derived_from_the_path_shape():
    assert "8013/" in _sql(model_level(Row.gs1_path))


def test_public_sees_model_level_across_tenants_and_nothing_deeper():
    clause = visible_to_role(Row.gs1_path, ["public"])
    sql = _sql(clause)
    assert "8013/" in sql and sql != "true"


def test_an_authority_reads_across_tenants():
    """Market surveillance that could only see what it owned would see nothing."""
    assert _sql(visible_to_role(Row.gs1_path, ["authority"])) == "true"


def test_a_read_is_what_you_own_or_what_your_role_allows():
    org = uuid.uuid4()
    sql = _sql(readable(Row.gs1_path, Row.operator_id, organisation_ids=[org], roles=["public"]))
    assert org.hex in sql           # your own rows (rendered without hyphens)
    assert "8013/" in sql           # plus public model-level
    assert " OR " in sql
