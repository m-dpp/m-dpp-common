/**
 * A typed client for an mdpp-app instance — the one way any front-end talks to
 * mdpp.
 *
 * It carries **no app-specific logic**: no hierarchy, no chain walking, no
 * verdict. mdpp-app's own admin, dpp-app's Molecular tab and (later)
 * passport-app all use this same client against the same endpoints. A host that
 * has a hierarchy calls `comparison()` once per level and lays the answers out
 * itself — deciding *how many times to ask* is the only cross-level reasoning
 * anyone but mdpp is allowed to do.
 *
 * The base path is **relative** (default `/mdpp-api`), never a host and port: the
 * host app proxies that path to the mdpp backend so everything stays same-origin
 * and no CORS is involved, exactly as `/api` does for its own backend.
 *
 * Identity travels the same way as on the dpp client — the shared `identityStore`
 * feeds the same dev identity header — so switching "acting as" switches it for
 * both APIs at once.
 */

import { DEFAULT_IDENTITY_HEADER, queryString, requestJson } from "../api/client";
import type { Organisation, OrganisationRole } from "../api/types";
import { identityStore } from "../api/identity";
import type {
  ComparisonResponse,
  Declaration,
  DeclarationCreate,
  DeclarationListItem,
  DeclarationQuery,
  FibreNode,
  FibreNodeCreate,
  FibreNodeUpdate,
  Page,
  PathCounts,
  TestListItem,
  TestQuery,
  MdppPrincipal,
  TestRegister,
} from "./types";

/** Relative by default — a proxied path on the host's own origin. */
export const DEFAULT_MDPP_BASE = "/mdpp-api";

export interface MdppClientOptions {
  /** Relative path the host proxies to mdpp-app. Never a host:port. */
  baseUrl?: string;
  getIdentity?: () => string | null;
  identityHeader?: string;
  getActingOrganisation?: () => string | null;
  fetchImpl?: typeof fetch;
}

export interface MdppApiClient {
  readonly baseUrl: string;

  // declarations
  listDeclarations(q?: DeclarationQuery): Promise<Page<DeclarationListItem>>;
  getCurrentDeclaration(gs1Path: string): Promise<Declaration>;
  getDeclarationHistory(gs1Path: string): Promise<Declaration[]>;
  createDeclarationVersion(gs1Path: string, body: DeclarationCreate): Promise<Declaration>;
  withdrawDeclarationVersion(gs1Path: string, version: number): Promise<Declaration>;

  // tests
  listTests(q?: TestQuery): Promise<Page<TestListItem>>;
  listTestsForPath(gs1Path: string): Promise<unknown[]>;
  registerTest(gs1Path: string, body: TestRegister): Promise<unknown>;
  refreshTest(gs1Path: string, testId: string): Promise<unknown>;
  getTestResult(gs1Path: string, testId: string): Promise<unknown>;
  withdrawTest(gs1Path: string, testId: string): Promise<unknown>;

  // the comparison — one identifier per call, by design
  comparison(gs1Path: string, opts?: { declarationVersion?: number }): Promise<ComparisonResponse>;
  /** Several identifiers, still one call each — just awaited together. */
  comparisons(gs1Paths: string[]): Promise<Record<string, ComparisonResponse | null>>;

  // tree annotations
  counts(paths: string[]): Promise<Record<string, PathCounts>>;

  // the fibre taxonomy — the composition editor's picker, and the tree the
  // taxonomy screen edits (tolerance is an attribute on a node)
  listFibreNodes(opts?: { includeRemoved?: boolean }): Promise<FibreNode[]>;
  createFibreNode(body: FibreNodeCreate): Promise<FibreNode>;
  updateFibreNode(id: string, body: FibreNodeUpdate): Promise<FibreNode>;
  removeFibreNode(id: string): Promise<FibreNode>;
  restoreFibreNode(id: string): Promise<FibreNode>;

  /** Cheap liveness probe for the "About this installation" screen. */
  ping(): Promise<boolean>;

  /**
   * Who the current identity is **in mdpp**. The two services share no user
   * table, only the `sub`, so this can legitimately differ from the host app's
   * own principal — including resolving to the anonymous role here. A host must
   * ask rather than assume its own answer carries over.
   */
  me(): Promise<MdppPrincipal>;

  /**
   * Organisations **as mdpp knows them**, with their role assignments.
   *
   * Not the host app's. Anything that becomes an mdpp foreign key —
   * `laboratory_id` on a test — must be an id mdpp issued. The two services keep
   * separate organisation tables with separate UUIDs, so offering the host's
   * list produces "no organisation '<uuid>'" at the moment of writing.
   */
  listOrganisations(): Promise<Organisation[]>;
  listOrganisationRoles(): Promise<OrganisationRole[]>;
}

/** GS1 paths contain slashes that are part of the path, so each SEGMENT is
 *  encoded but the separators are kept. */
function encodePath(gs1Path: string): string {
  return gs1Path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function createMdppClient(opts: MdppClientOptions = {}): MdppApiClient {
  const base = (opts.baseUrl ?? DEFAULT_MDPP_BASE).replace(/\/+$/, "");
  const header = opts.identityHeader ?? DEFAULT_IDENTITY_HEADER;
  const getIdentity = opts.getIdentity ?? identityStore.get;
  // the SAME store the dpp client reads, so switching context switches it for
  // both APIs at once
  const getActingOrganisation = opts.getActingOrganisation ?? identityStore.getOrganisation;

  const req = <T,>(method: string, path: string, body?: unknown) =>
    requestJson<T>(method, `${base}${path}`, {
      body,
      getIdentity,
      identityHeader: header,
      getActingOrganisation,
      fetchImpl: opts.fetchImpl,
    });

  return {
    baseUrl: base,

    listDeclarations: (q = {}) =>
      req("GET", `/declarations${queryString({
        path_prefix: q.pathPrefix,
        level: q.level || undefined,
        declared_by: q.declaredBy,
        current_only: q.currentOnly,
        include_withdrawn: q.includeWithdrawn,
        limit: q.limit,
        offset: q.offset,
      })}`),
    getCurrentDeclaration: (p) => req("GET", `/${encodePath(p)}/declarations/current`),
    getDeclarationHistory: (p) => req("GET", `/${encodePath(p)}/declarations`),
    createDeclarationVersion: (p, body) => req("POST", `/${encodePath(p)}/declarations`, body),
    withdrawDeclarationVersion: (p, version) => req("DELETE", `/${encodePath(p)}/declarations/${version}`),

    listTests: (q = {}) =>
      req("GET", `/tests${queryString({
        path_prefix: q.pathPrefix,
        level: q.level || undefined,
        status: q.status || undefined,
        laboratory_id: q.laboratoryId,
        requested_by: q.requestedBy,
        analysis_type: q.analysisType || undefined,
        sort: q.sort,
        include_withdrawn: q.includeWithdrawn,
        limit: q.limit,
        offset: q.offset,
      })}`),
    listTestsForPath: (p) => req("GET", `/${encodePath(p)}/tests`),
    registerTest: (p, body) => req("POST", `/${encodePath(p)}/tests`, body),
    refreshTest: (p, id) => req("POST", `/${encodePath(p)}/tests/${id}/refresh`),
    getTestResult: (p, id) => req("GET", `/${encodePath(p)}/tests/${id}/result`),
    withdrawTest: (p, id) => req("DELETE", `/${encodePath(p)}/tests/${id}`),

    comparison: (p, o = {}) =>
      req("GET", `/${encodePath(p)}/comparison${queryString({ declaration_version: o.declarationVersion })}`),

    async comparisons(paths) {
      // One request per identifier — mdpp is flat and answers about exactly one.
      // A path with nothing on it (or a caller with no access) resolves to null
      // rather than rejecting the whole batch; a host showing a chain wants the
      // levels that DO have data, not an error because one level has none.
      const settled = await Promise.all(
        paths.map((p) =>
          this.comparison(p).then(
            (r) => [p, r] as const,
            () => [p, null] as const,
          ),
        ),
      );
      return Object.fromEntries(settled);
    },

    async counts(paths) {
      if (!paths.length) return {};
      const body = await req<{ counts: Record<string, PathCounts> }>("POST", "/counts", { paths });
      return body.counts;
    },

    async listFibreNodes(o = {}) {
      const body = await req<{ "@graph"?: FibreNode[] } | FibreNode[]>(
        "GET",
        `/fibre-nodes${queryString({ include_removed: o.includeRemoved })}`,
      );
      return Array.isArray(body) ? body : body["@graph"] ?? [];
    },
    createFibreNode: (b) => req("POST", "/fibre-nodes", b),
    updateFibreNode: (id, b) => req("PATCH", `/fibre-nodes/${id}`, b),
    removeFibreNode: (id) => req("DELETE", `/fibre-nodes/${id}`),
    restoreFibreNode: (id) => req("POST", `/fibre-nodes/${id}/restore`),

    me: () => req("GET", "/me"),

    async listOrganisations() {
      const body = await req<{ "@graph"?: Organisation[] } | Organisation[]>("GET", "/organisations");
      return Array.isArray(body) ? body : body["@graph"] ?? [];
    },
    listOrganisationRoles: () => req("GET", "/admin/rbac/organisation-roles"),

    async ping() {
      try {
        await req("GET", "/health");
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Re-exported so a host can narrow on a comparison without importing types twice. */
export type { ComparisonResponse, TestComparison } from "./types";
