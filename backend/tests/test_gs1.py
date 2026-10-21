import pytest

from m_dpp_common.gs1 import GS1_RESOLVER, clean_gtin, derive_gln, gs1_dl_base, validate_gln, validate_gtin

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


def test_leniency_relaxes_the_length_but_never_the_digits():
    """Short demo GTINs were the pilot's common case, so lenient accepts any
    1–14 digits. Still digits, still at most 14: a GTIN of any kind is numeric,
    and a cap is a cap. Strict mode is unchanged."""
    for ok in ("1", "123", "0871803600101", "08718036001019"):
        assert validate_gtin(ok, pedantic=False) == ok
    for bad in ("", "abcdefghijklmn", "087180360010199", "12 34"):
        with pytest.raises(ValueError):
            validate_gtin(bad, pedantic=False)
    for bad in ("123", "0871803600101"):
        with pytest.raises(ValueError):
            validate_gtin(bad, pedantic=True)


def test_clean_gtin_pads_the_gs1_lengths_in_both_modes():
    """A value that is valid in both modes stores the same way in both — the
    padding is what keeps a lenient path readable after the flag is turned on."""
    assert clean_gtin(VALID_GTIN[1:], pedantic=True) == VALID_GTIN  # GTIN-13
    assert clean_gtin(VALID_GTIN[1:], pedantic=False) == VALID_GTIN
    assert clean_gtin("12345678", pedantic=False) == "00000012345678"  # GTIN-8
    assert clean_gtin("123456789012", pedantic=False) == "00123456789012"  # GTIN-12


def test_clean_gtin_lenient_keeps_other_lengths_as_typed():
    assert clean_gtin("12345", pedantic=False) == "12345"
    assert clean_gtin(" 7 ", pedantic=False) == "7"
    with pytest.raises(ValueError, match="1–14 digits"):
        clean_gtin("123456789012345", pedantic=False)


def test_clean_gtin_strict_refuses_other_lengths_and_says_how_to_relax():
    with pytest.raises(ValueError, match="GS1_PEDANTIC"):
        clean_gtin("12345", pedantic=True)
    with pytest.raises(ValueError, match="check digit"):
        clean_gtin("08718036001019", pedantic=True)


def test_a_valid_gtin_passes_either_way():
    assert validate_gtin("08718036001015") == "08718036001015"
    assert validate_gtin("08718036001015", pedantic=False) == "08718036001015"


# ── where an identifier is said to live ──────────────────────────────────

def test_a_strict_installation_emits_identifiers_under_gs1s_resolver():
    assert gs1_dl_base(None, pedantic=True, public_host="pilot.example") == GS1_RESOLVER


def test_a_lenient_installation_emits_identifiers_under_its_own_address():
    """An invented number under id.gs1.org would claim a resolution GS1 never
    made. The installation's own host is the honest namespace — and the same
    one in every service, so the federation key is one IRI everywhere."""
    assert gs1_dl_base(None, pedantic=False, public_host="pilot.example") == "http://pilot.example/id"
    assert gs1_dl_base(None, pedantic=False, public_host=None) == "http://localhost/id"
    assert gs1_dl_base("", pedantic=False, public_host=" ") == "http://localhost/id"


def test_an_explicit_base_wins_in_either_mode():
    assert gs1_dl_base("https://passports.byborre.example/", pedantic=True) == "https://passports.byborre.example"
    assert gs1_dl_base("https://passports.byborre.example", pedantic=False) == "https://passports.byborre.example"
