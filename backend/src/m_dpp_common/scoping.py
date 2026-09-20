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

import uuid
from typing import Iterable

from sqlalchemy import false, or_, true

#: GS1 paths at model level look like `8013/{gmn}`. Model-level data is the part
#: of a passport that is public across operators (CIRPASS-2), so tenant scoping
#: must not hide it.
MODEL_PATH_PREFIX = "8013/"


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
):
    """What a role may read regardless of ownership.

    - an oversight role (`authority`) reads across tenants: that is the point of
      market surveillance, and a regulator that could only see what it owned
      would see nothing;
    - everyone else, including `public`, reads **model-level** data across
      tenants and nothing deeper.

    Returns `None` when the role grants no cross-tenant read at all, so a caller
    can tell "no extra visibility" from "visibility that happens to match
    nothing".
    """
    role_set = set(roles)
    if role_set & set(oversight_roles):
        return true()
    return model_level(path_column)


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
