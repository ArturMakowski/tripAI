"""Search every origin airport the user picked, not just the first (Warszawa = WAW + WMI).

Airports are grouped by the city they serve (tripai.seed.airports) and each city is ONE provider
call with a comma origin ("WAW,WMI"): one SerpApi Google Flights search covers the whole city,
while Travelpayouts and fixtures loop per airport (tripai.live.provider). SerpApi is 30 calls/day,
so only the first city gets the full pipeline (exact-date refinement within the per-request cap);
further cities get the cheap pass: `fast=True` (Travelpayouts + cached SerpApi, never a new metered
call) and `fallback=False` (no sample fixtures), when the provider supports them. Per (destination,
window) the most honest offer wins (exact > partial > estimate > sample), then the cheapest; its
evidence names the airport it flies from."""

import asyncio
import inspect
import logging
from collections.abc import Iterable, Sequence
from typing import Any

from tripai.models import FreeWindow, LuxuryLevel
from tripai.scoring.engine import candidate_id
from tripai.scoring.provider import TripDataProvider
from tripai.scoring.types import Candidate
from tripai.seed import load

log = logging.getLogger(__name__)

DEFAULT_ORIGIN = "KRK"
MAX_ORIGINS = 4  # bounds the fan-out (each extra origin = one cheap provider pass)


def origin_codes(origins: Iterable[str] | None) -> list[str]:
    """Upper-cased, de-duplicated, order kept, at most MAX_ORIGINS; KRK when empty."""
    codes = list(dict.fromkeys(o.strip().upper() for o in origins or () if o and o.strip()))
    return codes[:MAX_ORIGINS] or [DEFAULT_ORIGIN]


def city_groups(codes: Sequence[str]) -> list[str]:
    """["KRK", "WAW", "WMI"] -> ["KRK", "WAW,WMI"]: one origin per city, order kept."""
    groups: dict[str, list[str]] = {}
    for code in codes:
        ap = load.airport(code)
        city = (ap.city or {}).get("en") if ap is not None else None
        groups.setdefault(city or code, []).append(code)
    return [",".join(g) for g in groups.values()]


# docs/BUDGET.md "Price honesty": an offer priced for the exact dates beats any estimate, whatever
# the numbers say (an estimate total is a median fare + a city-average hotel: not comparable).
HONESTY_RANK = {"exact": 0, "partial": 1, "estimate": 2}
SAMPLE_PENALTY = 10  # labelled sample fixtures lose to any live offer


def _is_sample(c: Candidate) -> bool:
    return any(e.source.startswith("fixture:") for e in c.evidence if e.kind == "flight")


def offer_key(c: Candidate) -> tuple[int, float]:
    """(honesty rank, party total): lower is better; only equally honest offers compete on price."""
    rank = HONESTY_RANK.get(c.price_status, len(HONESTY_RANK))
    return (rank + (SAMPLE_PENALTY if _is_sample(c) else 0), c.party_total_pln)


def merge_cheapest(groups: Sequence[Sequence[Candidate]]) -> list[Candidate]:
    """One candidate per (destination, window): the most honest price first (live exact >
    partial > estimate > sample), then the lowest party total; ties keep the earlier group (the
    primary city, the refined one)."""
    best: dict[str, Candidate] = {}
    for group in groups:
        for c in group:
            k = candidate_id(c)
            if k not in best or offer_key(c) < offer_key(best[k]):
                best[k] = c
    return list(best.values())


async def candidates_for_origins(
    provider: TripDataProvider,
    origins: Iterable[str] | None,
    windows: Sequence[FreeWindow],
    luxury: LuxuryLevel,
    **extra: Any,
) -> list[Candidate]:
    codes = city_groups(origin_codes(origins))
    params = inspect.signature(provider.candidates).parameters
    kwargs = {k: v for k, v in extra.items() if k in params}
    cheap = dict(kwargs)
    if "fast" in params and getattr(provider, "supports_fast", False):
        cheap["fast"] = True
    if "fallback" in params:
        cheap["fallback"] = False
    calls = [provider.candidates(codes[0], windows, luxury, **kwargs)]
    calls += [provider.candidates(o, windows, luxury, **cheap) for o in codes[1:]]
    results = await asyncio.gather(*calls, return_exceptions=True)
    if isinstance(results[0], BaseException):
        raise results[0]
    groups: list[Sequence[Candidate]] = [results[0]]
    for code, res in zip(codes[1:], results[1:], strict=True):
        if isinstance(res, BaseException):
            log.warning("candidates from %s failed: %s", code, res)
        else:
            groups.append(res)
    return merge_cheapest(groups)
