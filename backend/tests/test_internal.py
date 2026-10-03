"""T12: the backend is private, reachable only through the frontend proxy with X-TripAI-Internal-Key."""

import logging

import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app, internal
from tripai.api.internal import HEADER

KEY = "test-internal-key-0123456789"


@pytest.fixture
def private(monkeypatch) -> TestClient:
    monkeypatch.setenv("TRIPAI_INTERNAL_KEY", KEY)
    return TestClient(create_app())


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/cities"),
        ("GET", "/windows?from=2026-11-01&to=2026-11-30"),
        ("POST", "/recommendations"),
        ("GET", "/session"),
        ("GET", "/notifications"),
        ("GET", "/docs"),
        ("GET", "/openapi.json"),
        ("POST", "/health"),
        ("OPTIONS", "/recommendations"),
    ],
)
def test_401_without_key(private, method, path):
    r = private.request(method, path)
    assert r.status_code == 401
    assert r.json() == {"detail": "unauthorized"}
    assert HEADER.lower() not in {k.lower() for k in r.headers}


def test_401_with_wrong_key(private):
    for bad in ("nope", KEY[:-1], KEY + "x", ""):
        assert private.get("/cities", headers={HEADER: bad}).status_code == 401


def test_ok_with_key(private):
    h = {HEADER: KEY}
    assert private.get("/cities", headers=h).status_code == 200
    assert private.get("/openapi.json", headers=h).status_code == 200
    assert private.get("/docs", headers=h).status_code == 200
    r = private.get("/session", headers=h)
    assert r.status_code == 200 and r.headers["X-TripAI-Session"].startswith("s_")


def test_health_open_but_minimal(private):
    r = private.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}  # no provider/store/budget/model names for the public
    full = private.get("/health", headers={HEADER: "wrong"}).json()
    assert full == {"ok": True}
    full = private.get("/health", headers={HEADER: KEY}).json()
    assert full["ok"] is True and full["phases"] == ["fast", "full"] and "provider" in full


def test_no_cors_when_private(private):
    r = private.get("/cities", headers={HEADER: KEY, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_open_without_key_and_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="tripai.api.internal"):
        c = TestClient(create_app())
    assert "TRIPAI_INTERNAL_KEY not set" in caplog.text
    assert c.get("/cities").status_code == 200
    assert "provider" in c.get("/health").json()
    r = c.get("/cities", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "*"  # local dev: browser may call directly


def test_compare_is_timing_safe(private, monkeypatch):
    """The key is checked with hmac.compare_digest (constant time), never with ==."""
    seen = []
    real = internal.hmac.compare_digest

    def spy(a, b):
        seen.append((a, b))
        return real(a, b)

    monkeypatch.setattr(internal.hmac, "compare_digest", spy)
    assert private.get("/cities", headers={HEADER: "guess"}).status_code == 401
    assert private.get("/cities", headers={HEADER: KEY}).status_code == 200
    assert seen == [(b"guess", KEY.encode()), (KEY.encode(), KEY.encode())]
    assert internal.key_matches(None, KEY) is False


@pytest.mark.parametrize(
    ("var", "value"), [("RAILWAY_ENVIRONMENT", "production"), ("TRIPAI_ENV", "production")]
)
def test_deployed_without_key_refuses_to_start(monkeypatch, var, value):
    """Fail closed: a lost/renamed TRIPAI_INTERNAL_KEY on a deployment must not reopen the API."""
    monkeypatch.setenv(var, value)
    with pytest.raises(RuntimeError, match="TRIPAI_INTERNAL_KEY"):
        create_app()
    monkeypatch.setenv("TRIPAI_INTERNAL_KEY", KEY)
    assert TestClient(create_app()).get("/cities").status_code == 401


def test_non_ascii_key_compares_raw_bytes(monkeypatch):
    key = "klucz-źdźbło"
    monkeypatch.setenv("TRIPAI_INTERNAL_KEY", key)
    c = TestClient(create_app())
    assert c.get("/cities", headers=[(HEADER.encode(), key.encode())]).status_code == 200
