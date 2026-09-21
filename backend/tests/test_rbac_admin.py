from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.rbac import (
    AttrPermissionMixin,
    OrganisationRoleMixin,
    RbacAttributeMixin,
    ResourcePermissionMixin,
    RoleMixin,
    make_rbac_router,
)
from m_dpp_common.rbac.admin import AttributeCreate, RoleCreate, _attr_keys_sql


class Base(DeclarativeBase):
    pass


class Role(RoleMixin, Base):
    pass


class RbacAttribute(RbacAttributeMixin, Base):
    pass


class AttrPermission(AttrPermissionMixin, Base):
    pass


class OrganisationRole(OrganisationRoleMixin, Base):
    pass


class ResourcePermission(ResourcePermissionMixin, Base):
    pass


def _model(table):
    return SimpleNamespace(__tablename__=table)


def test_attr_keys_sql_is_per_table():
    sql = str(_attr_keys_sql("products"))
    assert "jsonb_object_keys(attrs)" in sql
    assert "FROM products WHERE jsonb_typeof(attrs) = 'object'" in sql


def test_attr_keys_sql_rejects_unsafe_table():
    with pytest.raises(ValueError):
        _attr_keys_sql("products; drop table roles")


def _paths(router):
    """Every (path, method) the router actually serves.

    Read from the OpenAPI schema of an app the router is mounted on, rather than
    from `router.routes`: roles and organisation-roles sit on sub-routers (so a
    service without those tables can leave them out), and how FastAPI represents
    an included router internally is not this test's business — what it serves is.
    """
    app = FastAPI()
    app.include_router(router)
    return {
        (path, (method.upper(),))
        for path, ops in app.openapi()["paths"].items()
        for method in ops
    }


def _router(**kw):
    return make_rbac_router(
        get_db=lambda: None,
        role_model=Role,
        attr_permission_model=AttrPermission,
        attribute_model=RbacAttribute,
        organisation_role_model=OrganisationRole,
        resource_permission_model=ResourcePermission,
        resource_tables={"products": _model("products"), "organisations": _model("organisations")},
        resource_types=["products", "organisations", "declarations"],
        **kw,
    )


def test_router_exposes_dynamic_endpoints():
    paths = _paths(_router())
    assert ("/admin/rbac/roles", ("GET",)) in paths
    assert ("/admin/rbac/roles", ("POST",)) in paths
    assert ("/admin/rbac/roles/{name}", ("PATCH",)) in paths
    assert ("/admin/rbac/organisation-roles", ("GET",)) in paths
    assert ("/admin/rbac/organisation-roles", ("POST",)) in paths
    assert ("/admin/rbac/attributes", ("GET",)) in paths
    assert ("/admin/rbac/attributes", ("POST",)) in paths
    assert ("/admin/rbac/attributes/{attribute_id}", ("DELETE",)) in paths
    assert ("/admin/rbac/entity-types", ("GET",)) in paths
    assert ("/admin/rbac/sync-attrs", ("POST",)) in paths


def test_a_service_without_a_roles_table_leaves_those_endpoints_out():
    """Roles and their assignments live in m-dpp-identity. An app that mounts
    this router has the attribute and resource matrices — which ARE per app —
    and no `roles` table to serve."""
    paths = _paths(_router(include_roles=False, include_organisation_roles=False))
    assert not [p for p, _ in paths if "/roles" in p]
    # the per-app matrices are untouched
    assert ("/admin/rbac/permissions", ("GET",)) in paths
    assert ("/admin/rbac/resource-permissions", ("GET",)) in paths
    assert ("/admin/rbac/entity-types", ("GET",)) in paths


@pytest.mark.parametrize("name", ["auditor", "data_steward", "r2"])
def test_role_name_slug_ok(name):
    assert RoleCreate(name=name).name == name


@pytest.mark.parametrize("name", ["Auditor", "a", "has space", "dash-ed", "*"])
def test_role_name_slug_rejected(name):
    with pytest.raises(ValidationError):
        RoleCreate(name=name)


def test_attribute_key_validation():
    assert AttributeCreate(entity_type="products", attr_key=" level ").attr_key == "level"
    with pytest.raises(ValidationError):
        AttributeCreate(entity_type="products", attr_key="*")
    with pytest.raises(ValidationError):
        AttributeCreate(entity_type="products", attr_key="")
