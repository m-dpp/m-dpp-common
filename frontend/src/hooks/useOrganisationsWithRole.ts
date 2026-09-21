import { useMemo } from "react";
import { useIdentity } from "../identity/context";
import type { Organisation } from "../api/types";
import { useAsync } from "./useAsync";

/**
 * Live organisations holding a given role — for pickers that should only offer
 * organisations the backend will actually accept.
 *
 * An operator filter listing laboratories, or a laboratory picker listing
 * brands, offers choices that produce either an empty result or a 422. Roles
 * are data, not a hardcoded list, so the filter follows whatever roles are
 * actually assigned rather than a name baked into the UI.
 *
 * **There used to be a `source` argument**, because each app kept its own
 * organisation table with its own UUIDs and a picker whose value became a
 * foreign key in service B had to list service B's organisations. Organisations
 * live in m-dpp-identity now — one row, one id, the same everywhere — so there
 * is one answer and nothing to choose between.
 *
 * Pass `role: null` to get every live organisation, so a caller can keep one
 * code path.
 */
export function useOrganisationsWithRole(role: string | null): {
  organisations: Organisation[];
  loading: boolean;
  error: string | null;
} {
  const identity = useIdentity();
  // `role` is pushed down to the server: identity can filter on the assignment
  // join, and a picker should not download every organisation to discard most.
  const orgs = useAsync(
    () => identity.listOrganisations(role ? { role } : undefined),
    [identity, role],
  );

  const organisations = useMemo(
    // The platform organisation is deliberately never offered: it cannot be a
    // product's operator or a test's laboratory, so listing it would only
    // produce a 422 on submit.
    () => (orgs.data ?? []).filter((o) => !o.removed_at && !o.is_platform),
    [orgs.data],
  );

  return { organisations, loading: orgs.loading, error: orgs.error };
}
