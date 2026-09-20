"""Which organisation the caller is acting as — deliberately NOT the identity.

Two different questions, answered by two different mechanisms, and they must not
be conflated:

* *Who is this request?* — the identity source (``dev_identity``, later a JWT).
  Not the caller's to choose: it is proved.
* *Which of my organisations am I acting for?* — **this** module. It IS the
  caller's to choose, freely and at any moment, among the memberships they hold.

Keeping them separate is what makes the "acting as" switcher a real control
rather than a development trick: switching context must change authority and
ownership without touching who you are, and changing who you are must not
silently carry an organisation over.

Choosing an organisation confers nothing by itself — ``resolve_principal``
refuses a choice the subject holds no membership for. This is a *selector*, not
a credential.

The header is the development transport. With a real IdP this becomes a session
or token claim; nothing downstream changes, because downstream only ever sees
the resolved principal.
"""

from fastapi import Security
from fastapi.security import APIKeyHeader

ACTING_ORGANISATION_HEADER = "X-Acting-Org"

_header = APIKeyHeader(
    name=ACTING_ORGANISATION_HEADER,
    auto_error=False,
    scheme_name="ActingOrganisation",
    description=(
        "The organisation id to act as. Required only when the subject belongs to "
        "several; with one membership it is implied. Never grants access to an "
        "organisation you are not a member of."
    ),
)


async def acting_organisation(org_id: str | None = Security(_header)) -> str | None:
    """The organisation the request acts as, or None to let it be implied."""
    if org_id is None:
        return None
    org_id = org_id.strip()
    return org_id or None
