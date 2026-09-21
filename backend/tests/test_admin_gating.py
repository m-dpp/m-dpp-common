"""The RBAC admin router passes the resource gate; reference reads stay open;
nested per-resource-type defaults in seed_rbac.

The subjects-router half of this file moved to m-dpp-identity with the router
itself — identities and memberships live there now.
"""

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from m_dpp_common.orm import EntityMixin
from m_dpp_common.rbac import (
    JRC_ROLES,
    AttrPermissionMixin,
    OrganisationRoleMixin,
    RbacAttributeMixin,
    ResourcePermissionMixin,
    RoleMixin,
    make_rbac_router,
)
from m_dpp_common.rbac.seed import _defaults_for


class Base(DeclarativeBase):
    pass


class Thing(EntityMixin, Base):
    """Stands in for an app's own attrs-bearing entity (a product, a declaration)."""

    __tablename__ = "things"
    name: Mapped[str] = mapped_column(nullable=False)


class Role(RoleMixin, Base): pass
class RbacAttribute(RbacAttributeMixin, Base): pass
class AttrPermission(AttrPermissionMixin, Base): pass
class OrganisationRole(OrganisationRoleMixin, Base): pass
class ResourcePermission(ResourcePermissionMixin, Base): pass


class DenyAllEngine:
    """Records every gate call and refuses it."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []

    async def check_resource_permission(self, principal, action, resource_type, db):
        self.calls.append((action, resource_type))
        raise HTTPException(status_code=403, detail=f"denied {action} {resource_type}")


async def _get_db():
    yield AsyncMock()


async def _principal():
    return {"sub": None, "roles": ["public"], "role": "public"}


def _app(engine=None):
    app = FastAPI()
    app.include_router(make_rbac_router(
        get_db=_get_db, role_model=Role, attr_permission_model=AttrPermission,
        attribute_model=RbacAttribute, organisation_role_model=OrganisationRole,
        resource_permission_model=ResourcePermission, resource_tables={"things": Thing},
        **({"get_principal": _principal, "rbac_engine": engine} if engine else {}),
    ))
    return app


@pytest.mark.parametrize("method,path,expected", [
    ("POST", "/admin/rbac/roles", ("create", "rbac")),
    ("PATCH", "/admin/rbac/roles/public", ("update", "rbac")),
    ("GET", "/admin/rbac/attributes", ("read", "rbac")),
    ("POST", "/admin/rbac/attributes", ("create", "rbac")),
    ("DELETE", "/admin/rbac/attributes/00000000-0000-0000-0000-000000000000", ("delete", "rbac")),
    ("POST", "/admin/rbac/sync-attrs", ("create", "rbac")),
    ("GET", "/admin/rbac/permissions", ("read", "rbac")),
    ("PATCH", "/admin/rbac/permissions/00000000-0000-0000-0000-000000000000", ("update", "rbac")),
    ("GET", "/admin/rbac/resource-permissions", ("read", "rbac")),
    ("PATCH", "/admin/rbac/resource-permissions/00000000-0000-0000-0000-000000000000", ("update", "rbac")),
    ("POST", "/admin/rbac/organisation-roles", ("create", "rbac")),
    ("DELETE", "/admin/rbac/organisation-roles/00000000-0000-0000-0000-000000000000", ("delete", "rbac")),
])
def test_gated_endpoints_hit_the_resource_gate(method, path, expected):
    engine = DenyAllEngine()
    client = TestClient(_app(engine))
    res = client.request(method, path, json={})
    assert res.status_code == 403, (path, res.status_code, res.text)
    assert engine.calls == [expected]


@pytest.mark.parametrize(
    "path", ["/admin/rbac/entity-types", "/admin/rbac/roles", "/admin/rbac/organisation-roles"]
)
def test_reference_reads_stay_open(path):
    """No gate call at all for what the role labels and the switcher need.
    (The handlers themselves then fail on the mocked db — we only assert the gate.)"""
    engine = DenyAllEngine()
    client = TestClient(_app(engine), raise_server_exceptions=False)
    client.get(path)
    assert engine.calls == []


def test_router_without_engine_is_open():
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/admin/rbac/attributes").status_code != 403


def test_administrator_is_a_seeded_role():
    assert "administrator" in {name for name, *_ in JRC_ROLES}


def test_nested_resource_defaults():
    flat = dict(can_list=True, can_read=True, can_create=False, can_update=False, can_delete=False)
    assert _defaults_for(flat, "anything") is flat
    nested = {"things": {"can_list": True}, "*": {"can_list": False}}
    assert _defaults_for(nested, "things") == {"can_list": True}
    assert _defaults_for(nested, "rbac") == {"can_list": False}
    assert _defaults_for({"things": {"can_list": True}}, "rbac")["can_create"] is False  # library default
    assert _defaults_for(None, "x")["can_read"] is True
