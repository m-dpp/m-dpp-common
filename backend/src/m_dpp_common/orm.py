"""Base-agnostic SQLAlchemy 2.0 mixins.

Combine with a service-local ``DeclarativeBase``:

    class MyEntity(EntityMixin, Base):
        __tablename__ = "my_entities"
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column


class UUIDPkMixin:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SoftDeleteMixin:
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AttrsMixin:
    # Open-ended JSONB bag. In services that use inheritance this holds deltas only.
    attrs: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class EntityMixin(UUIDPkMixin, TimestampMixin, SoftDeleteMixin, AttrsMixin):
    """UUID PK + created/updated timestamps + soft-delete marker + an ``attrs`` bag."""


def apply_attrs_patch(stored: dict | None, patch: dict) -> dict:
    """Merge a PATCH body's ``attrs`` onto the stored bag.

    Keys in ``patch`` are set; a key whose value is ``None`` is removed; keys not
    named in ``patch`` are left untouched. A PATCH must never *replace* the bag —
    that would let any caller with resource-level update rights erase attributes
    they hold no write permission on. Run ``assert_writable_attrs`` on ``patch``
    (not on the merged result) so the check covers exactly the keys being changed.
    """
    merged = dict(stored or {})
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged
