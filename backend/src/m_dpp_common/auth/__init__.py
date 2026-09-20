"""The auth seam.

Real path (use this):
  identity source  →  subject  →  membership  →  organisation  →  roles  →  principal
  (dev_identity)      (SubjectMixin) (MembershipMixin)            (RBAC tables)

    from m_dpp_common.auth import make_get_principal, make_subjects_router
    get_principal = make_get_principal(get_db=..., subject_model=..., membership_model=...,
                                       organisation_model=..., organisation_role_model=..., role_model=...)

Only ``m_dpp_common.auth.dev_identity`` is temporary (it reads ``X-Dev-Sub``);
swap it for a JWT-validating dependency via ``make_get_principal(identity=...)``.

``get_principal`` (module level) is the LEGACY ``X-Dev-Role`` stub, kept for one
release for services that have not migrated yet.
"""

from m_dpp_common.auth.acting_organisation import (
    ACTING_ORGANISATION_HEADER,
    acting_organisation,
)
from m_dpp_common.auth.dev_identity import DEV_IDENTITY_HEADER, identity as dev_identity
from m_dpp_common.auth.dev_role_stub import get_principal  # legacy, deprecated
from m_dpp_common.auth.models import MembershipMixin, SubjectMixin
from m_dpp_common.auth.principal import (
    ANONYMOUS_ROLE_ENV,
    anonymous_role,
    make_get_principal,
    organisation_role_names,
    resolve_principal,
)
from m_dpp_common.auth.router import make_subjects_router

__all__ = [
    "SubjectMixin",
    "MembershipMixin",
    "make_get_principal",
    "resolve_principal",
    "organisation_role_names",
    "anonymous_role",
    "ANONYMOUS_ROLE_ENV",
    "dev_identity",
    "DEV_IDENTITY_HEADER",
    "acting_organisation",
    "ACTING_ORGANISATION_HEADER",
    "make_subjects_router",
    "get_principal",
]
