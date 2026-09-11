import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
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


def test_update_attrs_null_is_rejected():
    """`attrs: null` must not mean "clear everything" — removal is per key."""
    with pytest.raises(ValidationError):
        OrganisationUpdate(attrs=None)


def test_update_attrs_key_null_is_allowed_and_means_remove():
    upd = OrganisationUpdate(attrs={"gln": None, "city": "Arnhem"})
    assert upd.attrs == {"gln": None, "city": "Arnhem"}


# ── PATCH semantics (handlers driven directly, DB and engine mocked) ─────

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _org(attrs):
    return SimpleNamespace(
        id=uuid.uuid4(), name="HAN", attrs=attrs, created_at=NOW, updated_at=NOW, removed_at=None
    )


def _db(obj):
    result = MagicMock()
    result.scalar_one_or_none.return_value = obj
    db = AsyncMock()
    db.execute.return_value = result
    return db


def _engine(*, denied_write=(), denied_read=()):
    """An RbacEngine stand-in with the real reject/strip semantics on fixed key sets."""
    async def assert_writable_attrs(attrs, role, db, *, entity_type):
        bad = sorted(set(attrs or {}) & set(denied_write))
        if bad:
            raise HTTPException(status_code=403, detail=", ".join(bad))

    async def filter_readable_attrs(attrs, role, db, *, entity_type):
        return {k: v for k, v in (attrs or {}).items() if k not in denied_read}

    return SimpleNamespace(
        check_resource_permission=AsyncMock(),
        assert_writable_attrs=assert_writable_attrs,
        filter_readable_attrs=filter_readable_attrs,
    )


def _handler(router, method):
    return next(r.endpoint for r in router.routes if method in getattr(r, "methods", ()))


def _patch_router(engine):
    return make_organisation_router(
        get_db=lambda: None,
        organisation_model=Organisation,
        rbac_engine=engine,
        context_url="https://example.test/context/v1.jsonld",
    )


PRINCIPAL = {"sub": "t", "role": "economic_operator"}


async def test_patch_merges_onto_stored_attrs():
    obj = _org({"gln": "8718036001008", "city": "Arnhem"})
    patch = _handler(_patch_router(_engine()), "PATCH")
    out = await patch(obj.id, OrganisationUpdate(attrs={"city": "Nijmegen"}), _db(obj), PRINCIPAL)
    assert obj.attrs == {"gln": "8718036001008", "city": "Nijmegen"}
    assert out["attrs"] == obj.attrs


async def test_patch_cannot_wipe_a_key_the_role_may_not_write():
    """The bug: a body naming only a denied key used to replace the whole bag with {}."""
    obj = _org({"gln": "8718036001008", "lab_results_endpoint": "http://lab"})
    patch = _handler(_patch_router(_engine(denied_write={"lab_results_endpoint"})), "PATCH")
    db = _db(obj)
    with pytest.raises(HTTPException) as exc:
        await patch(obj.id, OrganisationUpdate(attrs={"lab_results_endpoint": "http://x"}), db, PRINCIPAL)
    assert exc.value.status_code == 403
    assert obj.attrs == {"gln": "8718036001008", "lab_results_endpoint": "http://lab"}
    db.commit.assert_not_called()


async def test_patch_removing_a_key_needs_write_permission_on_it():
    obj = _org({"lab_results_endpoint": "http://lab"})
    patch = _handler(_patch_router(_engine(denied_write={"lab_results_endpoint"})), "PATCH")
    with pytest.raises(HTTPException) as exc:
        await patch(obj.id, OrganisationUpdate(attrs={"lab_results_endpoint": None}), _db(obj), PRINCIPAL)
    assert exc.value.status_code == 403
    assert obj.attrs == {"lab_results_endpoint": "http://lab"}


async def test_patch_leaves_unnamed_protected_keys_alone():
    obj = _org({"lab_results_endpoint": "http://lab", "city": "Arnhem"})
    patch = _handler(_patch_router(_engine(denied_write={"lab_results_endpoint"})), "PATCH")
    await patch(obj.id, OrganisationUpdate(attrs={"city": "Nijmegen"}), _db(obj), PRINCIPAL)
    assert obj.attrs == {"lab_results_endpoint": "http://lab", "city": "Nijmegen"}


async def test_patch_null_removes_a_writable_key():
    obj = _org({"gln": "8718036001008", "city": "Arnhem"})
    patch = _handler(_patch_router(_engine()), "PATCH")
    await patch(obj.id, OrganisationUpdate(attrs={"gln": None}), _db(obj), PRINCIPAL)
    assert obj.attrs == {"city": "Arnhem"}


async def test_patch_name_only_keeps_attrs():
    obj = _org({"gln": "8718036001008"})
    patch = _handler(_patch_router(_engine(denied_write={"gln"})), "PATCH")
    await patch(obj.id, OrganisationUpdate(name="Renamed"), _db(obj), PRINCIPAL)
    assert obj.name == "Renamed"
    assert obj.attrs == {"gln": "8718036001008"}


async def test_patch_response_strips_unreadable_attrs():
    obj = _org({"gln": "8718036001008", "secret": "x"})
    patch = _handler(_patch_router(_engine(denied_read={"secret"})), "PATCH")
    out = await patch(obj.id, OrganisationUpdate(name="Renamed"), _db(obj), PRINCIPAL)
    assert out["attrs"] == {"gln": "8718036001008"}
    assert obj.attrs == {"gln": "8718036001008", "secret": "x"}


async def test_create_rejects_a_denied_key_instead_of_dropping_it():
    post = _handler(_patch_router(_engine(denied_write={"lab_results_endpoint"})), "POST")
    db = _db(None)
    with pytest.raises(HTTPException) as exc:
        await post(OrganisationCreate(name="Lab", attrs={"lab_results_endpoint": "http://x"}), db, PRINCIPAL)
    assert exc.value.status_code == 403
    db.add.assert_not_called()
