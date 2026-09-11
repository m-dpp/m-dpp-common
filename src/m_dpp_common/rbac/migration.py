"""Helper for a consuming service's Alembic revision: reset the RBAC tables.

The library owns the *shape* of the RBAC tables (the mixins) but each service
owns its schema and migrations. The v0.7 shape (dynamic roles, the attribute
registry, `entity_type` on attribute rules) is introduced by **dropping and
recreating** the RBAC tables — role/permission data is seed data and is
re-created on the next boot (`seed_rbac`) + "Sync Attrs". Organisation role
assignments are dropped too; re-run the service's seed script.

Usage inside `upgrade()` of an Alembic revision::

    from m_dpp_common.rbac.migration import reset_rbac_tables
    from app.core.database import Base
    import app.models  # noqa: F401 — bind the RBAC mixins to Base first

    def upgrade():
        reset_rbac_tables(op.get_bind(), Base)
"""

from sqlalchemy import text

# Drop order: dependants first.
RBAC_TABLES: tuple[str, ...] = (
    "attr_permissions",
    "rbac_attributes",
    "resource_permissions",
    "organisation_roles",
    "roles",
)


def reset_rbac_tables(conn, base) -> None:
    """DROP (if present) and recreate every RBAC table from `base.metadata`.

    Destroys all role / permission / organisation-role data — by design (see module
    docstring). Tables the service has not bound (absent from `base.metadata`)
    are dropped but not recreated.
    """
    for table in RBAC_TABLES:
        conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
    tables = [base.metadata.tables[t] for t in RBAC_TABLES if t in base.metadata.tables]
    base.metadata.create_all(bind=conn, tables=tables)
