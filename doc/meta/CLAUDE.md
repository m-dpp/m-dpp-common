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

**Four components, independently deployable, plus one shared service:**
- **dpp-app** — reference DPP: product identity + hierarchy + generic attrs. Agnostic of
  composition. A single **`Product`** entity (model/variant/batch/item collapsed; level derived
  from the GS1 path). NOT "the core".
- **mdpp-app** — the molecular extension (the contribution): declarations + tests/results.
  **Flat & hierarchy-agnostic**, keyed by GS1 path; attaches to ANY DPP.
- **passport-app** — the **concentrator/viewer**: merges DPP + mDPP, applies hierarchy *if present*,
  compares declared vs. tested across levels.
- **m-dpp-identity** — the shared **identity service**: organisations (incl. the platform
  organisation and public keys), subjects, memberships, roles + role assignments, principal
  resolution, identity audit. Backend only; its admin screens live in mdpp-common.
- **mdpp-common** — shared library: the **RBAC** engine, the platform role/permission definition,
  the **identity client** + auth seam, and the shared admin UI. Imports no app; entity-agnostic.

**System-wide rules:**
- Services share **standards** (GS1 identifiers, OIDC, JSON-LD/CIRPASS vocab) and the **library** —
  **no runtime calls between services, with ONE deliberate exception: both apps call
  m-dpp-identity.** Identity is *infrastructure* (like the database or the IdP), not a peer app.
  mdpp still has no runtime dependency on dpp, and neither app depends on the other.
- **Hierarchy lives in dpp-app; mdpp is flat; the concentrator applies hierarchy if present.**
- Products are referenced across services by **GS1 path**; internally each app keys by surrogate UUID.
- **Organisations are referenced across services by the identity service's UUID** — one id per
  organisation, system-wide. GLN stays optional (in attrs); RBAC keys on that id, never on GLN.
- **JSON-LD** is added at the serialization boundary only.
- Vocabulary priority: **schema.org → GS1 Web Vocab → CIRPASS-2 `dpp:` → `mdpp:`** (gaps only).
- Organisations: type from **assigned roles** (no `operator_type`).

**Superseded system-wide — do NOT reintroduce:** four separate model/variant/batch/item
entities/tables · a stored `granularity`/`level` column · GS1 path as a primary key · horizontal
inheritance · a Ticket entity · a replicated tree / `inherited_from` **in mdpp** · inheritance logic
inside mdpp · mdpp writing into dpp · a separate Laboratory entity · `operator`/`operator_type` ·
GLN as a required column or an RBAC key · level in the RBAC key · **per-app `organisations` /
`subjects` / `memberships` / `roles` / `organisation_roles` tables** · **`Organisation.external_key`
and any cross-app organisation reconciliation** · **`platform_definition_checksum` and the
"compare both Abouts to spot drift" safeguard** (there is one copy now, so there is no drift).

<!-- =============== END SHARED SYSTEM CONTEXT =============== -->

---

# mdpp-common — repo context

> This repo = the **shared library** used by dpp-app, mdpp-app and m-dpp-identity. It owns the
> **RBAC** engine, the platform role/permission definition, the **m-dpp-identity client** + auth
> seam, and the shared admin UI. It **imports no app** and must stay **entity-agnostic** (it
> operates on `(entity_type, attribute)` + stored role data, not on any app's specific models).
> Changes here ripple to every consumer — if a change would force a client change, flag it first.

## What LEFT this library (0.12.0)

Organisations, subjects, memberships, roles and role assignments moved to **m-dpp-identity**. They
were mixins each app bound to its own tables, so the same company existed twice with two ids; see
that repo's DESIGN §1. **Do not reintroduce them here**, and do not add a compatibility shim: an
app that still binds them is an app that has not been migrated.

Gone with them: `OrganisationMixin` · `SubjectMixin` / `MembershipMixin` · `make_organisation_router`
· `make_subjects_router` · `resolve_principal` (the local-table one) · the `X-Dev-Role` stub ·
`Organisation.external_key` · `platform_definition_checksum`.

## The identity client (`m_dpp_common.identity`)
- `IdentityClient` — typed async httpx client; `IDENTITY_API_BASE` + `IDENTITY_SERVICE_TOKEN`.
- `make_get_principal(client=...)` — the same principal dict as before, resolved over HTTP.
- **An outage is 503, never a fallback to `public`** — a fallback turns an outage into a silent
  demotion and blames the user's role.
- `PrincipalCache` — TTL (default 5s) on `(sub, acting_org)`; failures are never cached.
- `wait_for_identity` — polls `/health` at startup and **gives up without stopping the boot**.

## Roles — DYNAMIC (data, not hardcoded), and defined in identity
Roles are **stored records**, addable at runtime; not a fixed enum. `rbac/platform.py` and
`JRC_ROLES` stay here as the ONE definition identity seeds roles from and the apps seed their
default permissions from. The `roles` table itself is identity's.
An app therefore passes `include_roles=False, include_organisation_roles=False` to
`make_rbac_router`, and sets `__role_foreign_key__ = False` on its permission models — there is no
local `roles` table to reference. Roles are **actor identities**; access lives in the permission
engine, not in role names.

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
- 2026-09-19: repo split into `backend/` (Python lib, install with `#subdirectory=backend`) and
  `frontend/` (`@m-dpp/ui`, React/TS/Vite library consumed as a local `file:` package, source
  exports — no build step). Neither is an app.
- 2026-09-19: the Jinja RBAC dashboard is gone; `/admin/rbac` is JSON only. The admin UI (RBAC,
  organisations, users & links, acting-as) lives in the shared React library.
- 2026-09-19: auth seam = `SubjectMixin` + `MembershipMixin` (one organisation per subject) +
  `resolve_principal` (identity → subject → organisation → active roles). Only `dev_identity.py`
  (`X-Dev-Sub`) is temporary. No identity / unknown / unlinked → the anonymous role
  (`RBAC_ANONYMOUS_ROLE`, default `public`), never a privileged default.
- 2026-09-19: a principal carries `roles` (list); the engine applies **union** semantics (allowed
  if any held role allows; readable/writable if any may). `principal["role"]` kept as compat.
- 2026-09-19 (0.10.0): the RBAC admin router and the subjects router pass the resource gate when
  the service passes `get_principal`/`rbac_engine` (resource types `rbac` and `subjects`). Only
  `GET /subjects`, `GET /me`, `GET /admin/rbac/roles`, `/entity-types`, `/organisation-roles` stay
  open. `administrator` joins the seed role list. `seed_rbac` defaults may be nested per resource
  type with a `"*"` fallback.
- 2026-09-19 (0.10.1): AttrsEditor leaf type `image` (image link). The value stays a plain URL
  string in `attrs` (no wrapper object, no schema); it is recognised by extension or
  `data:image` URI and rendered as a thumbnail. Only http(s)/data:image sources go into `<img>`.
- 2026-09-20 (0.11.0): the project-information banner is shared (`ProjectBanner` +
  `MDPP_PROJECT`); an app passes at most ONE app-specific line (`appNote`). dpp-app's local
  copy was deleted, not duplicated.
- 2026-09-20 (0.11.0): `src/mdpp/` is the one way any front-end reaches an mdpp-app instance —
  provider + typed client, base path RELATIVE (default `/mdpp-api`, never host:port) so the host
  proxies it and stays same-origin. It reuses the shared `identityStore`, so acting-as switches
  both APIs at once. No app-specific logic: no hierarchy, no chain walking, no verdict.
- 2026-09-20 (0.11.0): `Comparison` RENDERS mdpp's comparison object and computes nothing —
  that is what stops two front-ends drifting on how a verdict is shown. `within: null` (no
  tolerance anywhere in the fibre's chain) renders neutral, never as a pass; the specificity
  sentence is printed as given, never recomposed. The wire type is `TestComparison` so it does
  not collide with the component name.
- 2026-09-20 (0.11.0): `Declarations` / `Tests` take an optional `pathScope`. Scoping HIDES the
  search controls rather than pre-filling them — the identifier is not the user's to change when
  a host pinned it. Tests and results are one screen (same thing at two moments); composition is
  edited as fibre + percentage rows, never raw JSON, and the 100% total is shown but not enforced.
- 2026-09-20 (0.11.0): `FibreTaxonomy` screen. The taxonomy is not a side screen — `legal_name`
  and `tolerance` are the two comparison inputs defined there, so both are shown RESOLVED
  (effective tolerance badged on the tree, dimmed when inherited, with the ancestor named), and a
  node with no tolerance in its chain says so rather than looking like a pass.
- 2026-09-20 (0.11.0, tenancy addendum): a subject may hold SEVERAL memberships — the old
  `uq_membership_subject` is gone, uniqueness is (subject, organisation). Roles are NEVER merged
  across them: a user acts as one organisation at a time, and with several and none chosen,
  `resolve_principal` refuses rather than defaulting (defaulting would make authority depend on row
  order). Identity and acting context are separate mechanisms: the identity source PROVES who you
  are; `X-Acting-Org` SELECTS which membership is in force and is refused unless held.
- 2026-09-20 (0.11.0): `org_admin` is a boolean on the membership, not a role — organisation roles
  say what the ORGANISATION is and would apply to every member at once.
- 2026-09-20 (0.11.0): `platform_admin` (governs definitions) and `administrator` (operates an
  installation, reads but cannot rewrite the matrices) are distinct. `rbac/platform.py` is the one
  definition both apps seed from; `platform_definition_checksum` is the cross-app comparable digest
  (the per-app `permissions_checksum` is expected to differ and cannot reveal drift).
- 2026-09-20 (0.11.0): `scoping.py` names the three scopes — owned / visible-to-role / produced.
  Owning nothing matches NOTHING, never everything. Listing depth for a caller with no ownership
  claim is `PUBLIC_LISTING_DEPTH` (`all` | `model`, default `all`); an oversight role ignores it,
  and an unrecognised value falls back to the permissive default so a config typo cannot silently
  hide data.
- This resolves the open question "one organisation per user, or several": several.
- 2026-09-20 (0.11.0): `Organisation.external_key` — a stable name for the SAME organisation across
  services. Each app owns its own table and issues its own UUIDs, so an id means nothing outside the
  app that issued it; until now only the subject's `sub` crossed the boundary, which says WHO a user
  is but not WHICH organisation they act for. A front-end talking to two services (dpp-app's
  Molecular tab) must name one organisation to both, and a UUID cannot. `resolve_principal` accepts
  either the app's own id or the key. It is NOT an RBAC key and not an identifier of record —
  everything still keys on `id` internally, GLN stays optional in `attrs` — and it is nullable,
  because an organisation existing in one service only needs none.
- 2026-09-20 (0.11.0): `requestJson` defaults BOTH the identity and the acting organisation to the
  shared store. An app-specific client that passed only the identity left a multi-membership user
  unresolved, and the 403 blamed the role ("Role(s) public not permitted") on a user who plainly
  held it. The resource gate now appends the principal's own reason when it is anonymous.
- 2026-09-20 (0.11.0): `GS1_PEDANTIC` (default **true**) enforces the GTIN check digit and the
  strict GMN character set. Opposite default to `GLN_PEDANTIC` on purpose: a GTIN becomes a
  permanent key for a passport, and the check digit is the only thing that catches a transposed
  pair of digits before it is written; a GLN names a company and is recoverable. Leniency relaxes
  ONLY the checksum and the GMN charset — never the length, the digits, or the `/ ? #` that
  structure a path — so turning it back on can never change what an existing path means. The
  compose files set it false for demos; the error message names the flag.
- 2026-09-21 (0.12.0): organisations, subjects, memberships and roles moved to **m-dpp-identity**.
  This library keeps the CLIENT for reaching it, plus the RBAC engine — whose attribute and
  resource matrices genuinely are per app. BREAKING: every consumer must rebuild `get_principal`
  from `m_dpp_common.identity` and drop the moved model bindings.
- 2026-09-21 (0.12.0): the `roles.name` foreign key on the permission mixins is OPTIONAL
  (`__role_foreign_key__ = False`). An app has no local `roles` table now, so deleting a role in
  identity no longer cascades to an app's permission rows — an orphaned row matches nothing and is
  harmless, and a cross-service cascade was never available anyway.
- 2026-09-21 (0.12.0): `make_rbac_router` gained `include_roles` / `include_organisation_roles`
  (a service with no such table leaves them out) and two hooks —
  `validate_organisation_role` and `on_organisation_role_change` — so identity can refuse an
  operating role on the platform organisation and write its audit event INSIDE the same
  transaction. The role endpoints moved onto sub-routers to make the switches possible.
- 2026-09-21 (0.12.0): `PrincipalProvider` MERGES the permissions of two `/me` calls. Each service
  answers for the resource types it governs: identity for organisations/subjects/rbac, the app for
  its own entities. Asking only one would hide half the nav. `rbac` is reported by both and they
  agree, because both seed it from `rbac/platform.py`.
- 2026-09-21 (0.12.0): `Rbac` gained a SOURCE SWITCH (this app / Identity) because the matrices are
  per service, while the Roles tab always talks to identity. `RbacApi` is the slice both clients
  implement, which is what lets one screen serve both.
- 2026-09-21 (0.12.0): `useOrganisationsWithRole` lost its `source` argument and filters
  server-side. It existed because a picker whose value became a foreign key in service B had to
  list service B's organisations; there is one organisation table now. It never offers the platform
  organisation, which would only produce a 422 on submit.
- 2026-09-21: `comparison()` takes `declarationPath` and `comparisons()` a `declarationPaths` map —
  PLUMBING ONLY. `src/mdpp/` still derives nothing from the order of the paths it is given and does
  not know they form a chain; the host that has the hierarchy computes the map. `Comparison` renders
  `inherited` / `source_gs1_path` when present, because a verdict shown against a claim made on
  another identifier must name it — still rendering, still computing nothing.
- 2026-09-21: `src/hierarchy/` — the consumer-side rule for **which declaration is effective at each
  level of a chain**. This AMENDS the 2026-09-20 line that `src/mdpp/` carries no hierarchy and no
  chain walking: that still holds, and the mdpp client is untouched. The boundary is now "the CLIENT
  for a flat service knows nothing about hierarchy", not "the library knows nothing about it".
  The rule is shared because two viewers disagreeing about WHICH CLAIM a test was judged against
  would render different verdicts from the same evidence — the failure `Comparison` exists to
  prevent. It is pure and unit-tested, which it was not while inlined in dpp-app.
- 2026-09-21: `src/hierarchy/` is HANDED a chain and never goes looking for one. Deriving ancestry
  belongs to whoever owns the tree (dpp-app's `parent_id`, a partner's own model, passport-app's
  merge). A GS1 path cannot supply it: a batch and its model share no prefix, and a GMN is not
  derivable from a GTIN.
- 2026-09-21: `comparisonsAlongChain` was hoisted too, REVERSING the same-day decision to leave the
  fetching in dpp-app. "Don't design for an imaginary consumer" was applied too mechanically: the
  second pass is not optional, omitting it fails SILENTLY (every call succeeds, every verdict wrong
  in one direction), and that failure is exactly the bug this round fixed. Thirteen lines are not
  speculative generality when re-implementing them reproduces a known defect. A host with different
  fetching needs uses `effectiveClaims` directly — the rule must not differ, the round trips may.
- (Append new mdpp-common decisions here.)

## Open questions
- Whether any mdpp data is non-public (decides how much read-RBAC mdpp needs).
- ~~One organisation per user, or several.~~ **Resolved 2026-09-20: several.**
- ~~How two services agree which organisation is which.~~ **Dissolved 2026-09-21:** there is one
  organisation table, in m-dpp-identity, so there is nothing to agree about.
