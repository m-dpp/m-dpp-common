"""Base-agnostic Operator table. Each service binds it to its own DeclarativeBase
with a one-line subclass::

    class Operator(OperatorMixin, Base): pass

An Operator anchors a GS1 party (a GLN). It carries the UUID PK, timestamps,
soft-delete marker and open-ended ``attrs`` bag from
:class:`m_dpp_common.orm.EntityMixin`; RBAC's ``operator_roles.operator_gln``
points at ``gln``.

The mixin carries ``__tablename__`` so the service subclass stays empty (same
shape as the RBAC mixins in :mod:`m_dpp_common.rbac.models`).
"""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from m_dpp_common.orm import EntityMixin


class OperatorMixin(EntityMixin):
    __tablename__ = "operators"

    gln: Mapped[str] = mapped_column(String(13), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
