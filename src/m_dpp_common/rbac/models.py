"""Base-agnostic mixins for the RBAC tables. Each service binds them to its own
DeclarativeBase with a one-line subclass, e.g.::

    class Role(RoleMixin, Base): pass

The mixins carry ``__tablename__`` and ``__table_args__`` so the subclass stays empty.
"""

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class RoleMixin:
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")


class AttrPermissionMixin:
    """Flat attribute ACL: one rule per (attr_key, role_name), applied wherever the
    key appears. `attrs` is a single override-inherited key namespace, so the ACL
    mirrors that shape — it is NOT scoped per resource type. (The resource-level
    gate, `ResourcePermissionMixin`, still is per resource type.)"""

    __tablename__ = "attr_permissions"
    __table_args__ = (
        UniqueConstraint("attr_key", "role_name", name="uq_attr_permission"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    attr_key: Mapped[str] = mapped_column(String, nullable=False)
    role_name: Mapped[str] = mapped_column(String, nullable=False)
    can_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_write: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class OrganisationRoleMixin:
    """Which roles an organisation holds. An organisation's *nature* (manufacturer,
    laboratory, authority…) is expressed here and nowhere else.

    Keyed on the organisation's surrogate ``id``, not its GLN: a GLN is optional
    (it lives in ``organisations.attrs["gln"]``) and so cannot be a reliable key.
    """

    __tablename__ = "organisation_roles"
    __table_args__ = (
        UniqueConstraint("organisation_id", "role_name", name="uq_organisation_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organisations.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_name: Mapped[str] = mapped_column(String, nullable=False)


class ResourcePermissionMixin:
    __tablename__ = "resource_permissions"
    __table_args__ = (
        UniqueConstraint("resource_type", "role_name", name="uq_resource_permission"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resource_type: Mapped[str] = mapped_column(String, nullable=False)
    role_name: Mapped[str] = mapped_column(String, nullable=False)
    can_list: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_create: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_update: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
