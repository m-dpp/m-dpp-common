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


# ── leniency: relax the checksum, never the shape ─────────────────────────

def test_a_bad_check_digit_is_rejected_by_default():
    """The default is strict because a GTIN becomes a permanent key: the check
    digit is the only thing that catches a transposed pair of digits before it
    is written into a passport."""
    with pytest.raises(ValueError, match="check digit"):
        validate_gtin("08718036001019")


def test_the_error_says_how_to_relax_it():
    """Someone hitting this in a demo should not have to read the source."""
    with pytest.raises(ValueError, match="GS1_PEDANTIC"):
        validate_gtin("08718036001019")


def test_leniency_accepts_an_unverified_check_digit():
    assert validate_gtin("08718036001019", pedantic=False) == "08718036001019"


def test_leniency_does_not_relax_the_shape():
    """Only the checksum is optional. Length and digits are what make a stored
    path mean the same thing in both modes — relaxing those would make turning
    the flag back on a data migration."""
    for bad in ("123", "0871803600101", "abcdefghijklmn", "087180360010199"):
        with pytest.raises(ValueError):
            validate_gtin(bad, pedantic=False)


def test_a_valid_gtin_passes_either_way():
    assert validate_gtin("08718036001015") == "08718036001015"
    assert validate_gtin("08718036001015", pedantic=False) == "08718036001015"
