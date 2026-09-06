from types import SimpleNamespace

import pytest

from m_dpp_common.rbac.admin import (
    _discovery_sql,
    _expand_with_inheritance,
    make_rbac_router,
)


def _model(table):
    return SimpleNamespace(__tablename__=table)


def test_discovery_sql_unions_all_tables_in_order():
    sql = str(
        _discovery_sql(
            {"dpp_models": _model("dpp_models"), "dpp_items": _model("dpp_items")}
        )
    )
    assert sql.count("jsonb_object_keys(attrs)") == 2
    assert "FROM dpp_models WHERE attrs IS NOT NULL" in sql
    assert "FROM dpp_items WHERE attrs IS NOT NULL" in sql
    assert "UNION" in sql
    assert sql.strip().endswith("ORDER BY resource_type, attr_key")


def test_discovery_sql_rejects_unsafe_identifiers():
    with pytest.raises(ValueError):
        _discovery_sql({"bad name": _model("dpp_models")})
    with pytest.raises(ValueError):
        _discovery_sql({"ok": _model("dpp_models; drop table x")})


_TREE = ["dpp_models", "dpp_variants", "dpp_batches", "dpp_items"]


def test_expand_fans_a_parent_key_to_every_descendant():
    got = _expand_with_inheritance([("dpp_models", "certification")], _TREE)
    assert got == {
        ("dpp_models", "certification"),
        ("dpp_variants", "certification"),
        ("dpp_batches", "certification"),
        ("dpp_items", "certification"),
    }


def test_expand_from_mid_chain_only_goes_downward():
    got = _expand_with_inheritance([("dpp_batches", "lot_note")], _TREE)
    assert got == {("dpp_batches", "lot_note"), ("dpp_items", "lot_note")}


def test_expand_without_order_is_identity():
    assert _expand_with_inheritance([("dpp_models", "x")], None) == {("dpp_models", "x")}


def test_expand_leaves_resource_types_outside_the_chain_alone():
    assert _expand_with_inheritance([("operators", "country")], _TREE) == {
        ("operators", "country")
    }


def test_make_rbac_router_mounts_expected_paths():
    Role = _model("roles")
    router = make_rbac_router(
        get_db=lambda: None,
        role_model=Role,
        attr_permission_model=_model("attr_permissions"),
        operator_role_model=_model("operator_roles"),
        resource_permission_model=_model("resource_permissions"),
        resource_tables={"roles": Role},
    )
    paths = {r.path for r in router.routes}
    assert "/admin/rbac/sync-attrs" in paths
    assert "/admin/rbac/resource-permissions/{permission_id}" in paths
