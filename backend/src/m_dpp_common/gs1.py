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
#: digits by hand is friction with no benefit. Leniency relaxes ONLY the
#: checksum: the value must still be 8, 12, 13 or 14 digits and is still padded
#: to 14, so the shape of every stored identifier is unchanged and turning the
#: flag back on cannot alter what a path means.
GS1_PEDANTIC = os.getenv("GS1_PEDANTIC", "true").lower() != "false"


def _check_digit(digits: list[int]) -> int:
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digits)))
    return (10 - total % 10) % 10


def validate_gtin(v: str, *, pedantic: bool | None = None) -> str:
    """A 14-digit GTIN, check digit verified unless leniency is configured.

    `pedantic` overrides the environment for one call — used by tests, and by any
    caller that must be strict regardless of how the deployment is configured.
    """
    if not re.fullmatch(r"\d{14}", v):
        raise ValueError("GTIN must be exactly 14 digits")
    if pedantic is False or (pedantic is None and not GS1_PEDANTIC):
        return v
    digits = [int(c) for c in v]
    if _check_digit(digits[:-1]) != digits[-1]:
        raise ValueError(
            "GTIN check digit is invalid "
            "(set GS1_PEDANTIC=false to accept unverified identifiers in development)"
        )
    return v


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
