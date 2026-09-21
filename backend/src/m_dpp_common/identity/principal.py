"""The auth seam, resolved through m-dpp-identity.

    identity source (X-Dev-Sub, dev only)  ─┐
    acting organisation (X-Acting-Org)     ─┴─→  IdentityClient  →  principal

An app's `get_principal` is built here and is otherwise unchanged from the
caller's point of view: the same dict, the same keys, the same
`principal["roles"]` semantics. What changed is where the answer comes from.
The apps no longer hold `subjects`, `memberships`, `organisations` or `roles`
tables to resolve it against.

Only the *identity source* is temporary. Swapping to real authentication means
passing a JWT-validating dependency as `identity=`; nothing else moves.

**A cache, and why it is short.** This runs on every request that needs to know
who is asking, so without a cache a page of thirty API calls is thirty HTTP
round trips to identity. The cache is keyed on ``(sub, acting_org)`` and holds
for a few seconds — long enough to collapse a burst, short enough that a
membership change takes effect while the administrator is still looking at the
screen. Negative answers are cached on the same terms: an unknown subject is a
question asked just as often as a known one.

**An outage is never a permission change.** If identity cannot answer, the
dependency raises **503**. It deliberately does not fall back to the anonymous
role, which would turn an outage into a silent demotion and tell the user their
*role* was the problem.
"""

from __future__ import annotations

import os
import time

from fastapi import Depends, HTTPException

from m_dpp_common.auth.acting_organisation import acting_organisation as dev_acting_organisation
from m_dpp_common.auth.dev_identity import identity as dev_identity
from m_dpp_common.identity.client import IdentityClient, IdentityUnavailable

PRINCIPAL_CACHE_TTL_ENV = "IDENTITY_PRINCIPAL_CACHE_TTL"
DEFAULT_CACHE_TTL = 5.0

#: Bounded so a stream of unknown subjects cannot grow it without limit. Small:
#: the working set is the people using the installation right now.
_MAX_ENTRIES = 512


class PrincipalCache:
    """A tiny TTL cache. Not thread-safe by design — one event loop per worker."""

    def __init__(self, ttl: float | None = None, max_entries: int = _MAX_ENTRIES) -> None:
        self.ttl = ttl if ttl is not None else float(os.getenv(PRINCIPAL_CACHE_TTL_ENV, DEFAULT_CACHE_TTL))
        self.max_entries = max_entries
        self._entries: dict[tuple[str | None, str | None], tuple[float, dict]] = {}

    def get(self, key: tuple[str | None, str | None]) -> dict | None:
        if self.ttl <= 0:
            return None
        hit = self._entries.get(key)
        if hit is None:
            return None
        stored_at, principal = hit
        if time.monotonic() - stored_at > self.ttl:
            self._entries.pop(key, None)
            return None
        return principal

    def put(self, key: tuple[str | None, str | None], principal: dict) -> None:
        if self.ttl <= 0:
            return
        if len(self._entries) >= self.max_entries:
            # Oldest first. A precise LRU would need a second structure for a
            # cache this size and this short-lived.
            oldest = min(self._entries, key=lambda k: self._entries[k][0])
            self._entries.pop(oldest, None)
        self._entries[key] = (time.monotonic(), principal)

    def clear(self) -> None:
        self._entries.clear()


def make_get_principal(
    *,
    client: IdentityClient,
    identity=dev_identity,
    acting=dev_acting_organisation,
    cache: PrincipalCache | None = None,
):
    """Build the service's ``get_principal`` FastAPI dependency.

    ``identity`` answers *who* (default: the dev header); replacing it with a
    JWT-validating dependency is the whole production switch. ``acting`` answers
    *on whose behalf* — a selector among the subject's own memberships, never a
    credential.
    """
    principal_cache = cache if cache is not None else PrincipalCache()

    async def get_principal(
        sub: str | None = Depends(identity),
        acting_org: str | None = Depends(acting),
    ) -> dict:
        key = (sub, acting_org)
        cached = principal_cache.get(key)
        if cached is not None:
            return cached
        try:
            principal = await client.resolve_principal(sub, acting_org)
        except IdentityUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"cannot determine who you are: {exc}. This is an outage, not a "
                    "permission problem — nothing has changed about your access."
                ),
            ) from exc
        principal_cache.put(key, principal)
        return principal

    # Exposed so an app can drop a stale answer after it changes something that
    # would alter it (there is nothing here that does, today — identity owns
    # those writes — but a test needs it, and so will a future webhook).
    get_principal.cache = principal_cache  # type: ignore[attr-defined]
    return get_principal


async def wait_for_identity(client: IdentityClient, *, attempts: int = 30, delay: float = 2.0) -> bool:
    """Block until identity answers, or give up after ``attempts``.

    Called from an app's lifespan. **Giving up does not stop the app from
    starting**: a backend that refuses to boot because identity is slow is a
    backend that cannot be debugged, and every request will report 503 with a
    clear reason anyway. Returns whether identity answered, so the caller can
    log the difference.
    """
    import asyncio

    for attempt in range(1, attempts + 1):
        if await client.health():
            return True
        if attempt < attempts:
            await asyncio.sleep(delay)
    return False
