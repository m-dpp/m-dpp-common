# m-dpp-common

Shared **libraries** for the mDPP services (`dpp-app`, `mdpp-app`, `passport-app`). Two halves,
one repo, no runtime of its own:

```
m-dpp-common/
  backend/    Python package `m_dpp_common`  — GS1 validators, DB plumbing, ORM mixins,
              the organisation entity, subjects/memberships + principal resolution (auth seam),
              the RBAC engine + JSON admin router
  frontend/   npm package `@m-dpp/ui`          — design tokens + primitives, AppShell, the
              generic AttrsEditor, the API client contract, and the admin screens every app
              needs identically (Login, Organisations, Users & links, RBAC, "acting as")
  doc/meta/   CLAUDE.md / DESIGN.md (system context + this repo's design reference)
```

Neither half is an application. Each consuming app has its **own** tables, its **own** rows,
its **own** front-end; this repo provides the shape and the logic they must not let diverge.

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
- `m_dpp_common.organisation` — the **Organisation** entity: `OrganisationMixin`, create/update schemas, a parametrised `/organisations` CRUD router. Nature comes solely from assigned roles; a **GLN is optional and lives in `attrs["gln"]`**; `PATCH {"active": false|true}` deactivates/reactivates; `GET /organisations?include_removed=true` lists inactive ones too.
- `m_dpp_common.auth` — the **auth seam** (see below): `SubjectMixin`, `MembershipMixin`, `resolve_principal` / `make_get_principal`, the dev identity source, and `make_subjects_router` (`/subjects`, `/memberships`, `/me`).
- `m_dpp_common.rbac` — the two-layer **RBAC engine** (resource gate + attribute filter), role seed data, fan-out helpers, and the parametrised **JSON** admin router under `/admin/rbac` (roles, attributes registry, attribute permissions, resource permissions, organisation-roles). The admin *UI* is the shared React screen in `frontend/`; there is no server-rendered dashboard any more.
  - **Roles are data** (`roles` table). The JRC list is only the initial seed. An unknown or inactive role is 403 at the resource gate.
  - **Attribute rules are keyed `(entity_type, attr_key, role_name)`**; `entity_type` is a coarse, service-chosen string, never a granularity level. Resolve inheritance first, then filter.
  - **Attribute registry** (`rbac_attributes`): discovered from stored `attrs` (`POST /sync-attrs`) or registered manually (`POST /attributes`, e.g. computed fields). Sync never deletes.
  - **Several roles, union semantics.** A principal carries `roles` (the organisation's roles); an action is allowed if any held role allows it, a key readable/writable if any role may. Every call point accepts one role name or a list.
  - Writes are **rejected (403)**, never trimmed; PATCH bodies merge `attrs` (`null` removes a key).

### What must NOT come here
Anything domain-specific: the identity tree (model/variant/batch/item), inheritance resolution, composition claims, the fibre taxonomy, per-service `@context` documents, per-service permission *matrices*, per-service screens (products, declarations…).

---

## The auth seam

```
identity source ──► subject ──► membership ──► organisation ──► roles ──► principal
 (X-Dev-Sub)        subjects     memberships     organisations   organisation_roles
 TEMPORARY          ─────────────── real, stays ────────────────────────────────►
```

- A **subject** is a known identity (`sub`, unique — what an OIDC token will carry). Created by hand for now (`POST /subjects`).
- A **membership** links a subject to the **one** organisation it represents. **The organisation's roles are the subject's authority.** No per-user roles.
- `resolve_principal(sub, db, ...)` returns `{sub, anonymous, reason, subject, organisation, roles, role}`. No identity, an unknown or unlinked subject, or an organisation without an active role resolves to the **anonymous role** (`RBAC_ANONYMOUS_ROLE`, default `public`) — a floor, never a privileged default. Nothing else about a role is hardcoded.
- **Only `m_dpp_common/auth/dev_identity.py` is temporary.** It reads the `X-Dev-Sub` header. Swapping to real auth = passing a JWT-validating dependency as `make_get_principal(identity=...)`. Nothing downstream changes.
- `m_dpp_common.auth.get_principal` (the old `X-Dev-Role` stub) is kept for one release for services that have not migrated.

Binding it in a service:

```python
class Subject(SubjectMixin, Base): pass
class Membership(MembershipMixin, Base): pass

get_principal = make_get_principal(
    get_db=get_db, subject_model=Subject, membership_model=Membership,
    organisation_model=Organisation, organisation_role_model=OrganisationRole, role_model=Role,
)
app.include_router(make_subjects_router(
    get_db=get_db, get_principal=get_principal, subject_model=Subject, membership_model=Membership,
    organisation_model=Organisation, organisation_role_model=OrganisationRole, role_model=Role,
    resource_permission_model=ResourcePermission, resource_types=["products", "organisations"],
))
```

**Gating (0.10+).** Pass `rbac_engine=` to `make_subjects_router` and `get_principal=` + `rbac_engine=` to `make_rbac_router`, and seed a policy for the resource types `subjects` and `rbac`: subject/membership writes and every RBAC admin endpoint then pass the resource gate (GET → read/list, POST → create, PATCH → update, DELETE → delete). Reference reads stay open — `GET /subjects` and `GET /me` (the dev switcher needs them before an identity is chosen), `GET /admin/rbac/roles`, `/entity-types` and `/organisation-roles` (role labels and an organisation's nature are public data). Without those arguments the routers are open, as before.

`seed_rbac(resource_defaults=...)` accepts, per role, either a flat permission dict (same for every resource type) or a dict keyed by resource type with a `"*"` fallback, e.g. `{"products": FULL, "rbac": NONE, "*": READ}`. The seed role list includes `administrator` (manages roles, access rules, identities) — grant it to the organisation that runs the instance.

---

## Backend — install and use

Each service pins a tag in its `requirements.txt` (public repo → plain `git+https`, note the `subdirectory`):

```
m-dpp-common @ git+https://github.com/m-dpp/m-dpp-common@v0.10.0#subdirectory=backend
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
import { ApiProvider, PrincipalProvider, AppShell, ActingAsSwitcher, Organisations, UsersAndLinks, Rbac, Login } from "@m-dpp/ui";

<ApiProvider baseUrl={import.meta.env.VITE_API_BASE ?? "/api"}>
  <PrincipalProvider>
    <AppShell brand={{ name: "dpp-app" }} nav={...} activeKey={...} onNavigate={...}
              sidebarFooter={<ActingAsSwitcher roles={roles} />}>
      <Organisations />  ...
    </AppShell>
  </PrincipalProvider>
</ApiProvider>
```

`useApi()` gives screens the client; `usePrincipal()` gives `{principal, can(resource, action), refresh}` so a host can hide/disable actions the resolved roles may not perform. `useActingAs()` reads/sets the identity the UI acts as (dev only). The shared screens gate themselves with `can()` on a `resourceType` prop (`Organisations` → `organisations` plus `rolesResourceType` `rbac` for role assignment, `UsersAndLinks` → `subjects`, `Rbac` → `rbac`); a host hides nav entries the same way.

### API client contract (`src/api`)

`AdminApiClient` is a small typed interface: organisations, roles, organisation-roles, subjects, memberships, `me()`, RBAC entity types / attributes / attribute permissions / resource permissions / sync. `createFetchClient({ baseUrl = "/api", getIdentity })` is the default implementation against the shared backend routers (`/organisations`, `/admin/rbac/*`, `/subjects`, `/memberships`, `/me`); `paths` can remap them. No absolute URLs anywhere — the app decides the base (default relative `/api`, so a dev proxy or reverse proxy keeps everything same-origin and CORS stays off).

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
