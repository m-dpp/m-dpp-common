from types import SimpleNamespace

from sqlalchemy.orm import DeclarativeBase

from m_dpp_common.operator import (
    OperatorCreate,
    OperatorMixin,
    OperatorUpdate,
    make_operator_router,
)


class Base(DeclarativeBase):
    pass


class Operator(OperatorMixin, Base):
    pass


def test_operator_mixin_binds_expected_table_and_columns():
    assert Operator.__tablename__ == "operators"
    cols = set(Operator.__table__.columns.keys())
    assert cols == {"id", "gln", "name", "attrs", "created_at", "updated_at", "removed_at"}
    assert Operator.__table__.c.gln.unique is True
    assert Operator.__table__.c.gln.nullable is False


def test_make_operator_router_mounts_expected_paths():
    router = make_operator_router(
        get_db=lambda: None,
        operator_model=Operator,
        rbac_engine=SimpleNamespace(),
        context_url="https://example.test/context/v1.jsonld",
    )
    paths = {r.path for r in router.routes}
    assert "/operators" in paths
    assert "/operators/gln/{gln}" in paths
    assert "/operators/{operator_id}" in paths

    methods = {m for r in router.routes for m in getattr(r, "methods", set())}
    assert {"GET", "POST", "PATCH", "DELETE"} <= methods


def test_make_operator_router_honours_prefix_override():
    router = make_operator_router(
        get_db=lambda: None,
        operator_model=Operator,
        rbac_engine=SimpleNamespace(),
        context_url="https://example.test/context/v1.jsonld",
        prefix="/parties",
        resource_name="parties",
    )
    paths = {r.path for r in router.routes}
    assert "/parties" in paths
    assert "/parties/{operator_id}" in paths


def test_operator_create_validates_and_derives_gln():
    # 12-digit company prefix → check digit appended to a full 13-digit GLN.
    op = OperatorCreate(gln="871803600100", name="Byborre B.V.")
    assert len(op.gln) == 13 and op.gln.startswith("871803600100")


def test_operator_update_is_all_optional():
    upd = OperatorUpdate()
    assert upd.model_fields_set == set()
