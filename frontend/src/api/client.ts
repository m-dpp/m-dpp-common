import { identityStore } from "./identity";
import type {
  AttrPermission,
  Principal,
  RbacAttribute,
  ResourcePermission,
  SyncAttrsResult,
} from "./types";

/**
 * The **attribute and resource matrices** — per entity type, and therefore per
 * service. dpp's product attributes and mdpp's declaration attributes differ,
 * so each app governs its own; m-dpp-identity governs `organisations`,
 * `subjects` and `rbac` the same way, through the same endpoints.
 *
 * Both clients implement it, which is what lets one Rbac screen point at either.
 */
export interface RbacApi {
  listEntityTypes(): Promise<string[]>;
  listAttributes(entityType?: string): Promise<RbacAttribute[]>;
  createAttribute(body: { entity_type: string; attr_key: string; description?: string }): Promise<RbacAttribute>;
  deleteAttribute(id: string): Promise<void>;
  syncAttrs(): Promise<SyncAttrsResult>;
  listAttrPermissions(entityType?: string): Promise<AttrPermission[]>;
  updateAttrPermission(id: string, body: { can_read?: boolean; can_write?: boolean }): Promise<AttrPermission>;
  listResourcePermissions(resourceType?: string): Promise<ResourcePermission[]>;
  updateResourcePermission(id: string, body: Partial<Omit<ResourcePermission, "id" | "resource_type" | "role_name">>): Promise<ResourcePermission>;
}

/**
 * What the shared screens need from an **app's own** backend. The consuming app
 * supplies an implementation — normally `createFetchClient({ baseUrl })` —
 * through `ApiProvider`. No URLs, no app-specific entities.
 *
 * Organisations, subjects, memberships and roles are **not** here: they are
 * served by m-dpp-identity, through `IdentityApiClient`. An app backend no
 * longer holds those tables at all.
 *
 * `me()` stays, and is not a duplicate of identity's: the principal is resolved
 * by identity, but the `permissions` an app reports are its OWN resource types
 * (`products`, `declarations`…). Each service answers for what it governs, and
 * `PrincipalProvider` merges the two.
 */
export interface AdminApiClient extends RbacApi {
  me(): Promise<Principal>;
}

/** Build a query string from defined, non-empty values (exported for app-specific clients). */
export function queryString(query?: Record<string, string | number | boolean | undefined | null>): string {
  if (!query) return "";
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Low-level JSON request with the shared error shape and the acting-as identity header.
 *  App-specific clients (e.g. dpp-app's products) build on this. */
export async function requestJson<T>(
  method: string,
  url: string,
  opts: {
    body?: unknown;
    getIdentity?: () => string | null;
    identityHeader?: string;
    /** Which membership the request acts under — see `identityStore`. */
    getActingOrganisation?: () => string | null;
    actingOrganisationHeader?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<T> {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  // Both default to the shared store. An app-specific client that passed only
  // the identity used to leave a multi-membership user unresolved, and the
  // backend — refusing to guess which organisation was meant — fell back to the
  // anonymous role. The symptom was a baffling "role public not permitted" on a
  // user who plainly had the role. Pass `() => null` to opt out explicitly.
  const identity = (opts.getIdentity ?? identityStore.get)();
  if (identity) headers[opts.identityHeader ?? DEFAULT_IDENTITY_HEADER] = identity;
  // Sent separately from the identity on purpose: who you are is proved, which
  // organisation you act under is chosen. The backend refuses a choice the
  // subject holds no membership for, so this header grants nothing by itself.
  const actingOrg = (opts.getActingOrganisation ?? identityStore.getOrganisation)();
  if (actingOrg) headers[opts.actingOrganisationHeader ?? DEFAULT_ACTING_ORG_HEADER] = actingOrg;
  const res = await f(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = data && typeof data === "object" && "detail" in (data as Record<string, unknown>) ? (data as Record<string, unknown>).detail : data;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => (d as { msg?: string }).msg ?? JSON.stringify(d)).join("; ") : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail, message);
  }
  return data as T;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? (typeof detail === "string" ? detail : `HTTP ${status}`));
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface FetchClientOptions {
  /** Relative by default so the app stays same-origin (dev proxy / reverse proxy). */
  baseUrl?: string;
  /** Returns the identity (`sub`) to act as, or null for anonymous. */
  getIdentity?: () => string | null;
  /** Header carrying the dev identity. Only the dev identity source reads it. */
  identityHeader?: string;
  /** Which membership requests act under — see `identityStore`. */
  getActingOrganisation?: () => string | null;
  fetchImpl?: typeof fetch;
  /** Paths under the base (defaults match the shared backend routers). */
  paths?: Partial<typeof DEFAULT_PATHS>;
}

/** Header the dev identity source reads. Only the dev identity path knows about it. */
export const DEFAULT_IDENTITY_HEADER = "X-Dev-Sub";

/** Header carrying the organisation being acted under. Unlike the identity
 *  header, this one survives real authentication — the choice is still the
 *  user's to make, it just travels in a session or token claim instead. */
export const DEFAULT_ACTING_ORG_HEADER = "X-Acting-Org";

export const DEFAULT_PATHS = {
  rbac: "/admin/rbac",
  me: "/me",
};

export function createFetchClient(opts: FetchClientOptions = {}): AdminApiClient {
  const base = (opts.baseUrl ?? "/api").replace(/\/+$/, "");
  const paths = { ...DEFAULT_PATHS, ...(opts.paths ?? {}) };
  const header = opts.identityHeader ?? DEFAULT_IDENTITY_HEADER;

  const req = <T,>(method: string, path: string, body?: unknown, query?: Record<string, string | boolean | undefined>) =>
    requestJson<T>(method, `${base}${path}${queryString(query)}`, {
      body,
      getIdentity: opts.getIdentity,
      identityHeader: header,
      getActingOrganisation: opts.getActingOrganisation,
      fetchImpl: opts.fetchImpl,
    });

  const rbac = paths.rbac;
  return {
    me: () => req("GET", paths.me),

    listEntityTypes: () => req("GET", `${rbac}/entity-types`),
    listAttributes: (entity_type) => req("GET", `${rbac}/attributes`, undefined, { entity_type }),
    createAttribute: (b) => req("POST", `${rbac}/attributes`, b),
    deleteAttribute: (id) => req("DELETE", `${rbac}/attributes/${id}`),
    syncAttrs: () => req("POST", `${rbac}/sync-attrs`),
    listAttrPermissions: (entity_type) => req("GET", `${rbac}/permissions`, undefined, { entity_type }),
    updateAttrPermission: (id, b) => req("PATCH", `${rbac}/permissions/${id}`, b),
    listResourcePermissions: (resource_type) => req("GET", `${rbac}/resource-permissions`, undefined, { resource_type }),
    updateResourcePermission: (id, b) => req("PATCH", `${rbac}/resource-permissions/${id}`, b),
  };
}
