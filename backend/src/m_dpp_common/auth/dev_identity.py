"""THE development identity source — the only temporary piece of the auth seam.

It answers one question: *which ``sub`` is this request?* Here the answer is
read from the ``X-Dev-Sub`` header (Swagger UI: "Authorize" → X-Dev-Sub). No
header → ``None`` → the principal resolves to the anonymous role.

Swapping to real authentication means replacing this module's ``identity``
dependency with one that validates a JWT and returns its ``sub`` claim. Nothing
downstream (subject lookup, membership, roles, RBAC) changes.
"""

from fastapi import Security
from fastapi.security import APIKeyHeader

DEV_IDENTITY_HEADER = "X-Dev-Sub"

_header = APIKeyHeader(
    name=DEV_IDENTITY_HEADER,
    auto_error=False,
    scheme_name="DevIdentity",
    description="Development only: the `sub` to act as. Leave empty to be anonymous.",
)


async def identity(sub: str | None = Security(_header)) -> str | None:
    """The request's identity (`sub`) or None when the request is anonymous."""
    if sub is None:
        return None
    sub = sub.strip()
    return sub or None
