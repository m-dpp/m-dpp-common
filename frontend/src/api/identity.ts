/**
 * The "acting as" identity store — a DEVELOPMENT affordance.
 *
 * Holds the `sub` the UI currently acts as (null = anonymous) and persists it in
 * localStorage so a reload keeps the identity. The fetch client reads it through
 * `getIdentity` and sends it in the dev identity header; the backend's dev identity
 * source resolves it to a principal. With real authentication this store goes away.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "mdpp.actingAs";
const listeners = new Set<() => void>();
let current: string | null = readStorage();

function readStorage(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

export const identityStore = {
  get: (): string | null => current,
  set(sub: string | null) {
    current = sub && sub.trim() ? sub.trim() : null;
    try {
      if (current) localStorage.setItem(STORAGE_KEY, current);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode etc. — in-memory only */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** The identity currently acted as, and a setter. */
export function useActingAs(): [string | null, (sub: string | null) => void] {
  const sub = useSyncExternalStore(identityStore.subscribe, identityStore.get, () => null);
  return [sub, identityStore.set];
}
