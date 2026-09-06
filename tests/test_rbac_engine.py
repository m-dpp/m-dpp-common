from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.rbac import (
    AttrPermissionMixin,
    RbacEngine,
    ResourcePermissionMixin,
)


class Base(DeclarativeBase):
    pass


class AttrPermission(AttrPermissionMixin, Base):
    pass


class ResourcePermission(ResourcePermissionMixin, Base):
    pass


def _db_returning(rows):
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    db = AsyncMock()
    db.execute.return_value = result
    return db


def _engine():
    return RbacEngine(
        attr_permission_model=AttrPermission,
        resource_permission_model=ResourcePermission,
    )


async def test_check_resource_permission_allows_when_no_rows():
    await _engine().check_resource_permission(
        {"role": "public"}, "read", "dpp_models", _db_returning([])
    )


async def test_check_resource_permission_denies_when_all_rows_false():
    db = _db_returning([SimpleNamespace(can_read=False)])
    with pytest.raises(Exception) as exc:
        await _engine().check_resource_permission({"role": "public"}, "read", "dpp_models", db)
    assert getattr(exc.value, "status_code", None) == 403


async def test_check_resource_permission_allows_when_any_row_true():
    db = _db_returning([SimpleNamespace(can_read=False), SimpleNamespace(can_read=True)])
    await _engine().check_resource_permission({"role": "authority"}, "read", "dpp_models", db)


async def test_filter_readable_drops_denied_keys():
    db = _db_returning([SimpleNamespace(attr_key="secret")])
    out = await _engine().filter_readable_attrs(
        {"colour": "navy", "secret": "x"}, "public", db
    )
    assert out == {"colour": "navy"}


async def test_filter_readable_wildcard_denies_everything():
    db = _db_returning([SimpleNamespace(attr_key="*")])
    out = await _engine().filter_readable_attrs({"a": 1, "b": 2}, "public", db)
    assert out == {}


async def test_filter_passthrough_when_no_attrs():
    db = AsyncMock()
    assert await _engine().filter_writable_attrs(None, "public", db) is None
    db.execute.assert_not_called()
