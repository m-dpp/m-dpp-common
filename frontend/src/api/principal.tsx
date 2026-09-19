import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useApi } from "./context";
import { useActingAs } from "./identity";
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

/** Fetches `/me` and re-fetches whenever the acting-as identity changes. */
export function PrincipalProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [actingAs] = useActingAs();
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPrincipal(await api.me());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, actingAs]);

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

export function usePrincipal(): PrincipalState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrincipal: wrap the tree in <PrincipalProvider>");
  return v;
}
