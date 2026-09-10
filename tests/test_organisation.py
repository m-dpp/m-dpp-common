from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.organisation import (
    OrganisationCreate,
    OrganisationMixin,
    OrganisationUpdate,
    make_organisation_router,
)
from m_dpp_common.rbac import OrganisationRoleMixin


class Base(DeclarativeBase):
    pass


class Organisation(OrganisationMixin, Base):
    pass


class OrganisationRole(OrganisationRoleMixin, Base):
    pass


def _router(**kwargs):
    return make_organisation_router(
        get_db=lambda: None,
        organisation_model=Organisation,
        rbac_engine=SimpleNamespace(),
        context_url="https://example.test/context/v1.jsonld",
        **kwargs,
    )


# ── the table ────────────────────────────────────────────────────────────

def test_mixin_binds_expected_table_and_columns():
    assert Organisation.__tablename__ == "organisations"
    cols = set(Organisation.__table__.columns.keys())
    assert cols == {"id", "name", "attrs", "created_at", "updated_at", "removed_at"}


def test_gln_is_not_a_column():
    """A GLN is optional data inside `attrs`, never a first-class field."""
    assert "gln" not in Organisation.__table__.columns


def test_gln_uniqueness_kept_as_a_partial_index():
    idx = {i.name: i for i in Organisation.__table__.indexes}
    assert "uq_organisations_gln" in idx
    assert idx["uq_organisations_gln"].unique is True


def test_role_assignment_keys_on_organisation_id():
    assert OrganisationRole.__tablename__ == "organisation_roles"
    cols = OrganisationRole.__table__.columns
    assert "organisation_id" in cols
    assert "operator_gln" not in cols
    fk = list(cols["organisation_id"].foreign_keys)[0]
    assert fk.target_fullname == "organisations.id"


# ── the router ───────────────────────────────────────────────────────────

def test_router_mounts_expected_paths():
    paths = {r.path for r in _router().routes}
    assert "/organisations" in paths
    assert "/organisations/by-gln/{gln}" in paths
    assert "/organisations/{organisation_id}" in paths

    methods = {m for r in _router().routes for m in getattr(r, "methods", set())}
    assert {"GET", "POST", "PATCH", "DELETE"} <= methods


def test_router_honours_prefix_override():
    paths = {r.path for r in _router(prefix="/parties", resource_name="parties").routes}
    assert "/parties" in paths
    assert "/parties/{organisation_id}" in paths


# ── schemas ──────────────────────────────────────────────────────────────

def test_create_requires_only_a_name():
    org = OrganisationCreate(name="HAN University of Applied Sciences")
    assert org.attrs is None


def test_create_derives_gln_from_a_company_prefix_in_attrs():
    org = OrganisationCreate(name="Byborre B.V.", attrs={"gln": "871803600100"})
    assert org.attrs["gln"] == "8718036001008"


def test_create_rejects_a_malformed_gln():
    with pytest.raises(ValidationError):
        OrganisationCreate(name="Nope", attrs={"gln": "not-a-gln"})


def test_other_attrs_survive_gln_normalisation():
    org = OrganisationCreate(name="HAN", attrs={"gln": "871803600400", "city": "Arnhem"})
    assert org.attrs == {"gln": "8718036004009", "city": "Arnhem"}


def test_update_is_all_optional_and_does_not_mark_attrs_as_set():
    """The PATCH handler drives off model_fields_set — an absent `attrs` must not
    appear there, or a name-only PATCH would wipe the stored attrs."""
    upd = OrganisationUpdate(name="New name")
    assert upd.model_fields_set == {"name"}
