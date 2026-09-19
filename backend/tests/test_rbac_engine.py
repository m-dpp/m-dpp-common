from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.rbac import AttrPermissionMixin, RbacEngine, ResourcePermissionMixin, RoleMixin


class Base(DeclarativeBase):
    pass


class Role(RoleMixin, Base):
    pass


class AttrPermission(AttrPermissionMixin, Base):
    pass


class ResourcePermission(ResourcePermissionMixin, Base):
    pass


ACTIVE = SimpleNamespace(name="public", active=True)
INACTIVE = SimpleNamespace(name="public", active=False)


def _db(*, role=ACTIVE, rows=(), denied_keys=()):
    """db.execute() → one result mock serving the shapes the engine reads:
    scalar_one_or_none (role) and scalars().all() (resource rows / denied keys)."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = role
    result.scalars.return_value.all.return_value = list(rows) or list(denied_keys)
    db = AsyncMock()
    db.execute.return_value = result
    return db


def _engine(with_roles=True):
    return RbacEngine(
        attr_permission_model=AttrPermission,
        resource_permission_model=ResourcePermission,
        role_model=Role if with_roles else None,
    )


# ------------------------------------------------------------- role gate

async def test_unknown_role_is_403():
    with pytest.raises(Exception) as exc:
        await _engine().check_resource_permission({"role": "ghost"}, "read", "products", _db(role=None))
    assert exc.value.status_code == 403


async def test_inactive_role_is_403():
    with pytest.raises(Exception) as exc:
        await _engine().check_resource_permission({"role": "public"}, "read", "products", _db(role=INACTIVE))
    assert exc.value.status_code == 403


async def test_no_role_model_skips_role_check():
    db = _db(role=None)
    await _engine(with_roles=False).check_resource_permission({"role": "anything"}, "read", "products", db)


# --------------------------------------------------------- resource gate

async def test_check_resource_permission_allows_when_no_rows():
    await _engine().check_resource_permission({"role": "public"}, "read", "products", _db())


async def test_check_resource_permission_denies_when_all_rows_false():
    with pytest.raises(Exception) as exc:
        await _engine().check_resource_permission(
            {"role": "public"}, "read", "products", _db(rows=[SimpleNamespace(can_read=False)])
        )
    assert exc.value.status_code == 403


async def test_check_resource_permission_allows_when_any_row_true():
    await _engine().check_resource_permission(
        {"role": "authority"}, "read", "products",
        _db(rows=[SimpleNamespace(can_read=False), SimpleNamespace(can_read=True)]),
    )


# ------------------------------------------------------ attribute filter

async def test_filter_readable_drops_denied_keys():
    out = await _engine().filter_readable_attrs(
        {"colour": "navy", "secret": "x"}, "public", _db(denied_keys=["secret"]), entity_type="products"
    )
    assert out == {"colour": "navy"}


async def test_filter_writable_drops_denied_keys():
    out = await _engine().filter_writable_attrs(
        {"a": 1, "b": 2}, "public", _db(denied_keys=["a"]), entity_type="products"
    )
    assert out == {"b": 2}


async def test_assert_writable_is_403_naming_the_denied_keys():
    with pytest.raises(Exception) as exc:
        await _engine().assert_writable_attrs(
            {"a": 1, "b": 2, "c": None}, "public", _db(denied_keys=["a", "c"]), entity_type="products"
        )
    assert exc.value.status_code == 403
    assert "a, c" in exc.value.detail
    assert "products" in exc.value.detail


async def test_assert_writable_passes_when_nothing_denied():
    await _engine().assert_writable_attrs(
        {"a": 1}, "public", _db(denied_keys=[]), entity_type="products"
    )


async def test_assert_writable_skips_query_on_empty_patch():
    db = AsyncMock()
    await _engine().assert_writable_attrs({}, "public", db, entity_type="products")
    await _engine().assert_writable_attrs(None, "public", db, entity_type="products")
    db.execute.assert_not_called()


async def test_no_wildcard_semantics():
    """A '*' row is just a key literally named '*' — it does not deny everything."""
    out = await _engine().filter_readable_attrs(
        {"a": 1, "b": 2}, "public", _db(denied_keys=["*"]), entity_type="products"
    )
    assert out == {"a": 1, "b": 2}


async def test_filter_passthrough_when_no_attrs():
    db = AsyncMock()
    assert await _engine().filter_writable_attrs(None, "public", db, entity_type="products") is None
    assert await _engine().filter_readable_attrs({}, "public", db, entity_type="products") == {}
    db.execute.assert_not_called()


async def test_filter_query_is_scoped_to_entity_type():
    db = _db(denied_keys=[])
    await _engine().filter_readable_attrs({"x": 1}, "public", db, entity_type="products")
    stmt = db.execute.call_args.args[0]
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "attr_permissions.entity_type = 'products'" in sql
    assert "attr_permissions.role_name = 'public'" in sql
    assert "can_read = false" in sql.lower()


# -------------------------------------------------------------- binding

async def test_for_entity_binds_entity_type():
    bound = _engine().for_entity("fibre_nodes")
    db = _db(denied_keys=["hidden"])
    assert await bound.filter_readable_attrs({"hidden": 1, "shown": 2}, "public", db) == {"shown": 2}
    sql = str(db.execute.call_args.args[0].compile(compile_kwargs={"literal_binds": True}))
    assert "entity_type = 'fibre_nodes'" in sql
    # the resource gate passes straight through
    await bound.check_resource_permission({"role": "public"}, "read", "fibre_nodes", _db())


async def test_for_entity_binds_assert_writable():
    bound = _engine().for_entity("fibre_nodes")
    with pytest.raises(Exception) as exc:
        await bound.assert_writable_attrs({"locked": 1}, "public", _db(denied_keys=["locked"]))
    assert exc.value.status_code == 403
    assert "fibre_nodes" in exc.value.detail
