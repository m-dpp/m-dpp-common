"""Base-agnostic mixins for the RBAC tables. Each service binds them to its own
DeclarativeBase with a one-line subclass, e.g.::

    class Role(RoleMixin, Base): pass

The mixins carry ``__tablename__`` and ``__table_args__`` so the subclass stays empty.
"""

import uuid

from sqlalchemy import Boolean, String, UniqueConstraint
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


class OperatorRoleMixin:
    __tablename__ = "operator_roles"
    __table_args__ = (UniqueConstraint("operator_gln", "role_name", name="uq_operator_role"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_gln: Mapped[str] = mapped_column(String, nullable=False)
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
