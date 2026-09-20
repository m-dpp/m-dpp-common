import { ReactNode, createContext, useContext, useMemo } from "react";
import { identityStore } from "../api/identity";
import { DEFAULT_MDPP_BASE, MdppApiClient, createMdppClient } from "./client";

/**
 * Whether this front-end is connected to an mdpp-app instance, and how to reach it.
 *
 * `enabled` is **deployment configuration, not a runtime setting** — a host reads
 * it from its environment at build/startup and passes it here. When it is false
 * the host renders no mdpp surface at all and the client is never called, so an
 * unconfigured deployment behaves exactly as if mdpp did not exist.
 */
export interface MdppConnection {
  enabled: boolean;
  /** Relative path the host proxies to mdpp-app (default `/mdpp-api`). */
  baseUrl: string;
  client: MdppApiClient;
}

const MdppContext = createContext<MdppConnection | null>(null);

export interface MdppProviderProps {
  /** Default: enabled only when a base path was given. */
  enabled?: boolean;
  /** Relative path, never a host:port. Default `/mdpp-api`. */
  baseUrl?: string;
  /** Supply a whole client instead (tests, or a host with its own transport). */
  client?: MdppApiClient;
  children: ReactNode;
}

export function MdppProvider({ enabled, baseUrl, client, children }: MdppProviderProps) {
  const value = useMemo<MdppConnection>(() => {
    const base = (baseUrl ?? DEFAULT_MDPP_BASE).replace(/\/+$/, "");
    return {
      enabled: enabled ?? Boolean(baseUrl || client),
      baseUrl: base,
      client: client ?? createMdppClient({ baseUrl: base, getIdentity: identityStore.get, getActingOrganisation: identityStore.getOrganisation }),
    };
  }, [enabled, baseUrl, client]);

  return <MdppContext.Provider value={value}>{children}</MdppContext.Provider>;
}

/** The connection, or `null` when the host never mounted a provider. */
export function useMdppConnection(): MdppConnection | null {
  return useContext(MdppContext);
}

/** True when this front-end is configured to talk to mdpp. */
export function useMdppEnabled(): boolean {
  return useMdppConnection()?.enabled ?? false;
}

/** The client. Throws when mdpp is not configured — call it only under a guard
 *  (`useMdppEnabled()`), so an unconfigured host cannot make an mdpp request by
 *  accident. */
export function useMdpp(): MdppApiClient {
  const conn = useContext(MdppContext);
  if (!conn) throw new Error("useMdpp: wrap the tree in <MdppProvider>");
  if (!conn.enabled) throw new Error("useMdpp: this deployment is not connected to mdpp-app");
  return conn.client;
}
