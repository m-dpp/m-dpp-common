# mdpp-common — Design Reference

The shared library used by dpp-app, mdpp-app and m-dpp-identity. Owns the **RBAC engine**, the
**platform role/permission definition**, the **m-dpp-identity client** + auth seam, and the shared
admin UI. `CLAUDE.md` (this repo) is the briefing; this is the full reference. For the system-wide
picture, see the shared block at the top of `CLAUDE.md`.

**Golden rule:** this library **imports no app** and is **entity-agnostic** — it operates on
`(entity_type, attribute)` and stored role data, never on any app's specific models. A change here
ripples to every consumer; if it would force a client change, that must be raised and approved
before doing it.

---

## 1. Identity is not here any more

Organisations, subjects, memberships, roles and role assignments used to live in this library as
mixins, and each consuming app bound them to its own tables. That meant the same company existed
twice, with two different UUIDs, kept in step by hand — and every consequence that followed:
double provisioning, a "same `sub` in both apps" convention, users linked in one app and `public`
in the other, hand-synced roles behind a drift checksum, and `Organisation.external_key` plus a
browser-side reconciliation screen whose only purpose was to detect the drift.

They now live in **m-dpp-identity**, a service both apps call. That repo's `DESIGN.md` §1–§4 is the
reference for what they are; this section says only what the library still owns of them, which is
**how to reach them**.

### 1.1 The client

`m_dpp_common.identity.IdentityClient` is the whole of an app's runtime dependency on identity: a
typed async httpx client, configured by `IDENTITY_API_BASE` and `IDENTITY_SERVICE_TOKEN`. It is
deliberately small — resolve a principal, look an organisation up, read a laboratory's
configuration. Everything else about identity is administered from the browser, through the shared
screens.

Two failure modes are distinguished, because they need different answers:

- **`IdentityUnavailable`** — identity could not be reached, or answered 5xx. The app does not know
  who the caller is and says so with a **503**.
- **an anonymous principal** — identity answered, and the answer is that this subject resolves to
  nothing. A normal reply, carrying a `reason` the UI shows.

**The app must never collapse the first into the second.** Falling back to `public` on an outage
turns an infrastructure failure into a silent permission change, and a write refused because "you
are public" is a far worse diagnosis than "identity is down".

### 1.2 The cache

Principal resolution is on the hot path of every request that needs to know who is asking, so
without a cache one page of thirty API calls is thirty round trips. `PrincipalCache` holds an
answer for a few seconds (`IDENTITY_PRINCIPAL_CACHE_TTL`, default 5), keyed on
`(sub, acting_org)` — long enough to collapse a burst, short enough that a membership change takes
effect while the administrator is still looking at the screen.

Negative answers are cached on the same terms: an unknown subject is a question asked just as often
as a known one. **Failures are not cached at all**, so a blip cannot lock an app out for the length
of the TTL.

### 1.3 Startup

`wait_for_identity` polls `/health` in an app's lifespan. **Giving up does not stop the app
booting.** A backend that refuses to start because identity is slow is a backend nobody can debug,
and every request reports 503 with a clear reason anyway — which is more useful than a container
that exits.

### 1.4 What the library still defines about identity

The two request-scoped sources the seam resolves *from*, and only those:

- `m_dpp_common.auth.dev_identity` — the `X-Dev-Sub` header. **The one temporary piece.** Swapping
  to real authentication means passing a JWT-validating dependency to `make_get_principal`.
- `m_dpp_common.auth.acting_organisation` — the `X-Acting-Org` selector. **Not temporary.** Which
  of your organisations you act for is your choice to make, and it survives real authentication
  unchanged — it just travels in a session or token claim instead of a header.

Keeping them separate is what makes the acting-as switcher a real control rather than a development
trick: switching context must change authority and ownership without touching who you are, and
changing who you are must not silently carry an organisation over.

## 2. Roles — dynamic, stored data, and stored in identity

Roles must be **data, addable at runtime**, not a hardcoded enum. The `roles` table lives in
m-dpp-identity; what stays here is `rbac/platform.py` and `JRC_ROLES`, the **one definition**
identity seeds roles from and the apps seed their default permissions from. Seeding is idempotent,
so new roles can be added later via the admin API/UI with no code change. No hardcoded role
references anywhere, including the screens, which render role columns dynamically from the fetched
list. Admin endpoints (list/create/deactivate) are identity's.

**A consequence for the apps.** An app's permission rows key on `role_name` as a plain string, with
no local table to join against, so the mixins' `roles.name` foreign key is optional
(`__role_foreign_key__ = False`). Deleting a role in identity therefore no longer cascades to an
app's permission rows. An orphaned row matches nothing and is harmless — and a cross-service
cascade was never available in the first place.

The apps' RBAC engines also drop `role_model`: the unknown/inactive-role check it performed is
already done upstream, because a principal arrives from identity carrying only active role names.

Roles are **actor identities**; access differentiation lives in the permission engine, not in role
names. A *small*, clearly-marked amount of role special-casing is acceptable only where genuinely
required (e.g. the economic-operator identification requirement); everything else treats roles as
opaque data.

## 3. RBAC — two layers

1. **Resource-level gate:** role x resource-type (e.g. `product`, `organisation`) x operation
   (list/read/create/update/delete).
2. **Attribute-level filter:** keyed on **`(entity_type, attribute)`** — `entity_type` is coarse
   (`product`, `organisation`), **NOT** a granularity level. Unreadable keys are stripped from
   responses. A write payload naming an unwritable key is **rejected with 403** (the keys are
   named in the detail) — never silently trimmed, which would return 2xx for a write that did not
   happen. PATCH `attrs` is a **merge** onto the stored bag (`null` removes a key; keys not named
   are untouched). Replacing the bag would let any role with resource-level update rights erase
   attributes it holds no write permission on.

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

## 6. The front-end's three clients

A front-end may talk to three backends, each on its own **relative** path so everything stays
same-origin behind the host's proxy and no CORS is involved:

| client | base | serves |
|---|---|---|
| `AdminApiClient` (`useApi`) | `/api` | the host app: `me()` and its **own** RBAC matrices |
| `IdentityApiClient` (`useIdentity`) | `/identity-api` | organisations, subjects, memberships, roles, keys, lab config, audit |
| `MdppApiClient` (`useMdpp`) | `/mdpp-api` | declarations, tests, comparison, the fibre taxonomy |

`RbacApi` is the slice both the app client and the identity client implement — the attribute and
resource matrices — which is what lets **one** `Rbac` screen point at either. Its source switch does
exactly that; the Roles tab always talks to identity, because roles are defined there and nowhere
else.

**`IdentityProvider` is not optional**, unlike `MdppProvider`. Every app resolves its principal
through identity, and the shared screens have nowhere else to read from, so a host that omits it
gets a thrown error rather than a degraded mode — that is a configuration mistake, not a deployment
choice.

### 6.1 Two `/me` calls, merged

The principal (subject, acting organisation, roles) is identity's answer and is authoritative. The
`permissions` map is assembled from **both** services, because each governs different resource
types: identity answers for `organisations`, `subjects` and `rbac`; the app answers for `products`,
`declarations` and so on.

Merged rather than chosen between: a UI that asked only its app would hide the Organisations
screen, and one that asked only identity would hide Products. Neither service is wrong — they are
answering about different things. `rbac` is reported by both, and they agree because both seed it
from `rbac/platform.py`.

**The browser never holds the service token.** Resolving a principal for an *arbitrary* subject is
an app-backend capability; from the browser, `me()` resolves only the current identity.

## 7. Trust / verifiability (roadmap)

A laboratory's **public keys** live on its organisation in m-dpp-identity, addressed by `kid` and
rotated rather than replaced (a GLN-less lab signs with its key or DID — matching UNTP's
issuer=DID model). Claims are designed as signable objects; signing and VC issuance are roadmap,
not MVP. This library will carry the verification helpers when there is something to verify.

## 8. Open questions

- Whether any mdpp data is non-public (decides how much read-RBAC mdpp needs).
- ~~One organisation per user, or possibly several.~~ **Resolved: several**, and the acting
  organisation is chosen explicitly at request time.
