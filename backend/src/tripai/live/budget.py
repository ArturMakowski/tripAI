"""Hard SerpApi spend limits, so a public endpoint can never drain the monthly quota.

- Daily cap (TRIPAI_SERPAPI_DAILY_CAP, default 30) shared by every process and the warm CLI: the
  counter lives in the Supabase `api_cache` table (row source="tripai:budget",
  cache_key="serpapi:<UTC day>", no schema change) and on disk; each spend re-reads it and takes
  the max, so restarts and other instances can't reset it.
- Per-request cap (TRIPAI_SERPAPI_REQUEST_CAP, default 7 = Explore + 3 flight/hotel pairs),
  enforced by the live provider's session.
Only real network calls count: the connectors' cache answers before the meter is reached.
Past a cap, callers get `BudgetExhausted` and fall back to cache misses -> recorded fixtures or
the cheap estimates. Concurrent processes may overshoot by a call or two (read-modify-write).
"""

import asyncio
import json
import logging
import time
import weakref
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from tripai.connectors import config
from tripai.connectors.base import ConnectorError

log = logging.getLogger(__name__)

DEFAULT_DAILY_CAP = 30
DEFAULT_REQUEST_CAP = 7
SOURCE = "tripai:budget"
STATUS_TTL_S = 30


class BudgetExhausted(ConnectorError):
    pass


def _cap(env: str, default: int) -> int:
    try:
        return max(0, int(config.env(env) or default))
    except ValueError:
        return default


def request_cap() -> int:
    return _cap("TRIPAI_SERPAPI_REQUEST_CAP", DEFAULT_REQUEST_CAP)


class SerpApiBudget:
    def __init__(self, daily_cap: int | None = None, root: Path | None = None) -> None:
        self._daily_cap = daily_cap
        self.root = root
        # One lock per event loop: an asyncio.Lock binds to the loop it first waits on, and
        # this object outlives loops (warm CLI runs several asyncio.run, tests, reloads).
        self._locks: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = (
            weakref.WeakKeyDictionary()
        )
        self._day = ""
        self._remote_seen: tuple[str, float, int] | None = None  # (day, monotonic, used)
        self._used = 0

    @property
    def daily_cap(self) -> int:
        if self._daily_cap is not None:
            return self._daily_cap
        return _cap("TRIPAI_SERPAPI_DAILY_CAP", DEFAULT_DAILY_CAP)

    @staticmethod
    def _today() -> str:
        return datetime.now(UTC).date().isoformat()

    def _path(self, day: str) -> Path:
        return (self.root or config.cache_dir() / "_budget") / f"serpapi-{day}.json"

    # ---------------------------------------------------------------- storage

    def _read_disk(self, day: str) -> int:
        try:
            return int(json.loads(self._path(day).read_text())["used"])
        except (OSError, ValueError, KeyError, TypeError):
            return 0

    def _write_disk(self, day: str, used: int) -> None:
        path = self._path(day)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"used": used, "day": day}))
        except OSError as exc:
            log.warning("budget disk write failed: %s", exc)

    @staticmethod
    def _supabase() -> tuple[str, dict[str, str]] | None:
        url, key = config.env("SUPABASE_URL"), config.env("SUPABASE_SECRET_KEY")
        if not (url and key):
            return None
        return url.rstrip("/") + "/rest/v1/api_cache", {
            "apikey": key,
            "Authorization": f"Bearer {key}",
        }

    async def _read_remote(self, day: str) -> int:
        sb = self._supabase()
        if sb is None:
            return 0
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                resp = await c.get(
                    sb[0],
                    headers=sb[1],
                    params={"source": f"eq.{SOURCE}", "cache_key": f"eq.serpapi:{day}",
                            "select": "payload", "limit": "1"},
                )  # fmt: skip
                resp.raise_for_status()
                rows = resp.json()
            return int(rows[0]["payload"]["used"]) if rows else 0
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
            log.warning("budget read from supabase failed: %s", exc)
            return 0

    async def _write_remote(self, day: str, used: int) -> None:
        sb = self._supabase()
        if sb is None:
            return
        now = datetime.now(UTC)
        row: dict[str, Any] = {
            "source": SOURCE,
            "cache_key": f"serpapi:{day}",
            "payload": {"used": used, "day": day},
            "fetched_at": now.isoformat(),
            "expires_at": (now + timedelta(days=3)).isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                resp = await c.post(
                    sb[0],
                    headers={**sb[1], "Content-Type": "application/json",
                             "Prefer": "resolution=merge-duplicates,return=minimal"},
                    params={"on_conflict": "source,cache_key"},
                    json=row,
                )  # fmt: skip
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning("budget write to supabase failed: %s", exc)

    # ---------------------------------------------------------------- API

    async def take(self) -> int:
        """Reserve one SerpApi call for today or raise BudgetExhausted. Returns the new count."""
        loop = asyncio.get_running_loop()
        lock = self._locks.get(loop)
        if lock is None:
            lock = self._locks[loop] = asyncio.Lock()
        async with lock:
            day = self._today()
            if day != self._day:
                self._day, self._used = day, 0
            remote = await self._read_remote(day)
            self._remote_seen = (day, time.monotonic(), remote)
            self._used = max(self._used, remote, self._read_disk(day))
            if self._used >= self.daily_cap:
                raise BudgetExhausted(
                    f"SerpApi daily cap reached ({self._used}/{self.daily_cap} for {day})"
                )
            self._used += 1
            self._write_disk(day, self._used)
            await self._write_remote(day, self._used)
            return self._used

    async def status(self) -> dict[str, Any]:
        """Today's spend as enforcement sees it: max(this process, disk, Supabase). The Supabase
        read is cached for STATUS_TTL_S so /health stays cheap; `take()` always reads fresh."""
        day = self._today()
        now = time.monotonic()
        cached = self._remote_seen
        if cached is None or cached[0] != day or now - cached[1] > STATUS_TTL_S:
            cached = self._remote_seen = (day, now, await self._read_remote(day))
        used = max(self._used if self._day == day else 0, self._read_disk(day), cached[2])
        return {"day": day, "used": used, "daily_cap": self.daily_cap,
                "request_cap": request_cap()}  # fmt: skip


_GLOBAL: SerpApiBudget | None = None


def global_budget() -> SerpApiBudget:
    """Process-wide budget (the daily counter itself is shared through Supabase/disk)."""
    global _GLOBAL
    if _GLOBAL is None:
        _GLOBAL = SerpApiBudget()
    return _GLOBAL


class WeeklyCap:
    """At most `cap` real calls per key per ISO week, e.g. Serper Places: 2 per city per week
    (TRIPAI_SERPER_PLACES_WEEKLY_CAP). Shared like the daily SerpApi counter: on disk and in the
    Supabase `api_cache` row source="tripai:budget", cache_key="<name>:<key>:<YYYY-Www>"; each
    take re-reads both and takes the max. Only real network calls should reach `take()`."""

    def __init__(self, name: str, cap: int, root: Path | None = None) -> None:
        self.name, self.cap, self.root = name, cap, root
        self._locks: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = (
            weakref.WeakKeyDictionary()
        )
        self._used: dict[str, int] = {}

    @staticmethod
    def _week() -> str:
        y, w, _ = datetime.now(UTC).isocalendar()
        return f"{y}-W{w:02d}"

    def _counter(self, key: str) -> str:
        return f"{self.name}:{key}:{self._week()}"

    def _path(self, counter: str) -> Path:
        safe = counter.replace(":", "_").replace("/", "_")
        return (self.root or config.cache_dir() / "_budget") / f"{safe}.json"

    def _read_disk(self, counter: str) -> int:
        try:
            return int(json.loads(self._path(counter).read_text())["used"])
        except (OSError, ValueError, KeyError, TypeError):
            return 0

    def _write_disk(self, counter: str, used: int) -> None:
        path = self._path(counter)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"used": used, "counter": counter}))
        except OSError as exc:
            log.warning("weekly cap disk write failed: %s", exc)

    async def _read_remote(self, counter: str) -> int:
        sb = SerpApiBudget._supabase()
        if sb is None:
            return 0
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                resp = await c.get(
                    sb[0],
                    headers=sb[1],
                    params={"source": f"eq.{SOURCE}", "cache_key": f"eq.{counter}",
                            "select": "payload", "limit": "1"},
                )  # fmt: skip
                resp.raise_for_status()
                rows = resp.json()
            return int(rows[0]["payload"]["used"]) if rows else 0
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
            log.warning("weekly cap read from supabase failed: %s", exc)
            return 0

    async def _write_remote(self, counter: str, used: int) -> None:
        sb = SerpApiBudget._supabase()
        if sb is None:
            return
        now = datetime.now(UTC)
        row = {
            "source": SOURCE,
            "cache_key": counter,
            "payload": {"used": used, "counter": counter},
            "fetched_at": now.isoformat(),
            "expires_at": (now + timedelta(days=14)).isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                resp = await c.post(
                    sb[0],
                    headers={**sb[1], "Content-Type": "application/json",
                             "Prefer": "resolution=merge-duplicates,return=minimal"},
                    params={"on_conflict": "source,cache_key"},
                    json=row,
                )  # fmt: skip
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning("weekly cap write to supabase failed: %s", exc)

    async def take(self, key: str) -> int:
        """Reserve one call for `key` this week or raise BudgetExhausted. Returns the new count."""
        loop = asyncio.get_running_loop()
        lock = self._locks.get(loop)
        if lock is None:
            lock = self._locks[loop] = asyncio.Lock()
        async with lock:
            counter = self._counter(key)
            used = max(
                self._used.get(counter, 0),
                self._read_disk(counter),
                await self._read_remote(counter),
            )
            if used >= self.cap:
                self._used[counter] = used
                raise BudgetExhausted(
                    f"{self.name} weekly cap reached for {key} ({used}/{self.cap})"
                )
            used += 1
            self._used[counter] = used
            self._write_disk(counter, used)
            await self._write_remote(counter, used)
            return used
