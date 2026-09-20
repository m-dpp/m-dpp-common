import { ReactNode, createContext, useContext, useMemo } from "react";
import { AdminApiClient, createFetchClient } from "./client";
import { identityStore } from "./identity";

const ApiContext = createContext<AdminApiClient | null>(null);

export interface ApiProviderProps {
  /** A full client, or omit and give a `baseUrl` to use the default fetch client. */
  client?: AdminApiClient;
  /** Default `/api` (relative — same origin). */
  baseUrl?: string;
  children: ReactNode;
}

export function ApiProvider({ client, baseUrl, children }: ApiProviderProps) {
  const value = useMemo(() => client ?? createFetchClient({ baseUrl, getIdentity: identityStore.get, getActingOrganisation: identityStore.getOrganisation }), [client, baseUrl]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): AdminApiClient {
  const c = useContext(ApiContext);
  if (!c) throw new Error("useApi: wrap the tree in <ApiProvider>");
  return c;
}
