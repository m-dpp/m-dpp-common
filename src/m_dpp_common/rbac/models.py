"""Base-agnostic mixins for the RBAC tables. Each service binds them to its own
DeclarativeBase with a one-line subclass, e.g.::

    class Role(RoleMixin, Base): pass

The mixins carry ``__tablename__`` and ``__table_args__`` so the subclass stays empty.

Shape (v0.7):

- ``roles`` — roles are **data**, addable at runtime (``active`` deactivates one).
- ``rbac_attributes`` — the registry of governable attributes per ``entity_type``,
  whether *discovered* from stored ``attrs`` or registered *manually* (computed
  fields such as a product's ``level`` never appear in stored data).
- ``attr_permissions`` — one rule per ``(entity_type, attr_key, role_name)``.
- ``resource_permissions`` — one row per ``(resource_type, role_name)``.
- ``organisation_roles`` — which roles an organisation holds.

``entity_type`` is an opaque string chosen by the service (e.g. ``"products"``);
it is coarse — an entity, never a granularity level.
"""

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

# NOTE: every ``__table_args__`` below is a ``declared_attr`` so each service's
# subclass gets *fresh* Constraint objects — a constraint instance can only belong
# to one Table, and several services (and the test suite) bind these mixins.

ATTR_ORIGIN_DISCOVERED = "discovered"
ATTR_ORIGIN_MANUAL = "manual"


class RoleMixin:
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )


class RbacAttributeMixin:
    """The registry of attributes an admin can set permissions on, per entity type.

    ``origin`` is ``discovered`` (found in stored ``attrs`` by sync) or ``manual``
    (registered by an admin — e.g. a computed response field). Sync never removes
    rows; only a manual row can be deleted through the admin API.
    """

    __tablename__ = "rbac_attributes"

    @declared_attr.directive
    def __table_args__(cls):
        return (UniqueConstraint("entity_type", "attr_key", name="uq_rbac_attribute"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    attr_key: Mapped[str] = mapped_column(String, nullable=False)
    origin: Mapped[str] = mapped_column(String, nullable=False, default=ATTR_ORIGIN_MANUAL)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")


class AttrPermissionMixin:
    """Attribute ACL: one rule per ``(entity_type, attr_key, role_name)``.

    Keyed on the *entity type* (coarse), not on a granularity level: inheritance
    is resolved first, within the entity, and the filter is applied to the
    resolved result — so a rule follows an attribute through inheritance.
    Rows follow their registry entry and their role (``ON DELETE CASCADE``).
    """

    __tablename__ = "attr_permissions"

    @declared_attr.directive
    def __table_args__(cls):
        return (
            UniqueConstraint("entity_type", "attr_key", "role_name", name="uq_attr_permission"),
            ForeignKeyConstraint(
                ["entity_type", "attr_key"],
                ["rbac_attributes.entity_type", "rbac_attributes.attr_key"],
                ondelete="CASCADE",
                name="fk_attr_permissions_attribute",
            ),
        )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    attr_key: Mapped[str] = mapped_column(String, nullable=False)
    role_name: Mapped[str] = mapped_column(
        String, ForeignKey("roles.name", ondelete="CASCADE"), nullable=False
    )
    can_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_write: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class OrganisationRoleMixin:
    """Which roles an organisation holds. An organisation's *nature* (manufacturer,
    laboratory, authority…) is expressed here and nowhere else.

    Keyed on the organisation's surrogate ``id``, not its GLN: a GLN is optional
    (it lives in ``organisations.attrs["gln"]``) and so cannot be a reliable key.
    """

    __tablename__ = "organisation_roles"

    @declared_attr.directive
    def __table_args__(cls):
        return (UniqueConstraint("organisation_id", "role_name", name="uq_organisation_role"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organisations.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_name: Mapped[str] = mapped_column(
        String, ForeignKey("roles.name", ondelete="CASCADE"), nullable=False
    )


class ResourcePermissionMixin:
    __tablename__ = "resource_permissions"

    @declared_attr.directive
    def __table_args__(cls):
        return (UniqueConstraint("resource_type", "role_name", name="uq_resource_permission"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resource_type: Mapped[str] = mapped_column(String, nullable=False)
    role_name: Mapped[str] = mapped_column(
        String, ForeignKey("roles.name", ondelete="CASCADE"), nullable=False
    )
    can_list: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_create: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_update: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
