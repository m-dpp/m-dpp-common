/**
 * What the UI is currently acting as: an identity, and an organisation.
 *
 * These are two different things and only the first is temporary:
 *
 * - **identity** (`sub`) — who you are. A DEVELOPMENT affordance; with real
 *   authentication this half goes away and the `sub` comes from a token.
 * - **acting organisation** — which of your memberships you are acting under.
 *   This is NOT temporary: a user with several memberships must choose, and the
 *   choice decides both authority and what new data is owned by. It survives
 *   real authentication unchanged.
 *
 * Both persist in localStorage so a reload keeps the context. Changing the
 * identity clears the organisation, because an organisation chosen for one user
 * means nothing for another — carrying it over would silently act under a
 * membership the new identity may not even hold.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "mdpp.actingAs";
const ORG_STORAGE_KEY = "mdpp.actingOrg";
const listeners = new Set<() => void>();
let current: string | null = read(STORAGE_KEY);
let currentOrg: string | null = read(ORG_STORAGE_KEY);

function read(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode etc. — in-memory only */
  }
}

export const identityStore = {
  get: (): string | null => current,
  set(sub: string | null) {
    const next = sub && sub.trim() ? sub.trim() : null;
    if (next !== current) {
      current = next;
      write(STORAGE_KEY, current);
      // a different person: any organisation chosen for the previous one is
      // meaningless, and carrying it over would act under a membership the new
      // identity may not hold
      currentOrg = null;
      write(ORG_STORAGE_KEY, null);
    }
    listeners.forEach((l) => l());
  },

  /** The membership being acted under, or null to let it be implied (only
   *  unambiguous when the subject has exactly one). */
  getOrganisation: (): string | null => currentOrg,
  setOrganisation(organisationId: string | null) {
    currentOrg = organisationId && organisationId.trim() ? organisationId.trim() : null;
    write(ORG_STORAGE_KEY, currentOrg);
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

/** The organisation currently acted under, and a setter. */
export function useActingOrganisation(): [string | null, (id: string | null) => void] {
  const org = useSyncExternalStore(
    identityStore.subscribe,
    identityStore.getOrganisation,
    () => null,
  );
  return [org, identityStore.setOrganisation];
}
