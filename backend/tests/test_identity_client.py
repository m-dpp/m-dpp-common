"""The identity seam: the client, the principal cache, and what an outage means.

The single most important behaviour here is negative: when identity cannot
answer, the app says 503. It must NOT fall back to the anonymous role, because
that turns an outage into a silent demotion and tells the user their *role* was
the problem.
"""

import httpx
import pytest
from fastapi import HTTPException

from m_dpp_common.identity import (
    IdentityClient,
    IdentityUnavailable,
    PrincipalCache,
    make_get_principal,
    wait_for_identity,
)
from m_dpp_common.identity.client import SERVICE_TOKEN_HEADER

ALICE = {
    "sub": "alice",
    "anonymous": False,
    "organisation": {"id": "org-1", "name": "Byborre", "is_platform": False},
    "roles": ["economic_operator"],
    "role": "economic_operator",
}


def _client(handler, **kw) -> IdentityClient:
    return IdentityClient(
        "http://identity:8000",
        service_token=kw.pop("service_token", "s3cret"),
        transport=httpx.MockTransport(handler),
        **kw,
    )


# ── the client ───────────────────────────────────────────────────────────

async def test_the_service_token_is_sent_and_the_subject_is_named():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["token"] = request.headers.get(SERVICE_TOKEN_HEADER)
        seen["url"] = str(request.url)
        return httpx.Response(200, json=ALICE)

    p = await _client(handler).resolve_principal("alice", "org-1")
    assert seen["token"] == "s3cret"
    assert "sub=alice" in seen["url"] and "acting_org=org-1" in seen["url"]
    assert p["roles"] == ["economic_operator"]


async def test_an_absent_acting_org_is_omitted_not_sent_as_none():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=ALICE)

    await _client(handler).resolve_principal("alice", None)
    assert "acting_org" not in seen["url"]


async def test_an_anonymous_answer_is_a_normal_result_not_an_error():
    """Identity answered. The answer is "this resolves to nothing", with a
    reason the UI can show — very different from identity being down."""
    anon = {"sub": "ghost", "anonymous": True, "reason": "unknown subject", "roles": ["public"]}
    p = await _client(lambda r: httpx.Response(200, json=anon)).resolve_principal("ghost")
    assert p["anonymous"] is True and p["reason"] == "unknown subject"


async def test_a_transport_failure_is_identity_unavailable():
    def handler(request):
        raise httpx.ConnectError("no route to host")

    with pytest.raises(IdentityUnavailable) as e:
        await _client(handler).resolve_principal("alice")
    assert "unreachable" in str(e.value)


async def test_a_5xx_is_identity_unavailable():
    with pytest.raises(IdentityUnavailable):
        await _client(lambda r: httpx.Response(503)).resolve_principal("alice")


async def test_a_403_without_a_token_names_the_real_problem():
    """The likeliest misconfiguration, and the least obvious from its symptom:
    without the token every principal resolves anonymous and the user is told
    their role is at fault."""
    with pytest.raises(IdentityUnavailable) as e:
        await _client(lambda r: httpx.Response(403), service_token="").resolve_principal("alice")
    assert "IDENTITY_SERVICE_TOKEN" in str(e.value)


async def test_an_unknown_organisation_is_none_not_an_exception():
    """`operator_id` is a plain UUID with no foreign key behind it now, so an
    organisation removed in identity leaves rows elsewhere pointing at nothing.
    A product whose operator cannot be named is still a product."""
    got = await _client(lambda r: httpx.Response(404, json={"detail": "nope"})).get_organisation("x")
    assert got is None


async def test_health_is_a_boolean_not_a_raise():
    assert await _client(lambda r: httpx.Response(200, json={"status": "ok"})).health() is True

    def down(request):
        raise httpx.ConnectError("down")

    assert await _client(down).health() is False


# ── the cache ────────────────────────────────────────────────────────────

def test_the_cache_distinguishes_acting_organisations():
    """Same person, different authority — one must never serve the other."""
    cache = PrincipalCache(ttl=60)
    cache.put(("alice", "org-1"), {"roles": ["economic_operator"]})
    assert cache.get(("alice", "org-2")) is None
    assert cache.get(("alice", "org-1"))["roles"] == ["economic_operator"]


def test_a_zero_ttl_disables_the_cache_entirely():
    cache = PrincipalCache(ttl=0)
    cache.put(("alice", None), {"roles": ["x"]})
    assert cache.get(("alice", None)) is None


def test_the_cache_is_bounded():
    """A stream of unknown subjects must not grow it without limit."""
    cache = PrincipalCache(ttl=60, max_entries=3)
    for i in range(10):
        cache.put((f"sub-{i}", None), {"roles": ["public"]})
    assert len(cache._entries) <= 3


def test_expiry_drops_the_entry(monkeypatch):
    cache = PrincipalCache(ttl=60)
    cache.put(("alice", None), {"roles": ["x"]})
    now = [0.0]
    monkeypatch.setattr("m_dpp_common.identity.principal.time.monotonic", lambda: now[0])
    cache.put(("bob", None), {"roles": ["y"]})
    now[0] = 61.0
    assert cache.get(("bob", None)) is None


# ── the dependency ───────────────────────────────────────────────────────

async def test_get_principal_caches_within_the_ttl():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json=ALICE)

    get_principal = make_get_principal(client=_client(handler), cache=PrincipalCache(ttl=60))
    for _ in range(5):
        assert (await get_principal("alice", "org-1"))["roles"] == ["economic_operator"]
    assert calls["n"] == 1


async def test_an_outage_is_503_and_never_a_silent_demotion():
    def down(request):
        raise httpx.ConnectError("down")

    get_principal = make_get_principal(client=_client(down))
    with pytest.raises(HTTPException) as e:
        await get_principal("alice", None)
    assert e.value.status_code == 503
    assert "outage, not a permission problem" in e.value.detail


async def test_an_outage_is_not_cached():
    """Otherwise a blip would lock the app out for the length of the TTL."""
    state = {"up": False}

    def handler(request):
        if not state["up"]:
            raise httpx.ConnectError("down")
        return httpx.Response(200, json=ALICE)

    get_principal = make_get_principal(client=_client(handler), cache=PrincipalCache(ttl=60))
    with pytest.raises(HTTPException):
        await get_principal("alice", None)
    state["up"] = True
    assert (await get_principal("alice", None))["roles"] == ["economic_operator"]


async def test_waiting_for_identity_gives_up_without_stopping_the_app():
    """A backend that refuses to boot because identity is slow is a backend
    nobody can debug. Every request will report 503 with a clear reason anyway."""
    def down(request):
        raise httpx.ConnectError("down")

    assert await wait_for_identity(_client(down), attempts=2, delay=0) is False


async def test_waiting_succeeds_once_identity_answers():
    ok = await wait_for_identity(
        _client(lambda r: httpx.Response(200, json={"status": "ok"})), attempts=1, delay=0
    )
    assert ok is True
