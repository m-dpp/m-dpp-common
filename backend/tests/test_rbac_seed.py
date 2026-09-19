from m_dpp_common.rbac.seed import JRC_ROLES, NEW_ROLE_ATTR_DEFAULTS, NEW_ROLE_RESOURCE_DEFAULTS, _unpack_role


def test_seed_roles_carry_labels():
    for entry in JRC_ROLES:
        name, label, description = _unpack_role(entry)
        assert name and label and description


def test_legacy_two_tuple_roles_still_accepted():
    assert _unpack_role(("auditor", "Audits things")) == ("auditor", None, "Audits things")


def test_new_role_defaults_are_read_only():
    assert NEW_ROLE_RESOURCE_DEFAULTS["can_list"] and NEW_ROLE_RESOURCE_DEFAULTS["can_read"]
    assert not any(NEW_ROLE_RESOURCE_DEFAULTS[k] for k in ("can_create", "can_update", "can_delete"))
    assert NEW_ROLE_ATTR_DEFAULTS == {"can_read": True, "can_write": False}
