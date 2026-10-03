"""The user's spend history for `scoring.value.typical_spend` (docs/BUDGET.md), shared by
POST /recommendations and the proactive scan so both score price against the same reference.

History = watched picks' prices + totals of trips swiped like/love (exact prices only). Cached
per user for a minute: the fast and full phases of one request pair look it up once."""

import asyncio
import logging
import time

log = logging.getLogger(__name__)

TTL_S = 60.0
MAX_LIKED = 20  # most recent liked trips looked up (bounds the per-request store reads)
_cache: dict[str, tuple[float, list[float]]] = {}


async def spend_history(store, notify, user_id: str) -> list[float]:
    hit = _cache.get(user_id)
    if hit is not None and time.monotonic() - hit[0] < TTL_S:
        return list(hit[1])
    spent: list[float] = []
    if notify is not None:
        try:
            picks = await asyncio.to_thread(notify.picks, user_id)  # may hit Supabase
            spent += [p.baseline_pln for p in picks]
        except Exception as exc:  # noqa: BLE001 - history is a nicety, never a failure
            log.warning("spend history (picks) failed for %s: %s", user_id, exc)
    try:
        reactions = await store.get_reactions(user_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("spend history (reactions) failed for %s: %s", user_id, exc)
        reactions = {}
    liked = [rid for rid, r in reactions.items() if r.reaction in ("like", "love")][-MAX_LIKED:]
    recs = await asyncio.gather(*(store.get_recommendation(user_id, rid) for rid in liked))
    spent += [r.total_cost_pln for r in recs if r is not None and r.price_status == "exact"]
    _cache[user_id] = (time.monotonic(), spent)
    return spent


def forget(user_id: str) -> None:
    """Drop the cached history (after a new like/love or a watched pick)."""
    _cache.pop(user_id, None)


def clear() -> None:
    _cache.clear()
