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
