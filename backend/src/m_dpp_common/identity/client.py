"""A typed async client for m-dpp-identity.

This is the **only** way an app's backend reaches the identity service. It is
deliberately small: the apps need to resolve a principal, look an organisation
up, and read a laboratory's configuration. Everything else about identity is
administered through the shared screens, which talk to it from the browser.

**The apps call identity as infrastructure, not as a peer service.** The system
rule that services never call each other at runtime is intact for what it
protects: neither app depends on the other, and mdpp still holds no client, URL
or configuration naming dpp. Identity is in the same category as the database
and the identity provider — things every service already calls without anyone
calling it a violation.

Two failure modes are distinguished on purpose, because they need different
answers:

* :class:`IdentityUnavailable` — identity could not be reached, or answered 5xx.
  The app does not know who the caller is and must say so (503), **never** fall
  back to the anonymous role. Falling back would turn an outage into a silent
  permission change, and a write refused because "you are public" is a far worse
  diagnosis than "identity is down".
* an ordinary anonymous principal — identity answered, and the answer is that
  this subject resolves to nothing. That is a normal, expected reply carrying a
  ``reason`` the UI can show.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

#: Header the identity service reads to recognise a trusted service (an app
#: backend). A browser never holds it — see the service's DESIGN §7.
SERVICE_TOKEN_HEADER = "X-Service-Token"

IDENTITY_API_BASE_ENV = "IDENTITY_API_BASE"
IDENTITY_SERVICE_TOKEN_ENV = "IDENTITY_SERVICE_TOKEN"
IDENTITY_TIMEOUT_ENV = "IDENTITY_HTTP_TIMEOUT"


class IdentityUnavailable(RuntimeError):
    """Identity could not answer. NOT the same as "this caller is anonymous"."""


class IdentityClient:
    """Calls m-dpp-identity on behalf of an app backend.

    One instance per app, built at import time from the environment. It holds a
    single ``httpx.AsyncClient`` so connections are pooled — this is on the hot
    path of every request that needs a principal.
    """

    def __init__(
        self,
        base_url: str | None = None,
        *,
        service_token: str | None = None,
        timeout: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv(IDENTITY_API_BASE_ENV, "http://identity:8000")).rstrip("/")
        self.service_token = (
            service_token
            if service_token is not None
            else os.getenv(IDENTITY_SERVICE_TOKEN_ENV, "")
        ).strip()
        self.timeout = timeout if timeout is not None else float(os.getenv(IDENTITY_TIMEOUT_ENV, "5"))
        self._client = httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout, transport=transport
        )

    # ------------------------------------------------------------------ plumbing

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.service_token:
            headers[SERVICE_TOKEN_HEADER] = self.service_token
        return headers

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        try:
            response = await self._client.get(path, params=clean, headers=self._headers())
        except httpx.HTTPError as exc:
            raise IdentityUnavailable(f"identity service unreachable at {self.base_url}: {exc}") from exc
        if response.status_code >= 500:
            raise IdentityUnavailable(
                f"identity service returned {response.status_code} for {path}"
            )
        if response.status_code == 403 and not self.service_token:
            # The single most likely misconfiguration, and the least obvious from
            # its symptom: without the token every principal resolves anonymous
            # and the user is told their ROLE is at fault.
            raise IdentityUnavailable(
                f"identity refused this service: no {IDENTITY_SERVICE_TOKEN_ENV} is configured"
            )
        response.raise_for_status()
        return response.json()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------- the API

    async def resolve_principal(
        self, sub: str | None, acting_org: str | None = None
    ) -> dict:
        """The hot path. Returns the principal as identity documents it.

        An unresolvable subject is a normal answer (``anonymous: True`` with a
        ``reason``), not an exception.
        """
        return await self._get("/principal", {"sub": sub, "acting_org": acting_org})

    async def get_organisation(self, organisation_id: str) -> dict | None:
        """One organisation, or None if identity does not know it.

        None is a real possibility now and the callers must cope: an app's
        ``operator_id`` is a plain UUID with no foreign key behind it, so an
        organisation removed here leaves rows elsewhere pointing at nothing. A
        product whose operator cannot be named is still a product.
        """
        try:
            return await self._get(f"/organisations/{organisation_id}")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise

    async def list_organisations(self, *, role: str | None = None) -> list[dict]:
        return await self._get("/organisations", {"role": role})

    async def get_lab_config(self, organisation_id: str) -> dict:
        """A laboratory's results endpoint and whether it is in service.

        Reachable only with the service token: a lab's endpoint is its own
        business, not part of the public record.
        """
        return await self._get(f"/organisations/{organisation_id}/lab-config")

    async def list_roles(self) -> list[dict]:
        return await self._get("/admin/rbac/roles")

    async def about(self) -> dict:
        return await self._get("/about")

    async def health(self) -> bool:
        try:
            await self._get("/health")
            return True
        except (IdentityUnavailable, httpx.HTTPError):
            return False
