# m-dpp-common

Shared **infrastructure** for the mDPP services (`dpp-app`, `mdpp-app`, `passport-app`).

## Charter — what belongs here

Only cross-cutting *plumbing* that must not diverge between services:

- `m_dpp_common.gs1` — GS1 identifier validation (GTIN / GLN check digits, `derive_gln`).
- `m_dpp_common.db` — async engine / session-factory / `get_db` builders.
- `m_dpp_common.orm` — `Base`-agnostic SQLAlchemy mixins (UUID PK, timestamps, soft-delete, `attrs`).
- `m_dpp_common.auth` — the **dev auth stub** (`X-Dev-Role` header → principal). Swap for real OIDC/JWT here, once, later.
- `m_dpp_common.rbac` — the two-layer RBAC **engine** (resource gate + attribute filter), role seed data, and a parametrised admin router + dashboard.
  - **Roles are data** (`roles` table: `name, label, description, active, sort_order`). The JRC list is only the initial seed; add roles at runtime via `POST /admin/rbac/roles` or the dashboard. An unknown or inactive role is refused with 403 at the resource gate. The dev auth stub no longer validates role names (`RBAC_DEFAULT_ROLE` env var sets the fallback).
  - **Attribute rules are keyed `(entity_type, attr_key, role_name)`** — `entity_type` is a coarse, service-chosen string (`"products"`, `"organisations"`, `"fibre_nodes"`), never a granularity level. **Resolve inheritance first, then filter.** No wildcards.
  - **Attribute registry** (`rbac_attributes`): attributes are *discovered* from stored `attrs` by `POST /sync-attrs` or *registered manually* via `POST /admin/rbac/attributes` (for computed fields such as a product's `level`). Sync never deletes; only manual entries can be removed.
  - Creating a role or registering an attribute **fans out** the missing permission rows (safe defaults: see/read, no writes) so the grid is always complete.
  - **Writes are rejected, not trimmed.** `assert_writable_attrs` is 403 (naming the keys) when a payload touches an attribute the role may not write. `PATCH` bodies must *merge* `attrs` onto the stored bag with `m_dpp_common.orm.apply_attrs_patch` (`null` removes a key) and run the check on the patch keys — replacing the bag lets any updater wipe protected keys. `filter_writable_attrs` (silent drop) is legacy.
  - `engine.for_entity("products")` returns the call points with the entity type bound — a service exports those from its `app/core/rbac.py`.
  - `m_dpp_common.rbac.migration.reset_rbac_tables(conn, Base)` — for a service's Alembic revision: drop + recreate the RBAC tables in the v0.7 shape (role/permission data is seed data and comes back on boot + Sync Attrs).
- `m_dpp_common.organisation` — the **Organisation entity** (any party in the supply chain): a `Base`-agnostic `OrganisationMixin`, the `OrganisationCreate` / `OrganisationUpdate` schemas, and a parametrised `/organisations` CRUD router. Each service binds the table to its own `Base` and mounts the router against its own database and `@context`.
  - An organisation's **nature comes solely from its assigned roles** (`organisation_roles`) — there is no type column or `operator_type` attribute.
  - `PATCH /organisations/{id}` merges `attrs` (send a key as `null` to remove it; `"attrs": null` is a 422). A key the role may not write is a 403.
  - A **GLN is optional and lives in `attrs["gln"]`** (a laboratory is often not a GS1 member), normalised through `m_dpp_common.gs1.validate_gln` on write and kept unique by a partial index. Look one up with `GET /organisations/by-gln/{gln}`.
  - RBAC role assignments key on the organisation's **surrogate `id`**, never the GLN.

## What must NOT come here

Anything domain-specific: the identity tree (Model/Variant/Batch/Item), inheritance
resolution, composition claims, the fibre taxonomy, per-service `@context` documents,
per-service permission *matrices* (the mechanism is shared; the policy is seeded per service).

If a change would force every service to release in lockstep for a non-infrastructure
reason, it does not belong here.

## Using it

Each service pins a tag in its `requirements.txt` and installs it during its Docker
image build (this repo is public, so it's a plain `git+https` install — no auth):

```
m-dpp-common @ git+https://github.com/m-dpp/m-dpp-common@v0.1.0
```

That is the whole integration — no submodule, no sibling checkout in the services.

## Working on this repo

```
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'      # or: pip install -e . pytest pytest-asyncio
pytest
```

## Versioning

SemVer. Bump `version` in `pyproject.toml`, tag `vX.Y.Z`, push the tag, then bump the
pin in each consuming service in its own PR — that is what keeps the services
independently deployable.
