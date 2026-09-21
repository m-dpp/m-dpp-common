"""The auth seam — the two headers that say *who* and *on whose behalf*.

Since m-dpp-identity, principal RESOLUTION lives in
:mod:`m_dpp_common.identity`, not here. What remains in this package is the pair
of request-scoped sources it resolves *from*:

    identity source (X-Dev-Sub)   →  who is this request?          PROVED
    acting organisation (X-Acting-Org) →  on whose behalf?         CHOSEN

Keeping them separate is what makes the acting-as switcher a real control rather
than a development trick: switching context changes authority and ownership
without touching who you are, and changing who you are must not silently carry
an organisation over.

Only ``dev_identity`` is temporary — it reads a header. Swapping to real
authentication means passing a JWT-validating dependency to
``m_dpp_common.identity.make_get_principal(identity=...)``; the acting selector
survives unchanged, because the choice is still the user's to make, it just
travels in a session or token claim instead.

    from m_dpp_common.identity import IdentityClient, make_get_principal

    get_principal = make_get_principal(client=IdentityClient())
"""

from m_dpp_common.auth.acting_organisation import (
    ACTING_ORGANISATION_HEADER,
    acting_organisation,
)
from m_dpp_common.auth.dev_identity import DEV_IDENTITY_HEADER, identity as dev_identity

__all__ = [
    "dev_identity",
    "DEV_IDENTITY_HEADER",
    "acting_organisation",
    "ACTING_ORGANISATION_HEADER",
]
