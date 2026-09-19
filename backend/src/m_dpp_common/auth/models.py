"""Base-agnostic mixins for the identity side of the auth seam.

Each consuming service binds them to its own DeclarativeBase (one-line
subclasses, like the organisation and RBAC mixins) and owns the rows::

    class Subject(SubjectMixin, Base): pass
    class Membership(MembershipMixin, Base): pass

- ``subjects`` — one row per known identity. ``sub`` is the OAuth/OIDC subject
  identifier and is unique. Until a real identity provider is wired in,
  subjects are created by hand through the subjects router.
- ``memberships`` — links a subject to the **one** organisation it represents
  (``subject_id`` is unique). The organisation's roles are the subject's
  authority; there are no per-user roles.

Services correspond across apps only through the shared ``sub`` value — never
through a shared table.
"""

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from m_dpp_common.orm import TimestampMixin, UUIDPkMixin


class SubjectMixin(UUIDPkMixin, TimestampMixin):
    __tablename__ = "subjects"

    sub: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)


class MembershipMixin(UUIDPkMixin, TimestampMixin):
    __tablename__ = "memberships"

    @declared_attr.directive
    def __table_args__(cls):
        # one organisation per subject
        return (UniqueConstraint("subject_id", name="uq_membership_subject"),)

    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False
    )
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False
    )
