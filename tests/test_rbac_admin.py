from types import SimpleNamespace

import pytest

from m_dpp_common.rbac.admin import _attr_keys_sql, make_rbac_router


def _model(table):
    return SimpleNamespace(__tablename__=table)


def test_attr_keys_sql_unions_all_tables_without_resource_labels():
    sql = str(
        _attr_keys_sql(
            {"dpp_models": _model("dpp_models"), "dpp_items": _model("dpp_items")}
        )
    )
    assert sql.count("jsonb_object_keys(attrs)") == 2
    # Guard on jsonb_typeof so rows whose `attrs` is a JSON scalar/null (not an
    # object) are skipped — `jsonb_object_keys` errors on those.
    assert "FROM dpp_models WHERE jsonb_typeof(attrs) = 'object'" in sql
    assert "FROM dpp_items WHERE jsonb_typeof(attrs) = 'object'" in sql
    assert "resource_type" not in sql
    assert sql.strip().endswith("ORDER BY attr_key")


def test_attr_keys_sql_rejects_unsafe_table_name():
    with pytest.raises(ValueError):
        _attr_keys_sql({"ok": _model("dpp_models; drop table x")})


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
    assert "/admin/rbac/permissions" in paths
    assert "/admin/rbac/resource-permissions/{permission_id}" in paths
