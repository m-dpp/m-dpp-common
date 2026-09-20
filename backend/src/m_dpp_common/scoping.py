"""The three tenancy scopes, as named filters — §2.2.

They are separate functions rather than conditions assembled at each call site
because they answer three genuinely different questions, and the difference is
easy to lose in an ad-hoc ``where`` clause:

* **owned_by** — "this is mine". The only scope writes ever use.
* **visible_to_role** — "my role lets me see this, whoever owns it". Public
  model-level data, an authority's oversight read. Never grants a write.
* **produced_by** — "I made this, though I do not own it". mdpp only: a
  laboratory may read the tests it performed without owning the products.

A read is normally ``owned_by`` OR one of the others. A write is ``owned_by``,
full stop — which is why no helper here composes a write scope for you.
"""

from __future__ import annotations

import os
import uuid
from typing import Iterable

from sqlalchemy import false, or_, true

#: GS1 paths at model level look like `8013/{gmn}`.
MODEL_PATH_PREFIX = "8013/"

#: How deep a LISTING goes for a role with no ownership claim.
#:
#: Reading ONE identifier is never scoped — a passport must be readable by
#: whoever holds the product, and confidentiality is the attribute filter's job.
#: This governs only enumeration, where the two sensible answers differ:
#:
#:   "all"    every level across operators. A passport service is
#:            publish-by-design, and this is what makes the hierarchy browsable
#:            without an account. The cost is that anyone can enumerate every
#:            batch and serial of every brand — transparency and competitive
#:            intelligence are the same query here.
#:   "model"  model level only. "This passport is public" without "our whole
#:            catalogue is public".
#:
#: Default "all", because a passport that cannot be browsed is a poor
#: demonstration of one. Set PUBLIC_LISTING_DEPTH=model to tighten it; nothing
#: else changes, and no code has to move.
PUBLIC_LISTING_DEPTH_ENV = "PUBLIC_LISTING_DEPTH"


def public_listing_depth() -> str:
    value = os.getenv(PUBLIC_LISTING_DEPTH_ENV, "all").strip().lower()
    return value if value in {"all", "model"} else "all"


def owned_by(column, organisation_id: uuid.UUID | str | None):
    """Rows belonging to one organisation. `None` matches nothing — an
    unattributed caller owns nothing, rather than owning everything."""
    if organisation_id is None:
        return _false(column)
    return column == _as_uuid(organisation_id)


def owned_by_any(column, organisation_ids: Iterable[uuid.UUID | str]):
    """Rows belonging to any of several organisations — the optional
    'all my organisations' READ span. Never use this for a write."""
    ids = [_as_uuid(o) for o in organisation_ids if o is not None]
    if not ids:
        return _false(column)
    return column.in_(ids)


def produced_by(column, organisation_id: uuid.UUID | str | None):
    """Rows this organisation produced but does not own — a lab's own tests.
    Same shape as `owned_by`; named separately because it is a different claim
    and should be readable as one at the call site."""
    return owned_by(column, organisation_id)


def model_level(path_column):
    """Model-level rows, identified by the shape of the GS1 path rather than a
    stored level — the level is derived everywhere else too."""
    return path_column.like(f"{MODEL_PATH_PREFIX}%")


def visible_to_role(
    path_column,
    roles: Iterable[str],
    *,
    oversight_roles: Iterable[str] = ("authority",),
    depth: str | None = None,
):
    """What a role may LIST regardless of ownership.

    - an oversight role (`authority`) always reads across tenants: that is the
      point of market surveillance, and a regulator that could only see what it
      owned would see nothing;
    - everyone else sees as deep as `PUBLIC_LISTING_DEPTH` allows — every level
      by default, model level only when tightened.

    Never returns `None`: some cross-tenant read always exists, because a
    passport nobody can find is not a passport.
    """
    role_set = set(roles)
    if role_set & set(oversight_roles):
        return true()
    if (depth or public_listing_depth()) == "model":
        return model_level(path_column)
    return true()


def readable(path_column, owner_column, *, organisation_ids, roles, oversight_roles=("authority",)):
    """The usual read scope: what you own, OR what your role lets you see."""
    clauses = [owned_by_any(owner_column, organisation_ids)]
    role_clause = visible_to_role(path_column, roles, oversight_roles=oversight_roles)
    if role_clause is not None:
        clauses.append(role_clause)
    return or_(*clauses)


def _as_uuid(v):
    return v if isinstance(v, uuid.UUID) else uuid.UUID(str(v))


def _false(_column):
    return false()


def _true(_column):
    return true()
