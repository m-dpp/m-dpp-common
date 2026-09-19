import type {
  AttrPermission,
  Membership,
  Organisation,
  OrganisationCreate,
  OrganisationRole,
  OrganisationUpdate,
  Principal,
  RbacAttribute,
  ResourcePermission,
  Role,
  RoleCreate,
  RoleUpdate,
  Subject,
  SubjectCreate,
  SyncAttrsResult,
} from "./types";

/**
 * What the shared screens need from a backend. The consuming app supplies an
 * implementation — normally `createFetchClient({ baseUrl })` — through `ApiProvider`.
 * No URLs, no app-specific entities.
 */
export interface AdminApiClient {
  // organisations
  listOrganisations(opts?: { includeRemoved?: boolean }): Promise<Organisation[]>;
  getOrganisation(id: string): Promise<Organisation>;
  createOrganisation(body: OrganisationCreate): Promise<Organisation>;
  updateOrganisation(id: string, body: OrganisationUpdate): Promise<Organisation>;
  removeOrganisation(id: string): Promise<Organisation>;

  // roles (dynamic data)
  listRoles(): Promise<Role[]>;
  createRole(body: RoleCreate): Promise<Role>;
  updateRole(name: string, body: RoleUpdate): Promise<Role>;

  // organisation ↔ role
  listOrganisationRoles(): Promise<OrganisationRole[]>;
  addOrganisationRole(organisationId: string, roleName: string): Promise<OrganisationRole>;
  removeOrganisationRole(assignmentId: string): Promise<void>;

  // subjects & memberships
  listSubjects(): Promise<Subject[]>;
  createSubject(body: SubjectCreate): Promise<Subject>;
  deleteSubject(id: string): Promise<void>;
  listMemberships(): Promise<Membership[]>;
  createMembership(subjectId: string, organisationId: string): Promise<Membership>;
  deleteMembership(id: string): Promise<void>;

  // the current principal ("who am I acting as")
  me(): Promise<Principal>;

  // RBAC
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
  opts: { body?: unknown; getIdentity?: () => string | null; identityHeader?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const identity = opts.getIdentity?.();
  if (identity) headers[opts.identityHeader ?? DEFAULT_IDENTITY_HEADER] = identity;
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
  fetchImpl?: typeof fetch;
  /** Paths under the base (defaults match the shared backend routers). */
  paths?: Partial<typeof DEFAULT_PATHS>;
}

/** Header the dev identity source reads. Only the dev identity path knows about it. */
export const DEFAULT_IDENTITY_HEADER = "X-Dev-Sub";

export const DEFAULT_PATHS = {
  organisations: "/organisations",
  rbac: "/admin/rbac",
  subjects: "/subjects",
  memberships: "/memberships",
  me: "/me",
};

export function createFetchClient(opts: FetchClientOptions = {}): AdminApiClient {
  const base = (opts.baseUrl ?? "/api").replace(/\/+$/, "");
  const paths = { ...DEFAULT_PATHS, ...(opts.paths ?? {}) };
  const header = opts.identityHeader ?? DEFAULT_IDENTITY_HEADER;

  const req = <T,>(method: string, path: string, body?: unknown, query?: Record<string, string | boolean | undefined>) =>
    requestJson<T>(method, `${base}${path}${queryString(query)}`, { body, getIdentity: opts.getIdentity, identityHeader: header, fetchImpl: opts.fetchImpl });

  const rbac = paths.rbac;
  return {
    listOrganisations: (o) => req("GET", paths.organisations, undefined, { include_removed: o?.includeRemoved }),
    getOrganisation: (id) => req("GET", `${paths.organisations}/${id}`),
    createOrganisation: (b) => req("POST", paths.organisations, b),
    updateOrganisation: (id, b) => req("PATCH", `${paths.organisations}/${id}`, b),
    removeOrganisation: (id) => req("DELETE", `${paths.organisations}/${id}`),

    listRoles: () => req("GET", `${rbac}/roles`),
    createRole: (b) => req("POST", `${rbac}/roles`, b),
    updateRole: (name, b) => req("PATCH", `${rbac}/roles/${name}`, b),

    listOrganisationRoles: () => req("GET", `${rbac}/organisation-roles`),
    addOrganisationRole: (organisation_id, role_name) => req("POST", `${rbac}/organisation-roles`, { organisation_id, role_name }),
    removeOrganisationRole: (id) => req("DELETE", `${rbac}/organisation-roles/${id}`),

    listSubjects: () => req("GET", paths.subjects),
    createSubject: (b) => req("POST", paths.subjects, b),
    deleteSubject: (id) => req("DELETE", `${paths.subjects}/${id}`),
    listMemberships: () => req("GET", paths.memberships),
    createMembership: (subject_id, organisation_id) => req("POST", paths.memberships, { subject_id, organisation_id }),
    deleteMembership: (id) => req("DELETE", `${paths.memberships}/${id}`),

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
