"""Schema helpers for a consuming service.

Two live here: :func:`ensure_rbac_columns`, an additive step a service runs at
boot right after ``create_all`` (which creates missing TABLES but never alters an
existing one — so a column the library adds later would be missing on every
installation that already has data); and :func:`reset_rbac_tables`, for an
Alembic revision that adopts a breaking shape by dropping and recreating.

Reset the RBAC tables (the original helper):

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


# ------------------------------------------------------------------ additive

#: (table, column, SQL type) the library has added to a mixin after a table may
#: already exist somewhere. Append here; never edit or reorder — every entry is
#: replayed on every boot and must stay idempotent (``IF NOT EXISTS``).
ADDITIVE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("rbac_attributes", "removed_at", "TIMESTAMPTZ"),
)


def ensure_rbac_columns(conn) -> None:
    """Add any column the mixins gained since a table was created. Idempotent.

    Run it synchronously on a connection, after ``create_all``::

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(ensure_rbac_columns)

    PostgreSQL only (``ADD COLUMN IF NOT EXISTS``), like the rest of the library.
    """
    for table, column, sql_type in ADDITIVE_COLUMNS:
        conn.execute(
            text(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{column}" {sql_type}')
        )
