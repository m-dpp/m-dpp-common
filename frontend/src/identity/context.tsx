import { ReactNode, createContext, useContext, useMemo } from "react";
import { identityStore } from "../api/identity";
import { DEFAULT_IDENTITY_BASE, IdentityApiClient, createIdentityClient } from "./client";

/**
 * How this front-end reaches m-dpp-identity.
 *
 * Unlike the mdpp connection, this one is **not optional**. Every app resolves
 * its principal through identity, and the shared Organisations, Users & links,
 * Roles and acting-as screens have nowhere else to read from. A host that did
 * not mount this provider has no identity at all, which is a configuration
 * error rather than a mode — so `useIdentity()` throws rather than degrading.
 */
const IdentityContext = createContext<IdentityApiClient | null>(null);

export interface IdentityProviderProps {
  /** Relative path the host proxies to identity. Default `/identity-api`. */
  baseUrl?: string;
  /** Supply a whole client instead (tests, or a host with its own transport). */
  client?: IdentityApiClient;
  children: ReactNode;
}

export function IdentityProvider({ baseUrl, client, children }: IdentityProviderProps) {
  const value = useMemo<IdentityApiClient>(
    () =>
      client ??
      createIdentityClient({
        baseUrl: (baseUrl ?? DEFAULT_IDENTITY_BASE).replace(/\/+$/, ""),
        getIdentity: identityStore.get,
        getActingOrganisation: identityStore.getOrganisation,
      }),
    [baseUrl, client],
  );
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityApiClient {
  const c = useContext(IdentityContext);
  if (!c) throw new Error("useIdentity: wrap the tree in <IdentityProvider>");
  return c;
}
