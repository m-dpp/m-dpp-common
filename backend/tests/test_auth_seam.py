"""The auth seam: subject/membership shape, principal resolution, the dev
identity source, the subjects router, and union-over-roles in the engine."""

import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.auth import (
    DEV_IDENTITY_HEADER,
    MembershipMixin,
    SubjectMixin,
    dev_identity,
    make_get_principal,
    make_subjects_router,
    resolve_principal,
)
from m_dpp_common.organisation import OrganisationMixin
from m_dpp_common.rbac import (
    AttrPermissionMixin,
    OrganisationRoleMixin,
    RbacEngine,
    ResourcePermissionMixin,
    RoleMixin,
    principal_roles,
)


class Base(DeclarativeBase):
    pass


class Organisation(OrganisationMixin, Base):
    pass


class Subject(SubjectMixin, Base):
    pass


class Membership(MembershipMixin, Base):
    pass


class Role(RoleMixin, Base):
    pass


class OrganisationRole(OrganisationRoleMixin, Base):
    pass


class ResourcePermission(ResourcePermissionMixin, Base):
    pass


class AttrPermission(AttrPermissionMixin, Base):
    pass


# ── tables ───────────────────────────────────────────────────────────────

def test_subject_table_shape():
    assert Subject.__tablename__ == "subjects"
    cols = set(Subject.__table__.columns.keys())
    assert cols == {"id", "sub", "email", "display_name", "created_at", "updated_at"}
    assert Subject.__table__.columns["sub"].unique


def test_membership_links_one_subject_to_one_organisation():
    assert Membership.__tablename__ == "memberships"
    cols = Membership.__table__.columns
    assert list(cols["subject_id"].foreign_keys)[0].target_fullname == "subjects.id"
    assert list(cols["organisation_id"].foreign_keys)[0].target_fullname == "organisations.id"
    uniques = {c.name: c for c in Membership.__table__.constraints if c.name}
    assert "uq_membership_subject" in uniques
    assert [c.name for c in uniques["uq_membership_subject"].columns] == ["subject_id"]


def test_no_per_user_roles_anywhere():
    """A subject has no role column: authority comes from the organisation."""
    for table in (Subject.__table__, Membership.__table__):
        assert not any("role" in c.name for c in table.columns)


# ── dev identity source ──────────────────────────────────────────────────

async def test_dev_identity_header_name_and_blank_handling():
    assert DEV_IDENTITY_HEADER == "X-Dev-Sub"
    assert await dev_identity(None) is None
    assert await dev_identity("   ") is None
    assert await dev_identity(" alice ") == "alice"


# ── principal resolution ─────────────────────────────────────────────────

class FakeDb:
    """`execute` answers from a queue of results; `get` from a dict."""

    def __init__(self, execute_results=(), rows=None):
        self._queue = list(execute_results)
        self._rows = rows or {}

    async def execute(self, stmt):
        payload = self._queue.pop(0)
        result = MagicMock()
        result.scalar_one_or_none.return_value = payload
        result.all.return_value = payload if isinstance(payload, list) else []
        return result

    async def get(self, cls, id_):
        return self._rows.get(id_)


def _resolve(sub, db, **kw):
    return resolve_principal(
        sub, db,
        subject_model=Subject, membership_model=Membership, organisation_model=Organisation,
        organisation_role_model=OrganisationRole, role_model=Role, **kw,
    )


SUBJECT = SimpleNamespace(id=uuid.uuid4(), sub="alice", email="a@x", display_name="Alice")
ORG = SimpleNamespace(id=uuid.uuid4(), name="Byborre", removed_at=None)
MEMBERSHIP = SimpleNamespace(id=uuid.uuid4(), subject_id=SUBJECT.id, organisation_id=ORG.id)


async def test_no_identity_is_anonymous_public():
    p = await _resolve(None, FakeDb())
    assert p["anonymous"] is True
    assert p["roles"] == ["public"] and p["role"] == "public"
    assert p["organisation"] is None and p["subject"] is None


async def test_anonymous_role_is_configurable_never_privileged(monkeypatch):
    monkeypatch.setenv("RBAC_ANONYMOUS_ROLE", "guest")
    assert (await _resolve(None, FakeDb()))["roles"] == ["guest"]
    monkeypatch.delenv("RBAC_ANONYMOUS_ROLE")
    assert (await _resolve(None, FakeDb(), anonymous="visitor"))["roles"] == ["visitor"]


async def test_unknown_subject_falls_back():
    p = await _resolve("ghost", FakeDb([None]))
    assert p["anonymous"] and p["roles"] == ["public"] and p["sub"] == "ghost"
    assert "unknown" in p["reason"]


async def test_unlinked_subject_falls_back_but_is_identified():
    p = await _resolve("alice", FakeDb([SUBJECT, None]))
    assert p["anonymous"] and p["roles"] == ["public"]
    assert p["subject"]["sub"] == "alice" and p["organisation"] is None
    assert "not linked" in p["reason"]


async def test_linked_subject_gets_the_organisations_roles():
    db = FakeDb([SUBJECT, MEMBERSHIP, [("economic_operator",), ("laboratory",)]], rows={ORG.id: ORG})
    p = await _resolve("alice", db)
    assert p["anonymous"] is False and p["reason"] is None
    assert p["organisation"] == {"id": str(ORG.id), "name": "Byborre"}
    assert p["roles"] == ["economic_operator", "laboratory"]
    assert p["role"] == "economic_operator"  # compat: first role
    assert principal_roles(p) == ["economic_operator", "laboratory"]


async def test_organisation_without_roles_gets_the_anonymous_floor():
    db = FakeDb([SUBJECT, MEMBERSHIP, []], rows={ORG.id: ORG})
    p = await _resolve("alice", db)
    assert p["roles"] == ["public"] and p["organisation"] is not None
    assert "no active role" in p["reason"]


async def test_removed_organisation_falls_back():
    gone = SimpleNamespace(id=ORG.id, name="x", removed_at="2026-01-01")
    p = await _resolve("alice", FakeDb([SUBJECT, MEMBERSHIP], rows={ORG.id: gone}))
    assert p["anonymous"] and p["roles"] == ["public"]


async def test_make_get_principal_uses_injected_identity_source():
    async def fake_identity() -> str | None:
        return "alice"

    dep = make_get_principal(
        get_db=lambda: None, subject_model=Subject, membership_model=Membership,
        organisation_model=Organisation, organisation_role_model=OrganisationRole,
        role_model=Role, identity=fake_identity,
    )
    # the identity dependency is the seam: swapping it is the whole production switch
    params = dep.__wrapped__ if hasattr(dep, "__wrapped__") else dep
    import inspect
    sig = inspect.signature(params)
    assert sig.parameters["sub"].default.dependency is fake_identity
    db = FakeDb([SUBJECT, None])
    p = await dep(sub="alice", db=db)
    assert p["subject"]["sub"] == "alice"


# ── subjects router ──────────────────────────────────────────────────────

def _router():
    return make_subjects_router(
        get_db=lambda: None, get_principal=lambda: None,
        subject_model=Subject, membership_model=Membership, organisation_model=Organisation,
        organisation_role_model=OrganisationRole, role_model=Role,
        resource_permission_model=ResourcePermission, resource_types=["products", "organisations"],
    )


def test_router_mounts_expected_paths():
    routes = {(m, r.path) for r in _router().routes for m in r.methods}
    assert {("GET", "/subjects"), ("POST", "/subjects"), ("DELETE", "/subjects/{subject_id}"),
            ("GET", "/memberships"), ("POST", "/memberships"),
            ("DELETE", "/memberships/{membership_id}"), ("GET", "/me")} <= routes


def _handler(router, method, path):
    for r in router.routes:
        if r.path == path and method in r.methods:
            return r.endpoint
    raise LookupError(path)


async def test_me_reports_effective_permissions_union_over_roles():
    router = _router()
    me = _handler(router, "GET", "/me")
    rows = [
        SimpleNamespace(resource_type="products", role_name="authority",
                        can_list=True, can_read=True, can_create=False, can_update=False, can_delete=False),
        SimpleNamespace(resource_type="products", role_name="recycler",
                        can_list=True, can_read=True, can_create=False, can_update=True, can_delete=False),
    ]
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    db = AsyncMock()
    db.execute.return_value = result
    principal = {"sub": "a", "roles": ["authority", "recycler"], "role": "authority"}
    out = await me(db=db, principal=principal)
    assert out["permissions"]["products"] == {
        "list": True, "read": True, "create": False, "update": True, "delete": False,
    }
    # no row for either role on organisations → dev posture: allowed
    assert out["permissions"]["organisations"]["delete"] is True


async def test_create_membership_is_409_when_subject_already_linked():
    from sqlalchemy.exc import IntegrityError

    router = _router()
    create = _handler(router, "POST", "/memberships")
    from m_dpp_common.auth.router import MembershipCreate

    db = AsyncMock()
    db.add = MagicMock()  # session.add is synchronous
    db.get.side_effect = [SUBJECT, ORG]
    db.commit.side_effect = IntegrityError("x", {}, Exception())
    with pytest.raises(HTTPException) as exc:
        await create(MembershipCreate(subject_id=SUBJECT.id, organisation_id=ORG.id), db=db)
    assert exc.value.status_code == 409
    db.rollback.assert_awaited()


# ── engine: union over several roles ─────────────────────────────────────

def _engine():
    return RbacEngine(
        attr_permission_model=AttrPermission, resource_permission_model=ResourcePermission, role_model=Role,
    )


class SeqDb:
    def __init__(self, *payloads):
        self._q = list(payloads)
        self.execute = AsyncMock(side_effect=self._next)

    async def _next(self, stmt):
        payload = self._q.pop(0)
        r = MagicMock()
        r.scalar_one_or_none.return_value = payload
        r.scalars.return_value.all.return_value = payload if isinstance(payload, list) else []
        return r


ACTIVE_A = SimpleNamespace(name="authority", active=True)
ACTIVE_R = SimpleNamespace(name="recycler", active=True)


async def test_resource_gate_allows_if_any_role_allows():
    rows = [
        SimpleNamespace(role_name="authority", can_update=False),
        SimpleNamespace(role_name="recycler", can_update=True),
    ]
    db = SeqDb(ACTIVE_A, ACTIVE_R, rows)
    await _engine().check_resource_permission({"roles": ["authority", "recycler"]}, "update", "products", db)


async def test_resource_gate_denies_if_every_role_denies():
    rows = [
        SimpleNamespace(role_name="authority", can_update=False),
        SimpleNamespace(role_name="recycler", can_update=False),
    ]
    db = SeqDb(ACTIVE_A, ACTIVE_R, rows)
    with pytest.raises(HTTPException) as exc:
        await _engine().check_resource_permission({"roles": ["authority", "recycler"]}, "update", "products", db)
    assert exc.value.status_code == 403


async def test_resource_gate_skips_inactive_roles_but_needs_one():
    db = SeqDb(None, SimpleNamespace(name="recycler", active=False))
    with pytest.raises(HTTPException) as exc:
        await _engine().check_resource_permission({"roles": ["ghost", "recycler"]}, "read", "products", db)
    assert exc.value.status_code == 403


async def test_attr_filter_is_intersection_of_denials():
    # authority may not read a,b ; recycler may not read b,c → only b is hidden
    db = SeqDb(["a", "b"], ["b", "c"])
    out = await _engine().filter_readable_attrs(
        {"a": 1, "b": 2, "c": 3}, ["authority", "recycler"], db, entity_type="products"
    )
    assert out == {"a": 1, "c": 3}


async def test_single_role_string_still_works():
    db = SeqDb(["a"])
    out = await _engine().filter_readable_attrs({"a": 1, "b": 2}, "public", db, entity_type="products")
    assert out == {"b": 2}
