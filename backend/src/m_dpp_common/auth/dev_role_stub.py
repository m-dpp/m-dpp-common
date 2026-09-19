"""LEGACY dev auth stub: `X-Dev-Role` header → principal claiming that role.

Superseded by :mod:`m_dpp_common.auth.principal` (identity → subject →
organisation → roles), which is the real resolution path. This stub is kept
for one release so a service that still imports ``m_dpp_common.auth.get_principal``
keeps working; migrate to :func:`m_dpp_common.auth.make_get_principal`.

Roles are data (the service's `roles` table), so this stub does not validate the
role name — the RBAC engine rejects an unknown or inactive role with 403.
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
    return {"sub": "dev-stub", "role": resolved, "roles": [resolved], "anonymous": False}
