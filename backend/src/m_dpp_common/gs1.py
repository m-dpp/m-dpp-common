import os
import re

GLN_PEDANTIC = os.getenv("GLN_PEDANTIC", "false").lower() == "true"

#: Enforce the GTIN check digit.
#:
#: Default **true**: a GTIN identifies a product, and a passport built on a
#: mistyped identifier is worse than no passport — the check digit is the only
#: thing that catches a transposed pair of digits before it becomes a permanent
#: key. This is the opposite default to `GLN_PEDANTIC`, deliberately: a GLN
#: names a company, and getting it slightly wrong is recoverable.
#:
#: Set `GS1_PEDANTIC=false` for demos and fixtures, where inventing valid check
#: digits — or 14 digits at all — by hand is friction with no benefit. Leniency
#: relaxes the checksum AND the length: any 1–14 digits are accepted. The GS1
#: lengths (8, 12, 13) are still zero-padded to 14, as they are when strict, so
#: an identifier that is valid in both modes means the same path in both; any
#: other length is stored as typed. Digits remain the rule in both modes.
#:
#: What this costs: a lenient installation can hold paths a strict one would
#: refuse, so turning the flag on later refuses to READ them too — the choice
#: was made for the pilot, where short demo GTINs are the common case.
GS1_PEDANTIC = os.getenv("GS1_PEDANTIC", "true").lower() != "false"

#: GS1 lengths that are padded to GTIN-14 — in both modes.
_GS1_GTIN_LENGTHS = (8, 12, 13)

#: GS1's own resolver — the base a REAL GS1 Digital Link lives under.
GS1_RESOLVER = "https://id.gs1.org"


def gs1_dl_base(explicit: str | None, *, pedantic: bool | None = None, public_host: str | None = None) -> str:
    """The base under which a product's `@id` is emitted: `{base}/{gs1_path}`.

    A strict installation holds real GS1 identifiers, so its identifiers are
    valid GS1 Digital Links and live under GS1's resolver. A lenient one may
    hold invented numbers, and emitting those under `id.gs1.org` would claim a
    resolution GS1 never made — so by default it emits them under its OWN
    address instead: `http://{PUBLIC_HOST}/id`, the same namespace in every
    service of the installation, so the federation key is one IRI everywhere.
    An explicit base always wins, in either mode (empty counts as unset).
    """
    if explicit and explicit.strip():
        return explicit.strip().rstrip("/")
    if _strict(pedantic):
        return GS1_RESOLVER
    host = (public_host or "").strip() or "localhost"
    return f"http://{host}/id"


def _strict(pedantic: bool | None) -> bool:
    return pedantic if pedantic is not None else GS1_PEDANTIC


def _check_digit(digits: list[int]) -> int:
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digits)))
    return (10 - total % 10) % 10


def validate_gtin(v: str, *, pedantic: bool | None = None) -> str:
    """A 14-digit GTIN, check digit verified — or, when lenient, any 1–14 digits.

    `pedantic` overrides the environment for one call — used by tests, and by any
    caller that must be strict regardless of how the deployment is configured.
    """
    if not _strict(pedantic):
        if not re.fullmatch(r"\d{1,14}", v):
            raise ValueError("GTIN must be 1–14 digits")
        return v
    if not re.fullmatch(r"\d{14}", v):
        raise ValueError("GTIN must be exactly 14 digits")
    digits = [int(c) for c in v]
    if _check_digit(digits[:-1]) != digits[-1]:
        raise ValueError(
            "GTIN check digit is invalid "
            "(set GS1_PEDANTIC=false to accept unverified identifiers in development)"
        )
    return v


def clean_gtin(raw: str, *, pedantic: bool | None = None) -> str:
    """A GTIN as typed into a path → its stored form.

    Strict: 8, 12, 13 or 14 digits, zero-padded to 14, check digit verified.
    Lenient: any 1–14 digits; the GS1 lengths are still padded to 14 (so a value
    valid in both modes stores the same way in both), anything else as typed, no
    checksum. Raises `ValueError` with a message that names the rule.
    """
    v = raw.strip()
    if _strict(pedantic):
        if not re.fullmatch(r"\d{8}|\d{12,14}", v):
            raise ValueError(
                f"'{raw}' is not a GTIN (8, 12, 13 or 14 digits) "
                "(set GS1_PEDANTIC=false to accept any 1–14 digits in development)"
            )
    elif not re.fullmatch(r"\d{1,14}", v):
        raise ValueError(f"'{raw}' is not a GTIN (1–14 digits when GS1_PEDANTIC=false)")
    if len(v) in _GS1_GTIN_LENGTHS:
        v = v.zfill(14)
    return validate_gtin(v, pedantic=pedantic)


def derive_gln(prefix: str) -> str:
    padded = prefix.ljust(12, "0")
    digits = [int(c) for c in padded]
    return padded + str(_check_digit(digits))


def validate_gln(v: str) -> str:
    if GLN_PEDANTIC:
        if not re.fullmatch(r"\d{13}", v):
            raise ValueError("GLN must be exactly 13 digits")
        digits = [int(c) for c in v]
        if _check_digit(digits[:-1]) != digits[-1]:
            raise ValueError("GLN check digit is invalid")
        return v
    if not re.fullmatch(r"\d{7,13}", v):
        raise ValueError("Provide a 7–12 digit GS1 Company Prefix or a full 13-digit GLN")
    if len(v) < 13:
        return derive_gln(v)
    digits = [int(c) for c in v]
    if _check_digit(digits[:-1]) != digits[-1]:
        raise ValueError("GLN check digit is invalid")
    return v
