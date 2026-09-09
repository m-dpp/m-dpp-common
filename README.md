# m-dpp-common

Shared **infrastructure** for the mDPP services (`dpp-app`, `mdpp-app`, `passport-app`).

## Charter — what belongs here

Only cross-cutting *plumbing* that must not diverge between services:

- `m_dpp_common.gs1` — GS1 identifier validation (GTIN / GLN check digits, `derive_gln`).
- `m_dpp_common.db` — async engine / session-factory / `get_db` builders.
- `m_dpp_common.orm` — `Base`-agnostic SQLAlchemy mixins (UUID PK, timestamps, soft-delete, `attrs`).
- `m_dpp_common.auth` — the **dev auth stub** (`X-Dev-Role` header → principal). Swap for real OIDC/JWT here, once, later.
- `m_dpp_common.rbac` — the two-layer RBAC **engine** (resource gate + attribute filter), role seed data, and a parametrised admin router + dashboard.
- `m_dpp_common.operator` — the **Operator entity** (a GS1 party anchored by GLN, referenced by RBAC `operator_roles`): a `Base`-agnostic `OperatorMixin`, the `OperatorCreate` / `OperatorUpdate` schemas, and a parametrised `/operators` CRUD router. Each service binds the table to its own `Base` and mounts the router against its own database and `@context`.

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
