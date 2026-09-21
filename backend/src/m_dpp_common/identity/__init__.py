"""The identity seam: how an app's backend reaches m-dpp-identity.

    from m_dpp_common.identity import IdentityClient, make_get_principal

    identity_client = IdentityClient()                    # from the environment
    get_principal = make_get_principal(client=identity_client)

Organisations, subjects, memberships and roles live in m-dpp-identity. This
package is the whole of an app's runtime dependency on it — a client, a
principal-resolving dependency, and a startup wait.
"""

from m_dpp_common.identity.client import (
    IDENTITY_API_BASE_ENV,
    IDENTITY_SERVICE_TOKEN_ENV,
    SERVICE_TOKEN_HEADER,
    IdentityClient,
    IdentityUnavailable,
)
from m_dpp_common.identity.principal import (
    DEFAULT_CACHE_TTL,
    PRINCIPAL_CACHE_TTL_ENV,
    PrincipalCache,
    make_get_principal,
    wait_for_identity,
)

__all__ = [
    "IdentityClient",
    "IdentityUnavailable",
    "SERVICE_TOKEN_HEADER",
    "IDENTITY_API_BASE_ENV",
    "IDENTITY_SERVICE_TOKEN_ENV",
    "make_get_principal",
    "wait_for_identity",
    "PrincipalCache",
    "PRINCIPAL_CACHE_TTL_ENV",
    "DEFAULT_CACHE_TTL",
]
