"""Base-agnostic Organisation table. Each service binds it to its own
DeclarativeBase with a one-line subclass::

    class Organisation(OrganisationMixin, Base): pass

An Organisation is any party in the supply chain — manufacturer, recycler,
laboratory, authority. Its *nature is determined solely by the roles assigned to
it* in ``organisation_roles``; there is no type column and no ``operator_type``
attribute.

It carries the UUID PK, timestamps, soft-delete marker and open-ended ``attrs``
bag from :class:`m_dpp_common.orm.EntityMixin`. A **GLN is optional and lives in
``attrs["gln"]``** — not every organisation is a GS1 member (a laboratory
typically is not), so it is not a first-class column. The partial unique index
below still keeps GLNs unique among the organisations that declare one.

The mixin carries ``__tablename__`` / ``__table_args__`` so the service subclass
stays empty (same shape as the RBAC mixins in :mod:`m_dpp_common.rbac.models`).
"""

from sqlalchemy import Index, String, text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from m_dpp_common.orm import EntityMixin


class OrganisationMixin(EntityMixin):
    __tablename__ = "organisations"

    # declared_attr so every binding (each service, the test suite) gets a fresh
    # Index object — an Index instance can only belong to one Table.
    @declared_attr.directive
    def __table_args__(cls):
        return (
            Index(
                "uq_organisations_gln",
                text("(attrs->>'gln')"),
                unique=True,
                # jsonb_exists(...) rather than the `?` operator — `?` collides with
                # driver paramstyles when the DDL round-trips through SQLAlchemy.
                postgresql_where=text("jsonb_exists(attrs, 'gln')"),
            ),
        )

    name: Mapped[str] = mapped_column(String, nullable=False)

    # A stable key for the SAME organisation across services.
    #
    # Each app owns its own `organisations` table with its own UUIDs, so an id
    # means nothing outside the app that issued it. Until now the only thing
    # that crossed the boundary was the subject's `sub` — which is enough to say
    # *who* a user is, but not *which organisation* they are acting for. A
    # front-end talking to two services (dpp-app's Molecular tab) has to name the
    # same organisation to both, and a UUID cannot do that.
    #
    # It is NOT an RBAC key and not an identifier of record: internally
    # everything still keys on `id`, and a GLN stays optional in `attrs`. This is
    # purely a correspondence name, chosen by whoever seeds the deployment, and
    # nullable because an organisation that exists in one service only does not
    # need one.
    external_key: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
