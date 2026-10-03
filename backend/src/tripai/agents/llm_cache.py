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
_background: set[asyncio.Task] = set()


def background_limit_s() -> float:
    """How long a timed-out LLM call may keep running to fill the cache for the next load."""
    try:
        return max(0.0, float(os.getenv("TRIPAI_LLM_BACKGROUND_S") or DEFAULT_BACKGROUND_S))
    except ValueError:
        return DEFAULT_BACKGROUND_S


async def within(coro, fallback):
    """Run `coro` (which caches its own result) as a task and wait at most `llm_timeout_s()`.
    On time: its result. Late: `fallback()` now, while the task finishes (up to
    `background_limit_s()`) and fills the cache, so the next load gets the real answer."""
    task = asyncio.ensure_future(asyncio.wait_for(coro, timeout=background_limit_s()))
    try:
        return await asyncio.wait_for(asyncio.shield(task), timeout=llm_timeout_s())
    except TimeoutError:
        _background.add(task)
        task.add_done_callback(_settle)
        return fallback()


def _settle(task: asyncio.Task) -> None:
    _background.discard(task)
    if not task.cancelled() and task.exception() is not None:
        log.info("background LLM call ended without an answer: %r", task.exception())


async def drain() -> None:
    """Wait for background LLM calls (tests; graceful shutdown)."""
    while _background:
        await asyncio.gather(*list(_background), return_exceptions=True)
