<!-- ============================================================= -->
<!-- SHARED SYSTEM CONTEXT — keep this block ~identical across all  -->
<!-- repos' CLAUDE.md. It is short and stable. Repo-specific detail -->
<!-- goes BELOW this block, per repo. Update all copies together    -->
<!-- if a system-wide fact changes.                                 -->
<!-- ============================================================= -->

# mDPP — system context

Molecular Digital Product Passport: a **verifiable textile DPP** where the fibre composition a
manufacturer *declares* is checked against what a laboratory *molecularly analyses*. The
declared-vs-evidenced gap is the contribution. (HvA Responsible AI Lab + Fashion Technology; HAN
lab; partners Byborre, Candour, New Order of Fashion.)

**Four components, independently deployable:**
- **dpp-app** — reference DPP: product identity + hierarchy + generic attrs. Agnostic of
  composition. A single **`Product`** entity (model/variant/batch/item collapsed; level derived
  from the GS1 path). NOT "the core".
- **mdpp-app** — the molecular extension (the contribution): declarations + tests/results.
  **Flat & hierarchy-agnostic**, keyed by GS1 path; attaches to ANY DPP.
- **passport-app** — the **concentrator/viewer**: merges DPP + mDPP, applies hierarchy *if present*,
  compares declared vs. tested across levels.
- **mdpp-common** — shared library: the **organisation** entity, the **RBAC** engine + roles, and
  the OIDC/JWT auth seam. Imports neither app; entity-agnostic.

**System-wide rules:**
- Services share **standards** (GS1 identifiers, OIDC, JSON-LD/CIRPASS vocab) and the **library** —
  **never runtime calls between services**. mdpp has no runtime dependency on dpp.
- **Hierarchy lives in dpp-app; mdpp is flat; the concentrator applies hierarchy if present.**
- Products are referenced across services by **GS1 path**; internally each app keys by surrogate UUID.
- **JSON-LD** is added at the serialization boundary only.
- Vocabulary priority: **schema.org → GS1 Web Vocab → CIRPASS-2 `dpp:` → `mdpp:`** (gaps only).
- Organisations: identity = UUID; **GLN optional (in attrs)**; type from **assigned roles** (no
  `operator_type`); RBAC keys on organisation **internal id**, never GLN.

**Superseded system-wide — do NOT reintroduce:** four separate model/variant/batch/item
entities/tables · a stored `granularity`/`level` column · GS1 path as a primary key · horizontal
inheritance · a Ticket entity · a replicated tree / `inherited_from` **in mdpp** · inheritance logic
inside mdpp · mdpp writing into dpp · a separate Laboratory entity · `operator`/`operator_type` ·
GLN as a required column or an RBAC key · level in the RBAC key.

<!-- =============== END SHARED SYSTEM CONTEXT =============== -->

---

# mdpp-common — repo context

> This repo = the **shared library** used by dpp-app and mdpp-app. It owns the **organisation**
> entity, the **RBAC** engine + roles, and the **OIDC/JWT auth** seam. It **imports neither app** and
> must stay **entity-agnostic** (it operates on `(entity_type, attribute)` + stored role data, not on
> any app's specific models). Changes here ripple to both apps — if a change would force a client-app
> change, flag it before doing it.

## Organisation entity
- Identity = surrogate **UUID id**. **GLN optional, stored in `attrs`** (a lab may have none).
- **Type comes from assigned roles, not an `operator_type`** (removed).
- Each consuming app has its OWN organisation table (same shape, separate data); they correspond via
  **OAuth identity** (`sub`), not a service link.
- RBAC references organisations by **internal id**, never GLN.
- **User<->organisation:** OAuth gives the user (`sub`); a membership table links `sub -> organisation`.
  **A user represents an organisation; the organisation's role is the authority.** No per-user
  roles for MVP. `get_principal`: token -> sub -> organisation (+ roles).

## Roles — DYNAMIC (data, not hardcoded)
Roles are **stored records**, addable at runtime; not a fixed enum. Seed the known ones idempotently
(`public, end_user_professional, recycler, supply_chain_professional, authority, economic_operator,
laboratory`) as seed data. The dashboard renders role columns **dynamically** from stored roles.
Admin endpoints: list/create/deactivate roles. Minimal, clearly-marked special-casing is acceptable
only where genuinely required (e.g. economic-operator identification).
Roles are **actor identities**; access lives in the permission engine, not in role names.

## RBAC — two layers
1. **Resource-level** gate: role x resource-type (e.g. `product`, `organisation`) x operation.
2. **Attribute-level** filter: **keyed on `(entity_type, attribute)`** — entity_type is coarse
   (`product`, `organisation`), **NOT** a granularity level. Strips unreadable keys from responses;
   **rejects (403) writes that name an unwritable key** — never silently drops them. PATCH merges
   `attrs` onto the stored bag (`null` removes a key), so unnamed keys are never touched.
- **Resolve inheritance FIRST, then apply the attribute filter** (a rule follows an attribute
  through inheritance; do not filter per-level then merge).
- **Attributes are admin-addable per entity_type** — including **computed/derived** fields that are
  never stored (e.g. `parent_gs1_path`, `level`). Auto-discovery from stored data stays as a
  convenience but must coexist with, and never delete, manually-added attributes.
- Dashboard: dynamic roles; attributes per entity_type incl. manual/computed; add-role and
  add-attribute actions; per-attribute read/write per role.

### Why RBAC is shaped this way (history)
Originally keyed per entity = per **level** (model/variant/batch/item) -> broke inheritance (a
Model attribute lost its rule when inherited by a Variant). Removing the entity fixed that but
collided same-named attributes across entities. With dpp-app's four levels now a single `product`
entity, keying on **entity_type** is safe: inheritance resolves within the one product entity
(level-agnostic), so rules aren't fragmented by level, and entity_type only separates *different*
entities.

## Conventions
Async SQLAlchemy 2.0 + asyncpg; Alembic; Pydantic; FastAPI. Any schema change -> a migration
(shown before applying), migrating existing role/permission data without loss. Keep the engine
entity-agnostic.

## Decisions log (mdpp-common)
- RBAC attribute key = `(entity_type, attribute)`; entity_type = product/organisation, not level.
- Roles are dynamic stored data (dashboard renders them dynamically); not hardcoded.
- Attributes admin-addable per entity_type, incl. computed/never-stored fields; discovery coexists.
- Resolve inheritance first, then filter.
- operator -> organisation; GLN optional in attrs; type from roles; RBAC keys on internal id.
- User represents an organisation; org's role is the authority (no per-user roles for MVP).
- 2026-09-11: write-side attribute RBAC *rejects* (403, naming the keys) instead of silently
  filtering; PATCH `attrs` merges (null removes a key) and never replaces the bag — replacing let
  any role with update rights erase keys it could not write. `assert_writable_attrs` +
  `orm.apply_attrs_patch`; `filter_writable_attrs` kept as legacy only.
- (Append new mdpp-common decisions here.)

## Open questions
- Whether any mdpp data is non-public (decides how much read-RBAC mdpp needs).
- One organisation per user, or several.
