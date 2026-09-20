import { useMemo } from "react";
import { useApi } from "../api/context";
import type { Organisation, OrganisationRole } from "../api/types";
import { useAsync } from "./useAsync";

/** The two calls this hook needs — satisfied by the dpp client and the mdpp one
 *  alike, so a caller picks WHICH SERVICE the organisations come from. */
export interface OrganisationSource {
  listOrganisations(opts?: { includeRemoved?: boolean }): Promise<Organisation[]>;
  listOrganisationRoles(): Promise<OrganisationRole[]>;
}

/**
 * Live organisations holding a given role — for pickers that should only offer
 * organisations the backend will actually accept.
 *
 * An operator filter listing laboratories, or a laboratory picker listing
 * brands, offers choices that produce either an empty result or a 422. Roles
 * are data, not a hardcoded list, so the filter follows whatever roles are
 * actually assigned rather than a name baked into the UI.
 *
 * **`source` decides which service answers, and it matters.** Each app keeps its
 * own organisation table with its own UUIDs, so a picker whose value becomes a
 * foreign key in service B must list service B's organisations. Defaults to the
 * host's own API, which is right whenever the value stays in the host.
 *
 * Pass `role: null` to get every live organisation, so a caller can keep one
 * code path.
 */
export function useOrganisationsWithRole(role: string | null, source?: OrganisationSource): {
  organisations: Organisation[];
  loading: boolean;
  error: string | null;
} {
  const hostApi = useApi();
  const api: OrganisationSource = source ?? hostApi;
  const orgs = useAsync(() => api.listOrganisations(), [api]);
  // open endpoint: role assignments are readable so the UI can filter on them
  const assignments = useAsync(() => (role ? api.listOrganisationRoles() : Promise.resolve([])), [api, role]);

  const organisations = useMemo(() => {
    const live = (orgs.data ?? []).filter((o) => !o.removed_at);
    if (!role) return live;
    const holders = new Set(
      (assignments.data ?? []).filter((a) => a.role_name === role).map((a) => a.organisation_id),
    );
    return live.filter((o) => holders.has(o.id));
  }, [orgs.data, assignments.data, role]);

  return {
    organisations,
    loading: orgs.loading || assignments.loading,
    error: orgs.error ?? assignments.error,
  };
}
