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

---

## Versioning

SemVer. Bump `version` in `backend/pyproject.toml` and `frontend/package.json` together, tag `vX.Y.Z`, push the tag, then bump the pin in each consuming service in its own PR — that is what keeps the services independently deployable.
