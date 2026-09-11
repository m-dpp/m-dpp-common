from m_dpp_common.orm import apply_attrs_patch


def test_patch_sets_named_keys_and_keeps_the_rest():
    stored = {"gln": "8718036001008", "city": "Arnhem"}
    assert apply_attrs_patch(stored, {"city": "Nijmegen"}) == {
        "gln": "8718036001008",
        "city": "Nijmegen",
    }


def test_null_removes_a_key():
    assert apply_attrs_patch({"a": 1, "b": 2}, {"a": None}) == {"b": 2}


def test_null_on_a_missing_key_is_a_no_op():
    assert apply_attrs_patch({"a": 1}, {"zzz": None}) == {"a": 1}


def test_empty_patch_changes_nothing():
    assert apply_attrs_patch({"a": 1}, {}) == {"a": 1}


def test_stored_none_is_treated_as_empty():
    assert apply_attrs_patch(None, {"a": 1}) == {"a": 1}


def test_does_not_mutate_the_stored_dict():
    stored = {"a": 1}
    apply_attrs_patch(stored, {"a": None, "b": 2})
    assert stored == {"a": 1}
