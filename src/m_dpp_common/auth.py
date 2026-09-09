"""Dev auth stub — swap in Keycloak / PyJWT later behind the same `get_principal`
interface (default-deny + real OIDC/JWT for production).

In Swagger UI: click "Authorize" and enter a role name in the X-Dev-Role field.
"""

from fastapi import Security
from fastapi.security import APIKeyHeader

_role_header = APIKeyHeader(name="X-Dev-Role", auto_error=False)

VALID_ROLES = {
    "public",
    "end_user_professional",
    "recycler",    
    "supply_chain_professional",
    "authority",
    "economic_operator",
    "laboratory",    
}

# Dev posture: unknown/absent role falls back to a privileged role (default-allow).
DEFAULT_ROLE = "economic_operator"


async def get_principal(role: str | None = Security(_role_header)) -> dict:
    resolved = role if role in VALID_ROLES else DEFAULT_ROLE
    return {"sub": "dev-stub", "role": resolved}
