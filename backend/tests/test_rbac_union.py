"""Union-over-roles in the RBAC engine, and the two request-scoped headers.

Principal resolution itself moved to m-dpp-identity along with the tables it
resolves against — see that repo's `tests/test_principal.py`. What is left here
is what the library still owns: how the engine combines several held roles, and
the two headers that say *who* and *on whose behalf*.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.auth import (
    ACTING_ORGANISATION_HEADER,
    DEV_IDENTITY_HEADER,
    acting_organisation,
    dev_identity,
)
from m_dpp_common.rbac import (
    AttrPermissionMixin,
    RbacEngine,
    ResourcePermissionMixin,
    RoleMixin,
)


class Base(DeclarativeBase):
    pass


class Role(RoleMixin, Base): pass
class AttrPermission(AttrPermissionMixin, Base): pass
class ResourcePermission(ResourcePermissionMixin, Base): pass


# ── the two request-scoped sources ───────────────────────────────────────

async def test_dev_identity_header_name_and_blank_handling():
    assert DEV_IDENTITY_HEADER == "X-Dev-Sub"
    assert await dev_identity(None) is None
    assert await dev_identity("   ") is None
    assert await dev_identity(" alice ") == "alice"


async def test_acting_organisation_is_a_separate_header():
    """Who you are is proved; which organisation you act for is chosen. Two
    questions, two mechanisms — conflating them is what makes an acting-as
    switcher a development trick instead of a real control."""
    assert ACTING_ORGANISATION_HEADER == "X-Acting-Org"
    assert DEV_IDENTITY_HEADER != ACTING_ORGANISATION_HEADER
    assert await acting_organisation(None) is None
    assert await acting_organisation("  ") is None
    assert await acting_organisation(" org-id ") == "org-id"


# ── engine: union over several roles ─────────────────────────────────────

def _engine():
    return RbacEngine(
        attr_permission_model=AttrPermission,
        resource_permission_model=ResourcePermission,
        role_model=Role,
    )


class SeqDb:
    def __init__(self, *payloads):
        self._q = list(payloads)
        self.execute = AsyncMock(side_effect=self._next)

    async def _next(self, stmt):
        payload = self._q.pop(0)
        r = MagicMock()
        r.scalar_one_or_none.return_value = payload
        r.scalars.return_value.all.return_value = payload if isinstance(payload, list) else []
        return r


ACTIVE_A = SimpleNamespace(name="authority", active=True)
ACTIVE_R = SimpleNamespace(name="recycler", active=True)


async def test_resource_gate_allows_if_any_role_allows():
    rows = [
        SimpleNamespace(role_name="authority", can_update=False),
        SimpleNamespace(role_name="recycler", can_update=True),
    ]
    db = SeqDb(ACTIVE_A, ACTIVE_R, rows)
    await _engine().check_resource_permission(
        {"roles": ["authority", "recycler"]}, "update", "products", db
    )


async def test_resource_gate_denies_if_every_role_denies():
    rows = [
        SimpleNamespace(role_name="authority", can_update=False),
        SimpleNamespace(role_name="recycler", can_update=False),
    ]
    db = SeqDb(ACTIVE_A, ACTIVE_R, rows)
    with pytest.raises(HTTPException) as exc:
        await _engine().check_resource_permission(
            {"roles": ["authority", "recycler"]}, "update", "products", db
        )
    assert exc.value.status_code == 403


async def test_resource_gate_skips_inactive_roles_but_needs_one():
    db = SeqDb(None, SimpleNamespace(name="recycler", active=False))
    with pytest.raises(HTTPException) as exc:
        await _engine().check_resource_permission(
            {"roles": ["ghost", "recycler"]}, "read", "products", db
        )
    assert exc.value.status_code == 403


async def test_attr_filter_is_intersection_of_denials():
    # authority may not read a,b ; recycler may not read b,c → only b is hidden
    db = SeqDb(["a", "b"], ["b", "c"])
    out = await _engine().filter_readable_attrs(
        {"a": 1, "b": 2, "c": 3}, ["authority", "recycler"], db, entity_type="products"
    )
    assert out == {"a": 1, "c": 3}


async def test_single_role_string_still_works():
    db = SeqDb(["a"])
    out = await _engine().filter_readable_attrs(
        {"a": 1, "b": 2}, "public", db, entity_type="products"
    )
    assert out == {"b": 2}
