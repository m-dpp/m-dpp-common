from types import SimpleNamespace

import pytest
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


def test_router_exposes_dynamic_endpoints():
    router = make_rbac_router(
        get_db=lambda: None,
        role_model=Role,
        attr_permission_model=AttrPermission,
        attribute_model=RbacAttribute,
        organisation_role_model=OrganisationRole,
        resource_permission_model=ResourcePermission,
        resource_tables={"products": _model("products"), "organisations": _model("organisations")},
        resource_types=["products", "organisations", "declarations"],
    )
    paths = {(r.path, tuple(sorted(r.methods))) for r in router.routes}
    assert ("/admin/rbac/roles", ("GET",)) in paths
    assert ("/admin/rbac/roles", ("POST",)) in paths
    assert ("/admin/rbac/roles/{name}", ("PATCH",)) in paths
    assert ("/admin/rbac/attributes", ("GET",)) in paths
    assert ("/admin/rbac/attributes", ("POST",)) in paths
    assert ("/admin/rbac/attributes/{attribute_id}", ("DELETE",)) in paths
    assert ("/admin/rbac/entity-types", ("GET",)) in paths
    assert ("/admin/rbac/sync-attrs", ("POST",)) in paths


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
