import json
from datetime import UTC, datetime, timedelta

import httpx
import respx

from tripai.connectors.cache import (
    DiskCache,
    LayeredCache,
    SupabaseCache,
    cache_key,
    default_cache,
)


def test_cache_key_ignores_secrets_and_order():
    a = cache_key("s", {"a": 1, "b": 2, "api_key": "x"})
    b = cache_key("s", {"b": 2, "a": 1, "api_key": "y"})
    assert a == b
    assert a != cache_key("other", {"a": 1, "b": 2})


async def test_disk_roundtrip_and_ttl(disk_cache):
    now = datetime.now(UTC)
    await disk_cache.set("gcal:freebusy", {"q": 1, "api_key": "secret"}, {"ok": True}, now)
    hit = await disk_cache.get("gcal:freebusy", {"q": 1})
    assert hit is not None and hit.payload == {"ok": True}
    stored = next(disk_cache.root.rglob("*.json")).read_text()
    assert "secret" not in stored

    await disk_cache.set("gcal:freebusy", {"q": 2}, {"ok": True}, now - timedelta(hours=1))
    assert await disk_cache.get("gcal:freebusy", {"q": 2}) is None  # 5 min TTL


async def test_layered_backfills_upper(tmp_path):
    upper, lower = DiskCache(tmp_path / "u"), DiskCache(tmp_path / "l")
    await lower.set("src", {"k": 1}, [1, 2], datetime.now(UTC))
    hit = await LayeredCache(upper, lower).get("src", {"k": 1})
    assert hit.payload == [1, 2]
    assert (await upper.get("src", {"k": 1})).payload == [1, 2]


@respx.mock
async def test_supabase_cache_roundtrip():
    url = "https://proj.supabase.co/rest/v1/api_cache"
    now = datetime.now(UTC)
    respx.get(url).mock(
        return_value=httpx.Response(
            200, json=[{"payload": {"x": 1}, "fetched_at": now.isoformat()}]
        )
    )
    post = respx.post(url).mock(return_value=httpx.Response(201))
    cache = SupabaseCache("https://proj.supabase.co", "anon")
    hit = await cache.get("src", {"k": 1})
    assert hit.payload == {"x": 1}
    await cache.set("src", {"k": 1}, {"x": 1}, now)
    req = post.calls.last.request
    assert req.headers["Prefer"].startswith("resolution=merge-duplicates")
    assert req.url.params["on_conflict"] == "source,cache_key"
    row = json.loads(req.content)
    assert set(row) == {"source", "cache_key", "payload", "fetched_at", "expires_at"}


@respx.mock
async def test_supabase_errors_are_misses():
    respx.get("https://proj.supabase.co/rest/v1/api_cache").mock(return_value=httpx.Response(500))
    assert await SupabaseCache("https://proj.supabase.co", "anon").get("src", {}) is None


def test_default_cache_adds_supabase_when_configured(monkeypatch):
    assert len(default_cache().layers) == 1
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "publishable")
    assert len(default_cache().layers) == 1  # publishable key alone is not enough (RLS)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "secret")
    assert isinstance(default_cache().layers[1], SupabaseCache)
