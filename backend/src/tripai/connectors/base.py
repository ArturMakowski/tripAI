"""Shared fetch pipeline: fixtures → cache → live HTTP (with retries) → cache/fixture write."""

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel

from tripai.connectors import config
from tripai.connectors.cache import Cache, default_cache, public_params
from tripai.models import Evidence

log = logging.getLogger(__name__)

RETRY_STATUS = {429, 500, 502, 503, 504}


class ConnectorError(RuntimeError):
    """Any failure to obtain data from a source (callers may fall back / skip the candidate)."""


class MissingCredentials(ConnectorError):
    pass


class FixtureNotFound(ConnectorError):
    pass


class SourcedResult(BaseModel):
    """Every connector result says where its numbers came from and when."""

    source: str
    fetched_at: datetime

    def evidence(self) -> list[Evidence]:
        return []

    def _ev(
        self, kind: str, label: str, value: float | str, unit: str | None, url: str | None = None
    ) -> Evidence:
        return Evidence(
            kind=kind,
            label=label,
            value=value,
            unit=unit,
            source=self.source,
            fetched_at=self.fetched_at,
            url=url,
        )


def fixture_path(source: str, name: str) -> Path:
    folder = source.replace(":", "/")
    return config.fixtures_dir() / folder / f"{name}.json"


def load_fixture(source: str, name: str) -> tuple[Any, datetime]:
    path = fixture_path(source, name)
    if not path.exists():
        available = (
            sorted(p.stem for p in path.parent.glob("*.json")) if path.parent.exists() else []
        )
        raise FixtureNotFound(f"no fixture {path} (have: {', '.join(available) or 'none'})")
    entry = json.loads(path.read_text())
    return entry["payload"], datetime.fromisoformat(entry["fetched_at"])


def write_fixture(
    source: str, name: str, params: dict[str, Any], payload: Any, fetched_at: datetime
) -> Path:
    path = fixture_path(source, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "source": source,
        "params": public_params(params),
        "fetched_at": fetched_at.isoformat(),
        "recorded": True,
        "payload": payload,
    }
    path.write_text(json.dumps(entry, ensure_ascii=False, indent=1, default=str) + "\n")
    return path


class Connector:
    """Base for all clients. Pass a shared `httpx.AsyncClient` to reuse connections."""

    timeout = 30.0
    max_attempts = 3

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        cache: Cache | None = None,
        fixtures: bool | None = None,
    ) -> None:
        self._client = client
        self._cache = cache
        self._fixtures = fixtures

    @property
    def fixtures(self) -> bool:
        return config.use_fixtures() if self._fixtures is None else self._fixtures

    @property
    def cache(self) -> Cache:
        if self._cache is None:
            self._cache = default_cache()
        return self._cache

    async def _fetch(
        self,
        source: str,
        url: str,
        params: dict[str, Any],
        *,
        fixture: str,
        method: str = "GET",
        json_body: Any = None,
        headers: dict[str, str] | None = None,
        validate: Callable[[Any], None] | None = None,
    ) -> tuple[Any, datetime]:
        """Return `(payload, fetched_at)`. `params` are both query params and the cache key;
        `json_body` (POST) is folded into the key too. `validate` raises ConnectorError for
        error payloads served with HTTP 200, so they are never cached."""
        if self.fixtures:
            return load_fixture(source, fixture)

        key_params = {**params, "_body": json_body} if json_body is not None else params
        hit = await self.cache.get(source, key_params)
        if hit is not None:
            return hit.payload, hit.fetched_at

        payload = await self._http(method, url, params, json_body, headers)
        if validate is not None:
            validate(payload)
        fetched_at = datetime.now(UTC)
        await self.cache.set(source, key_params, payload, fetched_at)
        if config.record_fixtures():
            path = write_fixture(source, fixture, key_params, payload, fetched_at)
            log.info("recorded fixture %s", path)
        return payload, fetched_at

    async def _http(
        self,
        method: str,
        url: str,
        params: dict[str, Any],
        json_body: Any,
        headers: dict[str, str] | None,
    ) -> Any:
        query = {k: v for k, v in params.items() if v is not None}
        last_exc: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                resp = await self._send(method, url, query, json_body, headers)
                if resp.status_code in RETRY_STATUS and attempt + 1 < self.max_attempts:
                    last_exc = ConnectorError(f"{url} → HTTP {resp.status_code}")
                    await asyncio.sleep(0.5 * 2**attempt)
                    continue
                if resp.is_error:
                    raise ConnectorError(f"{url} → HTTP {resp.status_code}: {resp.text[:300]}")
                return resp.json()
            except httpx.TransportError as exc:
                last_exc = exc
                if attempt + 1 < self.max_attempts:
                    await asyncio.sleep(0.5 * 2**attempt)
            except ValueError as exc:
                raise ConnectorError(f"{url} returned non-JSON: {exc}") from exc
        raise ConnectorError(f"{url} failed after {self.max_attempts} attempts: {last_exc}")

    async def _send(
        self,
        method: str,
        url: str,
        query: dict[str, Any],
        json_body: Any,
        headers: dict[str, str] | None,
    ) -> httpx.Response:
        if self._client is not None:
            return await self._client.request(
                method, url, params=query, json=json_body, headers=headers, timeout=self.timeout
            )
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            return await client.request(method, url, params=query, json=json_body, headers=headers)
