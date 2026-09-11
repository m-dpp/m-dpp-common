from sqlalchemy import ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.rbac import (
    AttrPermissionMixin,
    OrganisationRoleMixin,
    RbacAttributeMixin,
    ResourcePermissionMixin,
    RoleMixin,
)
from m_dpp_common.rbac.migration import RBAC_TABLES


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


def _uniques(table):
    return {tuple(c.name for c in u.columns) for u in table.constraints if isinstance(u, UniqueConstraint)}


def test_roles_are_data():
    cols = set(Role.__table__.columns.keys())
    assert {"name", "label", "description", "active", "sort_order"} <= cols


def test_attribute_registry_unique_per_entity_and_key():
    assert ("entity_type", "attr_key") in _uniques(RbacAttribute.__table__)


def test_attr_permission_keyed_on_entity_attr_role():
    assert ("entity_type", "attr_key", "role_name") in _uniques(AttrPermission.__table__)
    fks = [c for c in AttrPermission.__table__.constraints if isinstance(c, ForeignKeyConstraint)]
    targets = {tuple(e.target_fullname for e in fk.elements) for fk in fks}
    assert ("rbac_attributes.entity_type", "rbac_attributes.attr_key") in targets
    assert ("roles.name",) in targets


def test_all_rbac_tables_bound_and_in_reset_list():
    assert set(RBAC_TABLES) == {
        "roles", "rbac_attributes", "attr_permissions", "resource_permissions", "organisation_roles"
    }
    assert set(RBAC_TABLES) <= set(Base.metadata.tables)
