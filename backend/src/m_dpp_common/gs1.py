import os
import re

GLN_PEDANTIC = os.getenv("GLN_PEDANTIC", "false").lower() == "true"


def _check_digit(digits: list[int]) -> int:
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digits)))
    return (10 - total % 10) % 10


def validate_gtin(v: str) -> str:
    if not re.fullmatch(r"\d{14}", v):
        raise ValueError("GTIN must be exactly 14 digits")
    digits = [int(c) for c in v]
    if _check_digit(digits[:-1]) != digits[-1]:
        raise ValueError("GTIN check digit is invalid")
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
