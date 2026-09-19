import pytest

from m_dpp_common.gs1 import derive_gln, validate_gln, validate_gtin

# 0871803600100 + computed check digit 8
VALID_GTIN = "08718036001008"


def test_valid_gtin_round_trips():
    assert validate_gtin(VALID_GTIN) == VALID_GTIN


def test_bad_gtin_length():
    with pytest.raises(ValueError):
        validate_gtin("123")


def test_bad_gtin_check_digit():
    with pytest.raises(ValueError):
        validate_gtin("08718036001007")


def test_derive_gln_appends_check_digit():
    gln = derive_gln("871803600100")
    assert len(gln) == 13
    assert validate_gln(gln) == gln


def test_validate_gln_derives_from_prefix_when_not_pedantic():
    # non-pedantic mode: a 12-digit prefix is padded + check-digited
    assert len(validate_gln("871803600100")) == 13
