from typing import Any

from pydantic import BaseModel, field_validator

from m_dpp_common.gs1 import validate_gln


class OperatorCreate(BaseModel):
    gln: str
    name: str
    attrs: dict[str, Any] | None = None

    @field_validator("gln")
    @classmethod
    def gln_must_be_valid(cls, v: str) -> str:
        return validate_gln(v)


class OperatorUpdate(BaseModel):
    name: str | None = None
    attrs: dict[str, Any] | None = None
