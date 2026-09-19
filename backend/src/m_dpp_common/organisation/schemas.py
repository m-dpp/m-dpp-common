"""Request schemas for the Organisation router.

`OrganisationUpdate.attrs` is a *patch*: keys named are set, a key sent as `null`
is removed, keys not named are left as stored. It must be an object — `"attrs":
null` is a 422, not "wipe everything" (see the router's PATCH handler).

There is no `gln` field: a GLN is optional and travels inside `attrs`. When one
*is* supplied we still normalise it through :func:`m_dpp_common.gs1.validate_gln`
— which accepts a 7–12 digit GS1 Company Prefix and derives the full 13-digit
GLN, or verifies the check digit of a complete one. A malformed GLN raises here
and surfaces as a 422 rather than being stored as-is.
"""

from typing import Any

from pydantic import BaseModel, Field, model_validator

from m_dpp_common.gs1 import validate_gln


def _normalise_gln(attrs: dict[str, Any] | None) -> dict[str, Any] | None:
    if not attrs or "gln" not in attrs:
        return attrs
    value = attrs["gln"]
    if value is None:
        return attrs
    if not isinstance(value, str):
        raise ValueError("attrs.gln must be a string")
    return {**attrs, "gln": validate_gln(value)}


class _GlnNormalising(BaseModel):
    # `before` (not `after`): assigning to self in an after-validator would add
    # "attrs" to model_fields_set, and the PATCH handler uses that set to decide
    # which fields to touch — an absent `attrs` would start wiping stored attrs.
    @model_validator(mode="before")
    @classmethod
    def _check_gln(cls, data):
        if isinstance(data, dict) and data.get("attrs"):
            return {**data, "attrs": _normalise_gln(data["attrs"])}
        return data


class OrganisationCreate(_GlnNormalising):
    name: str
    attrs: dict[str, Any] | None = None


class OrganisationUpdate(_GlnNormalising):
    name: str | None = None
    # Not Optional: an explicit null must fail validation rather than mean "clear".
    attrs: dict[str, Any] = Field(default_factory=dict)
