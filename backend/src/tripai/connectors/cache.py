"""Response cache: key = (source, params) → raw payload + fetched_at, with a TTL per source.

Backends: JSON files on disk (always) and the Supabase `api_cache` table (when SUPABASE_URL and
SUPABASE_KEY are set). A cache failure never breaks a fetch: errors are logged and treated as a miss.
"""

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

import httpx

from tripai.connectors import config

log = logging.getLogger(__name__)

# Params never stored in keys/files.
SECRET_PARAMS = frozenset({"api_key", "token", "access_token", "key"})

DEFAULT_TTL = timedelta(hours=6)
TTL_BY_SOURCE: dict[str, timedelta] = {
    "serpapi:google_travel_explore": timedelta(hours=12),
    "serpapi:google_flights": timedelta(hours=6),
    "serpapi:google_hotels": timedelta(hours=12),
    "travelpayouts:grouped_prices": timedelta(hours=6),
    "travelpayouts:prices_for_dates": timedelta(hours=6),
    "open-meteo:forecast": timedelta(hours=3),
    "open-meteo:archive": timedelta(days=30),
    "gcal:freebusy": timedelta(minutes=5),
}


def ttl_for(source: str) -> timedelta:
    return TTL_BY_SOURCE.get(source, DEFAULT_TTL)


def public_params(params: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in params.items() if k not in SECRET_PARAMS}


def cache_key(source: str, params: dict[str, Any]) -> str:
    blob = json.dumps(
        {"source": source, "params": public_params(params)}, sort_keys=True, default=str
    )
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


@dataclass(frozen=True)
class CachedPayload:
    payload: Any
    fetched_at: datetime


class Cache(Protocol):
    async def get(self, source: str, params: dict[str, Any]) -> CachedPayload | None: ...

    async def set(
        self, source: str, params: dict[str, Any], payload: Any, fetched_at: datetime
    ) -> None: ...


def _fresh(fetched_at: datetime, source: str) -> bool:
    return datetime.now(UTC) - fetched_at <= ttl_for(source)


def _safe_dirname(source: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", source)


class NullCache:
    async def get(self, source: str, params: dict[str, Any]) -> CachedPayload | None:
        return None

    async def set(
        self, source: str, params: dict[str, Any], payload: Any, fetched_at: datetime
    ) -> None:
        return None


class DiskCache:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or config.cache_dir()

    def _path(self, source: str, params: dict[str, Any]) -> Path:
        return self.root / _safe_dirname(source) / f"{cache_key(source, params)}.json"

    async def get(self, source: str, params: dict[str, Any]) -> CachedPayload | None:
        path = self._path(source, params)
        try:
            entry = json.loads(path.read_text())
            fetched_at = datetime.fromisoformat(entry["fetched_at"])
        except FileNotFoundError:
            return None
        except (OSError, ValueError, KeyError) as exc:
            log.warning("disk cache unreadable %s: %s", path, exc)
            return None
        if not _fresh(fetched_at, source):
            return None
        return CachedPayload(entry["payload"], fetched_at)

    async def set(
        self, source: str, params: dict[str, Any], payload: Any, fetched_at: datetime
    ) -> None:
        path = self._path(source, params)
        entry = {
            "source": source,
            "params": public_params(params),
            "fetched_at": fetched_at.isoformat(),
            "payload": payload,
        }
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            ignore = self.root / ".gitignore"
            if not ignore.exists():
                ignore.write_text("*\n")
            path.write_text(json.dumps(entry, ensure_ascii=False, default=str))
        except OSError as exc:
            log.warning("disk cache write failed %s: %s", path, exc)


class SupabaseCache:
    """PostgREST access to the T1-owned table
    `api_cache(source text, cache_key text, payload jsonb, fetched_at timestamptz,
    expires_at timestamptz, primary key (source, cache_key))`."""

    def __init__(self, url: str, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        self.endpoint = url.rstrip("/") + "/rest/v1/api_cache"
        self.headers = {"apikey": api_key, "Authorization": f"Bearer {api_key}"}
        self._client = client

    async def _request(self, method: str, **kwargs: Any) -> httpx.Response:
        if self._client is not None:
            return await self._client.request(method, self.endpoint, **kwargs)
        async with httpx.AsyncClient(timeout=10) as client:
            return await client.request(method, self.endpoint, **kwargs)

    async def get(self, source: str, params: dict[str, Any]) -> CachedPayload | None:
        try:
            resp = await self._request(
                "GET",
                headers=self.headers,
                params={
                    "source": f"eq.{source}",
                    "cache_key": f"eq.{cache_key(source, params)}",
                    "select": "payload,fetched_at,expires_at",
                    "limit": "1",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            if not rows:
                return None
            row = rows[0]
            fetched_at = datetime.fromisoformat(row["fetched_at"])
            expires_at = (
                datetime.fromisoformat(row["expires_at"]) if row.get("expires_at") else None
            )
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            log.warning("supabase cache get failed: %s", exc)
            return None
        fresh = expires_at > datetime.now(UTC) if expires_at else _fresh(fetched_at, source)
        return CachedPayload(row["payload"], fetched_at) if fresh else None

    async def set(
        self, source: str, params: dict[str, Any], payload: Any, fetched_at: datetime
    ) -> None:
        row = {
            "source": source,
            "cache_key": cache_key(source, params),
            "payload": payload,
            "fetched_at": fetched_at.isoformat(),
            "expires_at": (fetched_at + ttl_for(source)).isoformat(),
        }
        try:
            resp = await self._request(
                "POST",
                headers={
                    **self.headers,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=minimal",
                },
                params={"on_conflict": "source,cache_key"},
                content=json.dumps(row, default=str),
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning("supabase cache set failed: %s", exc)


class LayeredCache:
    """Read through layers in order (fast first); a hit in a lower layer back-fills upper ones."""

    def __init__(self, *layers: Cache) -> None:
        self.layers = layers

    async def get(self, source: str, params: dict[str, Any]) -> CachedPayload | None:
        for i, layer in enumerate(self.layers):
            hit = await layer.get(source, params)
            if hit is not None:
                for upper in self.layers[:i]:
                    await upper.set(source, params, hit.payload, hit.fetched_at)
                return hit
        return None

    async def set(
        self, source: str, params: dict[str, Any], payload: Any, fetched_at: datetime
    ) -> None:
        for layer in self.layers:
            await layer.set(source, params, payload, fetched_at)


def default_cache() -> Cache:
    if config.cache_disabled():
        return NullCache()
    layers: list[Cache] = [DiskCache()]
    url, key = config.env("SUPABASE_URL"), config.env("SUPABASE_KEY")
    if url and key:
        layers.append(SupabaseCache(url, key))
    return LayeredCache(*layers)
