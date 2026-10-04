"""Persistent cache + time limit for LLM outputs (AI fit verdicts, 'why' texts).

Key = sha256 of everything the model sees (the exact evidence/fit payload in the user's language,
the model/engine names and a format version), so a repeat load or switching back to a language
reuses the answer, and any change in the inputs (a new price, another profile) is a miss: a
cached text can never describe different numbers. Stored in the connectors' layered cache
(disk + Supabase `api_cache`, sources `tripai:fit` / `tripai:why`, default TTL).
Only real LLM answers are stored; rules/template fallbacks are free and never cached.

`llm_timeout_s()`: the time one LLM-backed item (a fit verdict, an explanation) may take before
it falls back to the deterministic rules/template (TRIPAI_LLM_TIMEOUT_S, default 4 s).
"""

import asyncio
import hashlib
import json
import logging
import os
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from tripai.connectors import cache as connector_cache
from tripai.connectors import config

log = logging.getLogger(__name__)

FIT = "tripai:fit"
WHY = "tripai:why"
FORMAT_VERSION = "1"  # bump when the cached payload shape or the prompts change
DEFAULT_TIMEOUT_S = 4.0

_backend: connector_cache.Cache | None = None


def llm_timeout_s() -> float:
    try:
        return max(0.1, float(os.getenv("TRIPAI_LLM_TIMEOUT_S") or DEFAULT_TIMEOUT_S))
    except ValueError:
        return DEFAULT_TIMEOUT_S


def enabled() -> bool:
    return os.getenv("TRIPAI_LLM_CACHE", "1") != "0" and not config.cache_disabled()


def digest(*parts: Any) -> str:
    raw = json.dumps([FORMAT_VERSION, *parts], sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _cache() -> connector_cache.Cache:
    global _backend
    if _backend is None:
        _backend = connector_cache.default_cache()
    return _backend


async def get(source: str, key: str) -> Any | None:
    if not enabled():
        return None
    try:
        hit = await _cache().get(source, {"k": key})
    except Exception as exc:  # noqa: BLE001 - a cache problem is a miss, never a failure
        log.warning("llm cache get %s failed: %s", source, exc)
        return None
    return None if hit is None else hit.payload


async def put(source: str, key: str, payload: Any) -> None:
    if not enabled():
        return
    try:
        await _cache().set(source, {"k": key}, payload, datetime.now(UTC))
    except Exception as exc:  # noqa: BLE001
        log.warning("llm cache set %s failed: %s", source, exc)


def reset() -> None:
    """Forget the backend (tests switch cache settings)."""
    global _backend
    _backend = None


# ---------------------------------------------------------------- finish in the background

DEFAULT_BACKGROUND_S = 20.0
DEFAULT_MAX_BACKGROUND = 16
# key -> the one running LLM call for it: a reload within the background window joins it
# instead of starting a duplicate; holding the task here also keeps it alive if the request
# that started it goes away (client disconnect) and lets `drain()` see it
_inflight: dict[str, asyncio.Task] = {}
_prefetched: set[str] = set()  # keys whose running task was started ahead by a fast phase


def background_limit_s() -> float:
    """How long a timed-out LLM call may keep running to fill the cache for the next load."""
    try:
        return max(0.0, float(os.getenv("TRIPAI_LLM_BACKGROUND_S") or DEFAULT_BACKGROUND_S))
    except ValueError:
        return DEFAULT_BACKGROUND_S


def max_background() -> int:
    try:
        return max(0, int(os.getenv("TRIPAI_LLM_MAX_BACKGROUND") or DEFAULT_MAX_BACKGROUND))
    except ValueError:
        return DEFAULT_MAX_BACKGROUND


DEFAULT_FULL_TARGET_S = 4.5
# loop-time by which this request's LLM-backed items must be answered (None: no request budget)
_request_end: ContextVar[float | None] = ContextVar("tripai_llm_request_end", default=None)


def full_target_s() -> float:
    """Wall time a full-phase request should take in total (TRIPAI_FULL_TARGET_S, 4.5 s)."""
    try:
        return max(0.0, float(os.getenv("TRIPAI_FULL_TARGET_S") or DEFAULT_FULL_TARGET_S))
    except ValueError:
        return DEFAULT_FULL_TARGET_S


def start_request_budget(started_at: float, total_s: float | None = None) -> None:
    """Make every LLM-backed item of this request finish by `started_at + total_s` (loop time).
    Items gathered after this call inherit it (contextvars are copied into tasks)."""
    _request_end.set(started_at + (full_target_s() if total_s is None else total_s))


def wait_s() -> float:
    """How long an item may wait now: the per-item deadline, cut to what is left of the
    request budget (time already spent elsewhere, e.g. fetching prices, counts)."""
    t = llm_timeout_s()
    end = _request_end.get()
    if end is not None:
        t = min(t, max(0.0, end - asyncio.get_running_loop().time()))
    return t


async def within(key: str, factory, fallback):
    """The LLM answer for `key` within `wait_s()`, else `fallback()` now.

    `factory()` makes the coroutine (it caches its own result). It runs as a task that may keep
    going for up to `background_limit_s()` to fill the cache for the next load. A key already
    running for an earlier request is not waited for again: its answer (if done) or the
    fallback, while it finishes in the background. At most `max_background()` such tasks run at
    once; past that a call is simply cut off at its deadline (no background run)."""
    task = _inflight.get(key)
    if task is not None and key in _prefetched:
        # started ahead for this very page (the fast phase): worth waiting for, within budget
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=wait_s())
        except TimeoutError:
            return fallback()
    if task is not None:  # left over from an earlier full request: don't wait on it again
        if task.done() and not task.cancelled() and task.exception() is None:
            return task.result()
        return fallback()
    if len(_inflight) >= max_background():
        try:
            return await asyncio.wait_for(factory(), timeout=wait_s())
        except TimeoutError:
            return fallback()
    task = asyncio.ensure_future(asyncio.wait_for(factory(), timeout=background_limit_s()))
    _inflight[key] = task
    task.add_done_callback(lambda t, k=key: _settle(k, t))
    try:
        return await asyncio.wait_for(asyncio.shield(task), timeout=wait_s())
    except TimeoutError:
        return fallback()


def prefetch(key: str, factory) -> None:
    """Start `factory()` in the background now (no waiting) so a later `within(key, ...)` from
    the same page finds it running; skipped when already running or at the background cap."""
    if key in _inflight or len(_inflight) >= max_background():
        return
    task = asyncio.ensure_future(asyncio.wait_for(factory(), timeout=background_limit_s()))
    _inflight[key] = task
    _prefetched.add(key)
    task.add_done_callback(lambda t, k=key: _settle(k, t))


def _settle(key: str, task: asyncio.Task) -> None:
    if _inflight.get(key) is task:
        del _inflight[key]
        _prefetched.discard(key)
    if not task.cancelled() and task.exception() is not None:
        log.info("background LLM call ended without an answer: %r", task.exception())


_puts: set[asyncio.Task] = set()


def put_later(source: str, key: str, payload: Any) -> None:
    """`put` without waiting (from sync code); `drain()` waits for it."""
    task = asyncio.ensure_future(put(source, key, payload))
    _puts.add(task)
    task.add_done_callback(_puts.discard)


async def drain(timeout: float | None = None) -> None:
    """Wait for running LLM calls (tests; shutdown). With `timeout`, cancel what's left after it."""
    try:
        async with asyncio.timeout(timeout):
            while _inflight or _puts:
                await asyncio.gather(*list(_inflight.values()), *list(_puts),
                                     return_exceptions=True)  # fmt: skip
    except TimeoutError:
        for t in list(_inflight.values()):
            t.cancel()
        await asyncio.gather(*list(_inflight.values()), return_exceptions=True)


def inflight() -> int:
    return len(_inflight)
