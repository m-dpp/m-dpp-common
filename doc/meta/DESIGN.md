# mdpp-common — Design Reference

The shared library used by dpp-app and mdpp-app. Owns the **organisation** entity, the **RBAC**
engine + roles, and the **OIDC/JWT auth** seam. `CLAUDE.md` (this repo) is the briefing; this is the
full reference. For the system-wide picture, see the shared block at the top of `CLAUDE.md`.

**Golden rule:** this library **imports neither app** and is **entity-agnostic** — it operates on
`(entity_type, attribute)` and stored role data, never on any app's specific models. A change here
ripples to both consuming apps; if it would force a client-app change, that must be raised and
approved before doing it.

---

## 1. Organisation

- Identity = surrogate **UUID id**. **GLN is optional and lives in `attrs`** — not every
  organisation has one (a laboratory may not be a GS1 member). GLN is never required, never an RBAC
  key.
- **Type comes from assigned roles**, not an `operator_type` (removed). A lab = organisation with the
  `laboratory` role; a manufacturer = `economic_operator`; etc.
- Each consuming app has its OWN organisation table (same shape via the library, separate data).
  Organisations correspond across apps via **OAuth identity**, not a service link.
- RBAC references organisations by **internal id (UUID)**, never GLN.

### User <-> organisation
OAuth provides the user (`sub`). A small **membership** table links `sub -> organisation`. **A user
represents an organisation; the organisation's role is the authority.** No per-user-within-org roles
for the MVP (deferred). `get_principal` (shared seam): token -> `sub` -> organisation (+ its roles) =
the principal. Auth is OIDC/JWT; a combined deployment can point both apps at the same identity
provider without either depending on the other.

## 2. Roles — dynamic, stored data

Roles must be **data, addable at runtime**, not a hardcoded enum. A `roles` table (or equivalent)
stores role records. Seed the known ones idempotently on startup — `public`,
`end_user_professional`, `recycler`, `supply_chain_professional`, `authority`, `economic_operator`,
`laboratory` — as **seed data**, so new roles can be added later via the admin API/UI with no code
change. Remove hardcoded role references throughout, **including the dashboard**, which must render
role columns/options dynamically from stored roles. Admin endpoints: list/create/deactivate roles.

Roles are **actor identities**; access differentiation lives in the permission engine, not in role
names. A *small*, clearly-marked amount of role special-casing is acceptable only where genuinely
required (e.g. the economic-operator identification requirement); everything else treats roles as
opaque data.

## 3. RBAC — two layers

1. **Resource-level gate:** role x resource-type (e.g. `product`, `organisation`) x operation
   (list/read/create/update/delete).
2. **Attribute-level filter:** keyed on **`(entity_type, attribute)`** — `entity_type` is coarse
   (`product`, `organisation`), **NOT** a granularity level. Unreadable keys are stripped from
   responses; unwritable keys from write payloads.

Rules:
- **Resolve inheritance FIRST, then apply the attribute filter** to the resolved result — so a rule
  follows an attribute through inheritance (never filter per-level then merge).
- **Attributes are admin-addable per `entity_type`**, including **computed/derived** fields that are
  never persisted (e.g. a product's `parent_gs1_path` and `level`, which are derived on read). Let an
  admin register an attribute for an entity_type even if it never appears in stored data.
  Auto-discovery from stored data (sync) stays as a convenience but must **coexist with, and never
  delete,** manually-added attributes.
- Admin endpoints: add/list/remove attributes per entity_type; set per-attribute read/write per role.

### Why this shape (history — do not "fix" back)
Originally keyed per entity = per **level** (model/variant/batch/item), which **broke inheritance**:
an attribute defined on a Model lost its rule when inherited by a Variant, because the rule was
pinned to the defining level. Removing the entity from the key fixed inheritance but caused
same-named attributes on different entities to collide. Now that dpp-app's four levels are a single
`product` entity, restoring the entity dimension as **entity_type** is safe: inheritance resolves
*within* the single product entity (level-agnostic), so an attribute's rule is no longer fragmented
by level, and entity_type only distinguishes *different* entities (product vs organisation).

Likely **minimal RBAC in mdpp** (most mdpp data is publish-by-design): probably coarse
write-authorisation + maybe a public/restricted split on raw lab evidence — confirm with the
consortium. The fuller engine matters more for dpp-app's differentiated data.

## 4. Dashboard

Admin dashboard must reflect §2-§3:
- role columns/options rendered **dynamically** from stored roles (no hardcoded list);
- attributes shown per **entity_type**, including manually-added/computed ones;
- an admin can **add a role**, **add an attribute for an entity_type**, and set per-attribute
  read/write per role — all without code changes.

## 5. Conventions

Async SQLAlchemy 2.0 + asyncpg; Alembic; Pydantic; FastAPI. Any schema change -> a migration, shown
before applying, migrating existing role/permission data into the dynamic structure **without loss**
(existing hardcoded roles become seeded rows; existing per-level or entity-less attribute rules are
re-keyed to `(entity_type, attribute)` — confirm the mapping if the existing data is ambiguous). Keep
the engine entity-agnostic.

## 6. Trust / verifiability (roadmap)

The organisation model is where a lab's **public key / DID** will live for signing (a GLN-less lab
signs with its key/DID — matches UNTP's issuer=DID model). Claims are designed as signable objects;
signing / VC issuance is roadmap, not MVP.

## 7. Open questions

- Whether any mdpp data is non-public (decides how much read-RBAC mdpp needs).
- One organisation per user, or possibly several.
