import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useIdentity } from "../identity/context";
import { useMdppConnection } from "../mdpp/context";
import { useApi } from "./context";
import { useActingAs, useActingOrganisation } from "./identity";
import type { Principal, ResourceAction } from "./types";

export interface PrincipalState {
  principal: Principal | null;
  loading: boolean;
  error: string | null;
  /** Re-resolve (after switching identity, or when roles/memberships changed). */
  refresh: () => Promise<void>;
  /** Resource gate for the UI: hide/disable what the resolved roles may not do. */
  can: (resourceType: string, action: ResourceAction) => boolean;
  /** Does the principal hold this role? Prefer `can` — roles are data, not policy. */
  hasRole: (role: string) => boolean;
}

const Ctx = createContext<PrincipalState | null>(null);

/**
 * Resolves who is acting, and what they may do — from **every** service this
 * front-end talks to.
 *
 * The principal itself (subject, acting organisation, roles) is m-dpp-identity's
 * answer and is authoritative. The `permissions` map is assembled from several
 * sources, because each service governs different resource types: identity
 * answers for `organisations`, `subjects` and `rbac`; the app answers for its
 * own entities (`products`, `declarations`, …); and when a host is connected to
 * mdpp as a second service, mdpp answers for the resource types it governs
 * (`fibre_nodes`, `declarations`, `tests`) — so a host that proxies an mdpp
 * screen gates it on mdpp's policy, not on a guess. (`can` says "allowed" for a
 * resource type nobody answered about, which is the right dev posture for an
 * unknown type and the wrong one for a type another service does govern.)
 *
 * Merged rather than chosen between: a UI that asked only its app would hide
 * the Organisations screen, and one that asked only identity would hide
 * Products. Neither service is lying — they are answering about different
 * things. The app's answer is merged last: a key both it and mdpp know (`rbac`)
 * means the app's OWN matrices on the app's own screen.
 *
 * All are re-fetched whenever the identity OR the acting organisation changes,
 * because both decide what the principal is.
 */
export function PrincipalProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const identity = useIdentity();
  // null when the host never mounted an MdppProvider; disabled when it did but
  // is not connected. Only an ENABLED connection is asked.
  const mdpp = useMdppConnection();
  const mdppClient = mdpp?.enabled ? mdpp.client : null;
  const [actingAs] = useActingAs();
  const [actingOrg] = useActingOrganisation();
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Settled, not awaited together: an app backend that is down must not
      // hide who you are, and identity being down is worth reporting even if
      // the app answered.
      const [fromIdentity, fromApp, fromMdpp] = await Promise.allSettled([
        identity.me(),
        api.me(),
        // mdpp being down is the Molecular surfaces' concern (they say so
        // themselves); here it only means its resource types go unanswered
        mdppClient ? mdppClient.me() : Promise.resolve(null),
      ]);
      if (fromIdentity.status === "rejected") throw fromIdentity.reason;
      const base = fromIdentity.value;
      const appPermissions =
        fromApp.status === "fulfilled" ? (fromApp.value.permissions ?? {}) : {};
      const mdppPermissions =
        fromMdpp.status === "fulfilled" ? (fromMdpp.value?.permissions ?? {}) : {};
      setPrincipal({
        ...base,
        permissions: { ...(base.permissions ?? {}), ...mdppPermissions, ...appPermissions },
      });
      setError(fromApp.status === "rejected" ? errorText(fromApp.reason) : null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [api, identity, mdppClient]);

  useEffect(() => {
    void refresh();
    // BOTH inputs re-resolve the principal: changing identity changes who you
    // are, and changing organisation changes the authority you hold.
  }, [refresh, actingAs, actingOrg]);

  const value = useMemo<PrincipalState>(
    () => ({
      principal,
      loading,
      error,
      refresh,
      // unknown resource type or no principal yet → allowed (mirrors the engine's dev posture);
      // the backend remains the authority and will 403 if the UI guesses wrong.
      can: (rt, action) => principal?.permissions?.[rt]?.[action] ?? true,
      hasRole: (role) => principal?.roles.includes(role) ?? false,
    }),
    [principal, loading, error, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function usePrincipal(): PrincipalState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrincipal: wrap the tree in <PrincipalProvider>");
  return v;
}
