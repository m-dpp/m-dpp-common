# m-dpp-common

Shared **libraries** for the mDPP services (`dpp-app`, `mdpp-app`, `passport-app`,
`m-dpp-identity`). Two halves, one repo, no runtime of its own:

```
m-dpp-common/
  backend/    Python package `m_dpp_common`  — GS1 validators, DB plumbing, ORM mixins,
              the m-dpp-identity CLIENT + auth seam, the RBAC engine + JSON admin router
  frontend/   npm package `@m-dpp/ui`          — design tokens + primitives, AppShell, the
              generic AttrsEditor, the API client contracts (app + identity + mdpp), and the
              admin screens every app needs identically (Login, Organisations, Users & links,
              RBAC, "acting as")
  doc/meta/   CLAUDE.md / DESIGN.md (system context + this repo's design reference)
```

Neither half is an application.

**Organisations, subjects, memberships and roles are no longer here.** They moved to
**m-dpp-identity**, a service both apps call. They used to be mixins each app bound to its own
tables, which meant the same company existed twice with two ids — see that repo's `DESIGN.md` §1
for what that cost. What this repo keeps is the *client* for reaching identity, and the RBAC
engine, whose attribute and resource matrices genuinely are per app.

## Charter — what belongs here

Only cross-cutting *plumbing* that must not diverge between services:

- `m_dpp_common.gs1` — GS1 identifier validation (GTIN / GLN check digits, `derive_gln`).
  Two environment flags relax it, with **opposite defaults on purpose**:

  | flag | default | when off |
  |---|---|---|
  | `GS1_PEDANTIC` | `true` | GTIN check digit not verified; GMN character set widened |
  | `GLN_PEDANTIC` | `false` | a 7–12 digit company prefix is accepted and completed with `derive_gln` |

  A GTIN becomes a permanent key for a passport and its check digit is the only thing that catches
  a transposed pair of digits, so it is strict unless a deployment says otherwise; a GLN names a
  company and getting it slightly wrong is recoverable. Both consuming apps set
  `GS1_PEDANTIC=false` in their compose files, because inventing check digits by hand is friction
  with no benefit in a demo.

  Leniency relaxes **only** the checksum and the GMN character set — never length, digits, or the
  `/ ? #` that structure a GS1 path. An identifier stored while lenient means exactly the same
  thing under strictness, so this is a validation switch and never a data migration.
  `validate_gtin(v, pedantic=True)` overrides the environment for one call.
- `m_dpp_common.db` — async engine / session-factory / `get_db` builders.
- `m_dpp_common.orm` — `Base`-agnostic SQLAlchemy mixins (UUID PK, timestamps, soft-delete, `attrs`, `apply_attrs_patch`).
- `m_dpp_common.identity` — the **m-dpp-identity client** and the auth seam built on it (see below): `IdentityClient`, `make_get_principal`, `PrincipalCache`, `wait_for_identity`. This is the whole of an app's runtime dependency on identity.
- `m_dpp_common.auth` — the two request-scoped sources the seam resolves *from*: the dev identity source (`X-Dev-Sub`) and the acting-organisation selector (`X-Acting-Org`).
- `m_dpp_common.rbac` — the two-layer **RBAC engine** (resource gate + attribute filter), role seed data, fan-out helpers, and the parametrised **JSON** admin router under `/admin/rbac` (roles, attributes registry, attribute permissions, resource permissions, organisation-roles). The admin *UI* is the shared React screen in `frontend/`; there is no server-rendered dashboard any more.
  - **Roles are data**, and since m-dpp-identity they live *there*. `JRC_ROLES` and `rbac/platform.py` stay here as the one definition identity seeds roles from and the apps seed their default permissions from. An app passes `include_roles=False, include_organisation_roles=False` to `make_rbac_router` and sets `__role_foreign_key__ = False` on its permission models, because it has no local `roles` table to point at.
  - **Attribute rules are keyed `(entity_type, attr_key, role_name)`**; `entity_type` is a coarse, service-chosen string, never a granularity level. Resolve inheritance first, then filter.
  - **Attribute registry** (`rbac_attributes`): discovered from stored `attrs` (`POST /sync-attrs`) or registered manually (`POST /attributes`, e.g. computed fields). Sync never deletes.
  - **Several roles, union semantics.** A principal carries `roles` (the organisation's roles); an action is allowed if any held role allows it, a key readable/writable if any role may. Every call point accepts one role name or a list.
  - Writes are **rejected (403)**, never trimmed; PATCH bodies merge `attrs` (`null` removes a key).

### What must NOT come here
Anything domain-specific: the identity tree (model/variant/batch/item), inheritance resolution, composition claims, the fibre taxonomy, per-service `@context` documents, per-service permission *matrices*, per-service screens (products, declarations…). And, since this round, the identity **tables** — organisations, subjects, memberships, roles — which belong to m-dpp-identity.

---

## The auth seam

```
identity source ─┐
 (X-Dev-Sub)     ├──► IdentityClient ──► m-dpp-identity ──► principal
acting org ──────┘        (HTTP)          subjects · memberships
 (X-Acting-Org)                           organisations · roles
 TEMPORARY: only the identity source
```

Two questions, two mechanisms, and they must not be conflated:

- **who is this request?** — the identity source. Not the caller's to choose: it is *proved*.
- **which of my organisations am I acting for?** — the acting selector. It **is** the caller's to
  choose, among memberships they hold. Identity refuses a choice they do not hold, so it grants
  nothing on its own.

`resolve_principal` itself now lives in m-dpp-identity. An app builds its dependency like this:

```python
from m_dpp_common.identity import IdentityClient, make_get_principal, wait_for_identity

identity_client = IdentityClient()          # IDENTITY_API_BASE + IDENTITY_SERVICE_TOKEN
get_principal = make_get_principal(client=identity_client)
#   make_get_principal(client=..., identity=<jwt dependency>)   ← the production switch
```

The principal dict is unchanged from a route's point of view: `{sub, anonymous, reason, subject,
organisation, is_org_admin, organisations, roles, role}`. No identity, an unknown or unlinked
subject, or an organisation without an active role resolves to the **anonymous role**
(`RBAC_ANONYMOUS_ROLE`, default `public`) — a floor, never a privileged default.

**An outage is never a permission change.** If identity cannot be reached, `get_principal` raises
**503**. It deliberately does not fall back to `public`, which would turn an outage into a silent
demotion and tell the user their *role* was the problem.

**The cache.** This runs on every request that needs a principal, so the answer is cached for a few
seconds, keyed on `(sub, acting_org)` — long enough to collapse a burst of calls from one page,
short enough that a membership change takes effect while the administrator is still looking at the
screen. `IDENTITY_PRINCIPAL_CACHE_TTL=0` disables it. Failures are never cached, so a blip does not
lock an app out for the length of the TTL.

**Startup.** `await wait_for_identity(client)` in the app's lifespan polls `/health`. Giving up
does **not** stop the app booting: a backend that refuses to start because identity is slow is a
backend nobody can debug, and every request reports 503 with a clear reason anyway.

| variable | what it is |
|---|---|
| `IDENTITY_API_BASE` | where identity is, e.g. `http://identity:8000` |
| `IDENTITY_SERVICE_TOKEN` | the shared secret proving this process is a trusted service. **Must match identity's.** Without it every principal resolves anonymous, and the client says so rather than letting the user's role take the blame |
| `IDENTITY_HTTP_TIMEOUT` | seconds, default 5 |
| `IDENTITY_PRINCIPAL_CACHE_TTL` | seconds, default 5; `0` disables the cache |

**Gating.** Pass `get_principal=` + `rbac_engine=` to `make_rbac_router` and seed a policy for the
`rbac` resource type: every RBAC admin endpoint then passes the resource gate (GET → read/list,
POST → create, PATCH → update, DELETE → delete). Reference reads stay open — `GET
/admin/rbac/roles`, `/entity-types` and `/organisation-roles`, because role labels and an
organisation's nature are public data. Without those arguments the router is open.

`seed_rbac(resource_defaults=...)` accepts, per role, either a flat permission dict (same for every
resource type) or a dict keyed by resource type with a `"*"` fallback, e.g.
`{"products": FULL, "rbac": NONE, "*": READ}`.

---

## Backend — install and use

Each service pins a tag in its `requirements.txt` (public repo → plain `git+https`, note the `subdirectory`):

```
m-dpp-common @ git+https://github.com/m-dpp/m-dpp-common@v0.12.0#subdirectory=backend
```

Working on it locally:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
pytest
```

Iterating on the library *and* a service at once: mount this repo into the service's container and `pip install -e /opt/m-dpp-common/backend` (dpp-app's `docker-compose.yml` does exactly that by default — see its README).

---

## Frontend — `@m-dpp/ui`

React 18 + TypeScript + Vite library. Plain CSS modules, **no UI framework**. Consumed as a **local package**: the package `exports` point at `src/index.ts`, so a consuming app compiles the source directly and hot-reloads edits — no build step, no registry.

```bash
cd frontend
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (AttrsEditor model)
npm run build       # optional: dist/index.js + dist/style.css (library build)
```

### Linking it from a consuming app

The app and this repo are sibling clones:

```
<parent>/
  m-dpp-common/frontend/     ← this package
  dpp-app/frontend/          ← the app
```

1. **`package.json`** of the app — a `file:` dependency (npm makes a symlink in `node_modules`):
   ```json
   "dependencies": { "@m-dpp/ui": "file:../../m-dpp-common/frontend", "react": "^18.3.1", "react-dom": "^18.3.1" }
   ```
2. **`vite.config.ts`** of the app — one React instance, and allow Vite to serve the sibling:
   ```ts
   import { fileURLToPath } from "node:url";
   const uiSrc = fileURLToPath(new URL("../../m-dpp-common/frontend", import.meta.url));
   export default defineConfig({
     plugins: [react()],
     resolve: { dedupe: ["react", "react-dom"] },
     server: { fs: { allow: [".", uiSrc] } },
     optimizeDeps: { exclude: ["@m-dpp/ui"] },
   });
   ```
3. `npm install` in the app. Edits under `m-dpp-common/frontend/src` hot-reload in the app.
4. **Docker**: mount the sibling into the app's frontend container at the same relative place (dpp-app mounts `../m-dpp-common/frontend` at `/work/m-dpp-common/frontend` beside `/work/dpp-app/frontend`), and keep the container's `node_modules` in a named volume so host and container installs never mix.

React is a **peer dependency** of this package; never bundle a second copy.

### Wiring in the app

```tsx
import "@m-dpp/ui/tokens.css";   // or rely on the import in the package entry
import { ApiProvider, IdentityProvider, PrincipalProvider, AppShell, ActingAsSwitcher,
         Organisations, UsersAndLinks, Rbac, Login } from "@m-dpp/ui";

<ApiProvider baseUrl={import.meta.env.VITE_API_BASE ?? "/api"}>
  <IdentityProvider baseUrl={import.meta.env.VITE_IDENTITY_API_BASE ?? "/identity-api"}>
    <PrincipalProvider>
      <AppShell brand={{ name: "dpp-app" }} nav={...} activeKey={...} onNavigate={...}
                sidebarFooter={<ActingAsSwitcher roles={roles} />}>
        <Organisations />  ...
      </AppShell>
    </PrincipalProvider>
  </IdentityProvider>
</ApiProvider>
```

**Both providers are required.** `IdentityProvider` is not optional the way `MdppProvider` is: every
app resolves its principal through identity, and the Organisations, Users & links, Roles and
acting-as screens have nowhere else to read from. A host that omits it gets a thrown error rather
than a degraded mode, because that is a configuration mistake and not a deployment choice.

`useApi()` gives screens the host app's client; `useIdentity()` gives the identity client;
`usePrincipal()` gives `{principal, can(resource, action), refresh}` so a host can hide or disable
actions the resolved roles may not perform. `useActingAs()` reads/sets the identity the UI acts as
(dev only). The shared screens gate themselves with `can()` on a `resourceType` prop
(`Organisations` → `organisations` plus `rolesResourceType` `rbac` for role assignment,
`UsersAndLinks` → `subjects`, `Rbac` → `rbac`); a host hides nav entries the same way.

### API client contracts (`src/api`, `src/identity`)

Three clients, because there are three backends a front-end may talk to, each on its own relative
path so everything stays same-origin behind the host's proxy:

| client | base | serves |
|---|---|---|
| `AdminApiClient` (`useApi`) | `/api` | the host app: `me()` and its **own** RBAC matrices |
| `IdentityApiClient` (`useIdentity`) | `/identity-api` | organisations, subjects, memberships, roles, keys, lab config, audit, and identity's own matrices |
| `MdppApiClient` (`useMdpp`) | `/mdpp-api` | declarations, tests, comparison, the fibre taxonomy |

`RbacApi` is the slice both `AdminApiClient` and `IdentityApiClient` implement — the attribute and
resource matrices — which is what lets **one** `Rbac` screen point at either. Its source switch
does exactly that; the Roles tab always talks to identity, because roles are defined there and
nowhere else.

**`me()` is on two of them and they are not duplicates.** The principal (subject, acting
organisation, roles) is identity's answer and is authoritative. The `permissions` map is merged
from both, because each service answers for the resource types it governs: identity for
`organisations` / `subjects` / `rbac`, the app for `products`, `declarations` and so on. A UI that
asked only its app would hide the Organisations screen; one that asked only identity would hide
Products. `rbac` is reported by both and they agree, because both seed it from
`m_dpp_common.rbac.platform`.

**The browser never holds the service token.** Resolving a principal for an *arbitrary* subject is
an app-backend capability; from the browser, `me()` resolves only the current identity.

No absolute URLs anywhere — the app decides each base, so a dev proxy or reverse proxy keeps
everything same-origin and CORS stays off.

### Design tokens and primitives (`src/design`)

CSS variables on `:root` (`tokens.css`): page `#f5f6f7`, surfaces white; text `#1a1a1a` / `#3f4448` / muted `#8a9196` / faint `#b4bbc0`; borders `#e8eaed` / `#eef0f2`; **one accent** slate `#2f3b52` with soft tint `#eef1f6`; status **only for meaning** — ok `#3f9c6d`, warn `#c98a2b`, error `#c0564a`, each with a light background; radius 7–8 px, subtle shadows, Inter/system stack, base 13.5 px.

Primitives: `Button` (primary / outline / ghost / danger; sm / md / lg), `Input`, `Select`, `Textarea`, `Field` (+ `LabelledInput` / `LabelledSelect`), `Table` / `DataTable`, `Card` (`CardHeader` / `CardBody` / `CardFooter`), `Chip` (neutral / ok / warn / error / accent), `Tag`, `Toggle`, `SegmentedControl`, `Modal`, `EmptyState`, `Notice` (incl. the dashed amber `dev` tone reserved for development affordances), and `AppShell` (grouped sidebar nav with active state, sticky header, content area, sidebar footer slot).

### The AttrsEditor (`src/components/AttrsEditor`)

Edits an arbitrary JSON object without the user ever typing JSON. Free-form (any key), recursive, two modes.

```tsx
<AttrsEditor value={attrs} mode="view" provenance={prov} />                  // the common case
<AttrsEditor value={attrs} mode="edit" onChange={setAttrs} readOnlyKeys={["gln"]} hiddenKeys={["secret"]} />
<AttrsViewer value={attrs} />                                               // = view mode
```

Node model: a **leaf** is `text | number | boolean | date | image` (date = `YYYY-MM-DD`; image = an **image link** — a plain URL string that is recognised as an image by its extension `.png .jpg .jpeg .gif .webp .avif .svg .bmp` or a `data:image/…` URI, and rendered as a small thumbnail that opens the full image in a new tab; only `http(s)` and `data:image` sources are ever put in an `<img>`), a **complex** node is `object` (named children) or `list` (ordered children shown as `[0]`, `[1]`). Nesting is unlimited. Add controls **＋ field / ＋ object / ＋ list** exist at the root and inside every complex node; remove removes a subtree; changing a node's type coerces the value and asks before discarding children. `readOnlyKeys` are shown but not editable (their subtree too); `hiddenKeys` are not rendered and pass through `onChange` untouched. `provenance` maps a top-level key to `{ source, label?, inherited }`; inherited values render muted with a small `↑ label` marker, and rows without provenance render normally.

Example value the editor round-trips (nesting, list of mixed items, a date, a null):

```json
{
  "product_name": "Merino Knit Jacket",
  "weight_gsm": 320,
  "recyclable": true,
  "production_date": "2026-03-15",
  "image": "https://cdn.example/merino-jacket.jpg",
  "care": { "wash": { "temp_c": 30, "cycle": "wool" }, "dry": "flat" },
  "certifications": ["RWS", { "scheme": "GRS", "id": 42 }],
  "note": null
}
```

`attrsPatch(original, next)` (in `src/components/attrsPatch.ts`) turns two objects into the PATCH body the backends expect (changed keys set, removed keys `null`).

### The project banner (`src/components/ProjectBanner`)

The Overview banner, written once instead of once per app: project description, the three services, consortium partners, funding, contact, contributors, standards referenced and documentation links.

```tsx
<ProjectBanner currentService="dpp-app" appNote="This is dpp-app, the reference passport…" />
<ProjectBanner config={myConfig} currentService="mdpp-app" />   // or supply your own
```

`MDPP_PROJECT` is the shared content and the default; `ProjectConfig` is its shape. `currentService` matches a `services[].key` and marks that card "you are here". `appNote` is the **one** app-specific line an app may add under the description — keep it to a sentence.

---

## The mdpp connection (`src/mdpp`)

The single way any front-end talks to an **mdpp-app** instance. dpp-app's Molecular tab, mdpp-app's own admin and (later) passport-app all go through this; it contains no app-specific logic — no hierarchy, no chain walking, and no verdict.

```tsx
<MdppProvider enabled={MDPP_ENABLED} baseUrl="/mdpp-api">…</MdppProvider>

const mdpp = useMdpp();                    // throws when not enabled — call under a guard
const enabled = useMdppEnabled();
const conn = useMdppConnection();          // { enabled, baseUrl, client } | null
```

The base path is **relative** (default `/mdpp-api`), never a host and port: the host app proxies it so everything stays same-origin and no CORS is involved, exactly as `/api` does for its own backend. Identity travels the same way as on the dpp client — both read the shared `identityStore` — so switching "acting as" switches it for both APIs at once.

The client covers declarations (list by prefix/level, current, history, new version, withdraw), tests (list with filters, register with `lab_id` + `ticket`, refresh, result, withdraw), the **comparison** endpoint, batched per-path **counts** for tree annotations, and the fibre taxonomy for the composition picker. `comparisons(paths)` is one request per identifier — mdpp is flat and answers about exactly one — with a path that has nothing on it resolving to `null` rather than rejecting the batch.

It carries **no organisation endpoints**. It used to, because mdpp kept its own organisation table and anything that became an mdpp foreign key (`laboratory_id` on a test) had to be an id mdpp issued. Organisations live in m-dpp-identity now: one row, one id, understood by every service, so a laboratory picker reads identity and the value it produces is valid everywhere.

### The Comparison renderer (`src/components/Comparison`)

```tsx
<Comparison comparison={cmp} contextNote={<Chip tone="warn">on the variant</Chip>} />
```

Renders **one test versus one declaration**, exactly as mdpp-app computed it. It **computes nothing**: every verdict, sentence, tolerance and flag on screen is a field of the object mdpp-app returned, which is what stops the apps drifting in how a verdict is shown — there is nothing for them to drift about.

Its input is one entry of `ComparisonResponse.comparisons` (`TestComparison`):

| field | what it holds |
|---|---|
| `test` | verification status, analysis type (`in_loco` / `submitted_data`), method, lab, ticket, dates |
| `declaration` | the version this test was compared against, plus `at_test_time` — `true` when it is the version that was current when the test was requested (the default), `false` when a caller forced one |
| `rows[]` | one per declared component, plus `undeclared` rows for tested fibres nobody declared and `not_found` rows for declared fibres the test did not find |
| `flags[]` | neutral footer notes (quantity outside tolerance, undeclared fibre, client-submitted data) |

Each `matched` row carries the three independent verdicts:

- **`official`** — `complies` / `off`, with the legal fibre name (EU 1007/2011) each side resolved to. `off` is reachable even inside the declared subtree, when a legal-name flag sits between the two nodes.
- **`specificity`** — `relationship` (`same`, `tested_is_descendant`, `tested_is_ancestor`, `same_official_other_branch`), the two nodes, and a generated `sentence`. **Render the sentence; do not compose your own.**
- **`quantity`** — `difference` (tested − declared, signed percentage points), the `tolerance` applied, the node it was `tolerance_from` / `tolerance_inherited`, and `within`. **`within: null` means no tolerance is defined anywhere in the fibre's chain — unknown, which is not a pass, and must not render as one.**

Wording is neutral throughout: a row is "flagged for review", never an accusation.

### Declarations and Tests screens (`src/screens/mdpp`)

```tsx
<Declarations />                              // mdpp-app's admin: searchable across identifiers
<Declarations pathScope="01/0871…/10/LOT-1" /> // dpp-app: pinned to one product
<Tests pathScope={path} bare comparisonNote={…} />
```

Both take an optional **`pathScope`**. A host with a product in hand pins them to one GS1 path; an admin leaves it out and gets the searchable list. Scoping **hides** the search controls rather than pre-filling them — the identifier is not the user's to change there.

**Declarations** filters by path prefix and level, and writes a new version through a fibre + percentage row editor (`CompositionEditor`) that names fibres from the taxonomy, never raw JSON. It shows the percentage total but does not enforce 100: compositions legitimately fall short (unlisted trims), and refusing to record what someone actually declares would make the passport less truthful, not more.

**Tests & results** is deliberately one screen — a test and its result are the same thing at two moments in time. Filters: path prefix, level, status, laboratory, test type; sorting by request or result date. A completed row expands **in place** into `<Comparison>`; a pending or errored row offers **Refresh**. Registering a test takes only `lab_id` + `ticket`.

### The fibre taxonomy screen (`src/screens/mdpp/FibreTaxonomy.tsx`)

```tsx
<FibreTaxonomy />
```

The composition hierarchy declarations and results are expressed in — and the place two inputs to the comparison are **defined**:

- **`legal_name`** marks a legally-binding fibre name (EU 1007/2011). The official-fibre verdict resolves to the nearest ancestor-or-self carrying it, which is why merino and rambouillet both come out as *wool*.
- **`tolerance`** (an attribute, absolute percentage points) is what every quantity verdict is measured against, inherited **nearest ancestor-or-self wins**.

Both are shown **resolved**: the tree badges each node's effective tolerance and dims it when inherited; the detail names the ancestor it came from. A node with no tolerance anywhere in its chain says so, because that makes its quantity verdicts read *unknown* rather than *within*.

> Registering an attribute is not enough to edit it — each key needs a permission row per role, and the default is readable-but-not-writable. A host that wants `tolerance` edited must grant write on it (see mdpp-app's seed).

---

## Versioning

SemVer. Bump `version` in `backend/pyproject.toml` and `frontend/package.json` together, tag `vX.Y.Z`, push the tag, then bump the pin in each consuming service in its own PR — that is what keeps the services independently deployable.

**0.12.0 is a breaking change.** Organisations, subjects, memberships and roles left this library for m-dpp-identity. A consuming service must: drop those model bindings and the routers that served them; build `get_principal` from `m_dpp_common.identity` instead of `m_dpp_common.auth`; pass `include_roles=False, include_organisation_roles=False` to `make_rbac_router`; and set `__role_foreign_key__ = False` on its `AttrPermission` and `ResourcePermission` models, which no longer have a local `roles` table to reference.
