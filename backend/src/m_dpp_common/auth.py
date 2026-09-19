"""Dev auth stub — swap in Keycloak / PyJWT later behind the same `get_principal`
interface (default-deny + real OIDC/JWT for production).

Roles are data (the service's `roles` table), so this stub does not validate the
role name — it only resolves *which* role the request claims. The RBAC engine
rejects an unknown or inactive role with 403 at the resource gate.

In Swagger UI: click "Authorize" and enter a role name in the X-Dev-Role field.
"""

import os

from fastapi import Security
from fastapi.security import APIKeyHeader

_role_header = APIKeyHeader(name="X-Dev-Role", auto_error=False)

# Dev posture: an absent header falls back to a privileged role. This is the one
# deliberate role-name special case in the library; override per deployment.
DEFAULT_ROLE = os.getenv("RBAC_DEFAULT_ROLE", "economic_operator")


async def get_principal(role: str | None = Security(_role_header)) -> dict:
    resolved = role.strip() if role and role.strip() else DEFAULT_ROLE
    return {"sub": "dev-stub", "role": resolved}
