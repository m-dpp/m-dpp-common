from types import SimpleNamespace

import pytest

from m_dpp_common.rbac.admin import _discovery_sql, make_rbac_router


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
