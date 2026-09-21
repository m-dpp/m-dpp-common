/**
 * A typed client for m-dpp-identity — the one way any front-end reaches the
 * identity service.
 *
 * The base path is **relative** (default `/identity-api`), never a host and
 * port: the host app proxies that path to identity so everything stays
 * same-origin and no CORS is involved, exactly as `/api` does for its own
 * backend and `/mdpp-api` for mdpp.
 *
 * Identity travels the same way as on the other clients — the shared
 * `identityStore` feeds the same headers — so switching "acting as" switches it
 * for every API at once.
 *
 * **This client never holds the service token.** The token is how an app's
 * *backend* proves it is a trusted process, and a browser must never be able to
 * resolve a principal for an arbitrary subject. From here, `me()` resolves only
 * the current identity, which is the whole point of the split.
 */

import { queryString, requestJson } from "../api/client";
import { identityStore } from "../api/identity";
import type { RbacApi } from "../api/client";
import type {
  IdentityAbout,
  IdentityEvent,
  LabConfig,
  Membership,
  Organisation,
  OrganisationCreate,
  OrganisationKey,
  OrganisationKeyCreate,
  OrganisationRole,
  OrganisationUpdate,
  Principal,
  Role,
  RoleCreate,
  RoleUpdate,
  Subject,
  SubjectCreate,
} from "../api/types";

/** Relative by default — a proxied path on the host's own origin. */
export const DEFAULT_IDENTITY_BASE = "/identity-api";

export interface IdentityApiClient extends RbacApi {
  // organisations
  listOrganisations(opts?: { includeRemoved?: boolean; role?: string }): Promise<Organisation[]>;
  getOrganisation(id: string): Promise<Organisation>;
  createOrganisation(body: OrganisationCreate): Promise<Organisation>;
  updateOrganisation(id: string, body: OrganisationUpdate): Promise<Organisation>;
  removeOrganisation(id: string): Promise<Organisation>;

  // a laboratory's results endpoint — the pair m-dpp-app's /refresh depends on
  getLabConfig(organisationId: string): Promise<LabConfig>;
  setLabConfig(organisationId: string, body: { lab_results_endpoint: string | null; lab_active: boolean }): Promise<LabConfig>;

  // public keys — rotated, never replaced
  listKeys(organisationId: string): Promise<OrganisationKey[]>;
  addKey(organisationId: string, body: OrganisationKeyCreate): Promise<OrganisationKey>;
  revokeKey(organisationId: string, kid: string): Promise<OrganisationKey>;

  // roles (dynamic data) — defined here and nowhere else
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
  listMemberships(opts?: { subjectId?: string; organisationId?: string }): Promise<Membership[]>;
  createMembership(subjectId: string, organisationId: string, isOrgAdmin?: boolean): Promise<Membership>;
  setMembershipOrgAdmin(id: string, isOrgAdmin: boolean): Promise<Membership>;
  deleteMembership(id: string): Promise<void>;

  /** The current principal, resolved from the headers this client sends.
   *  Only ever the caller's own — naming another subject needs the service
   *  token, which lives in an app's backend. */
  me(): Promise<Principal>;

  /** Who linked whom, who granted which role, when. */
  listAudit(opts?: { organisationId?: string; subjectId?: string; eventType?: string; limit?: number }): Promise<IdentityEvent[]>;

  about(): Promise<IdentityAbout>;
}

export interface IdentityClientOptions {
  /** Relative path the host proxies to identity. Never a host:port. */
  baseUrl?: string;
  getIdentity?: () => string | null;
  identityHeader?: string;
  getActingOrganisation?: () => string | null;
  fetchImpl?: typeof fetch;
}

export function createIdentityClient(opts: IdentityClientOptions = {}): IdentityApiClient {
  const base = (opts.baseUrl ?? DEFAULT_IDENTITY_BASE).replace(/\/+$/, "");

  const req = <T,>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ) =>
    requestJson<T>(method, `${base}${path}${queryString(query)}`, {
      body,
      getIdentity: opts.getIdentity ?? identityStore.get,
      identityHeader: opts.identityHeader,
      getActingOrganisation: opts.getActingOrganisation ?? identityStore.getOrganisation,
      fetchImpl: opts.fetchImpl,
    });

  const rbac = "/admin/rbac";
  return {
    listOrganisations: (o) =>
      req("GET", "/organisations", undefined, { include_removed: o?.includeRemoved, role: o?.role }),
    getOrganisation: (id) => req("GET", `/organisations/${id}`),
    createOrganisation: (b) => req("POST", "/organisations", b),
    updateOrganisation: (id, b) => req("PATCH", `/organisations/${id}`, b),
    removeOrganisation: (id) => req("DELETE", `/organisations/${id}`),

    getLabConfig: (id) => req("GET", `/organisations/${id}/lab-config`),
    setLabConfig: (id, b) => req("PUT", `/organisations/${id}/lab-config`, b),

    listKeys: (id) => req("GET", `/organisations/${id}/keys`),
    addKey: (id, b) => req("POST", `/organisations/${id}/keys`, b),
    revokeKey: (id, kid) => req("DELETE", `/organisations/${id}/keys/${encodeURIComponent(kid)}`),

    listRoles: () => req("GET", `${rbac}/roles`),
    createRole: (b) => req("POST", `${rbac}/roles`, b),
    updateRole: (name, b) => req("PATCH", `${rbac}/roles/${name}`, b),

    listOrganisationRoles: () => req("GET", `${rbac}/organisation-roles`),
    addOrganisationRole: (organisation_id, role_name) =>
      req("POST", `${rbac}/organisation-roles`, { organisation_id, role_name }),
    removeOrganisationRole: (id) => req("DELETE", `${rbac}/organisation-roles/${id}`),

    listSubjects: () => req("GET", "/subjects"),
    createSubject: (b) => req("POST", "/subjects", b),
    deleteSubject: (id) => req("DELETE", `/subjects/${id}`),
    listMemberships: (o) =>
      req("GET", "/memberships", undefined, {
        subject_id: o?.subjectId,
        organisation_id: o?.organisationId,
      }),
    createMembership: (subject_id, organisation_id, is_org_admin = false) =>
      req("POST", "/memberships", { subject_id, organisation_id, is_org_admin }),
    setMembershipOrgAdmin: (id, is_org_admin) =>
      req("PATCH", `/memberships/${id}`, { is_org_admin }),
    deleteMembership: (id) => req("DELETE", `/memberships/${id}`),

    me: () => req("GET", "/me"),

    listAudit: (o) =>
      req("GET", "/audit", undefined, {
        organisation_id: o?.organisationId,
        subject_id: o?.subjectId,
        event_type: o?.eventType,
        limit: o?.limit,
      }),

    about: () => req("GET", "/about"),

    listEntityTypes: () => req("GET", `${rbac}/entity-types`),
    listAttributes: (entity_type) => req("GET", `${rbac}/attributes`, undefined, { entity_type }),
    createAttribute: (b) => req("POST", `${rbac}/attributes`, b),
    deleteAttribute: (id) => req("DELETE", `${rbac}/attributes/${id}`),
    syncAttrs: () => req("POST", `${rbac}/sync-attrs`),
    listAttrPermissions: (entity_type) => req("GET", `${rbac}/permissions`, undefined, { entity_type }),
    updateAttrPermission: (id, b) => req("PATCH", `${rbac}/permissions/${id}`, b),
    listResourcePermissions: (resource_type) =>
      req("GET", `${rbac}/resource-permissions`, undefined, { resource_type }),
    updateResourcePermission: (id, b) => req("PATCH", `${rbac}/resource-permissions/${id}`, b),
  };
}
