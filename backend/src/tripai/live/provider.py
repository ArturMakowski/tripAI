"""LiveProvider: seed data + live connectors behind the scorer's `TripDataProvider` seam.

Budget-aware pipeline for one `/recommendations` call:
  1. Shortlist cities from the seed (taste fit to the profile, direct routes first). No I/O.
  2. Cheap pass for every (city, window): Travelpayouts month calendar (free) or one Google Travel
     Explore call for flights, Explore/estimate for hotels, Open-Meteo month normals for weather,
     Eurostat seed for crowds, holidays + attractions from seed.
  3. Pre-rank with the real scorer; only the top N (distinct cities) get exact-date SerpApi Google
     Flights + Google Hotels, exact-window Open-Meteo, and a Serper photo.
Every number becomes `Evidence` with `source` + `fetched_at`; synthetic fixtures keep their tag.
A failing connector drops its evidence and lowers the `confidence` evidence; it never raises.
"""

import asyncio
import logging
import statistics
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

from tripai.connectors import config
from tripai.connectors.base import FixtureNotFound
from tripai.connectors.cache import Cache, DiskCache, LayeredCache, NullCache, SupabaseCache
from tripai.connectors.open_meteo import OpenMeteo, WeatherSummary
from tripai.connectors.serpapi import (
    ExploreDestination,
    ExploreResult,
    SerpApiExplore,
    SerpApiFlights,
    SerpApiHotels,
)
from tripai.connectors.serper import Serper
from tripai.connectors.travelpayouts import FlightCalendar, Travelpayouts
from tripai.live import sources
from tripai.live.budget import BudgetExhausted, SerpApiBudget, global_budget, request_cap
from tripai.models import Evidence, FreeWindow, LuxuryLevel, TasteProfile, Weights
from tripai.scoring.engine import MONTHS, candidate_id, rank, taste_score
from tripai.scoring.provider import LUXURY_HOTEL_MULT, CityInfo, FixtureProvider, TripDataProvider
from tripai.scoring.types import Candidate, PeakQuote
from tripai.seed import load

log = logging.getLogger(__name__)

DEFAULT_MAX_CITIES = 12
DEFAULT_TOP_N = 3  # exact-date SerpApi flights + hotels for this many cities...
DEFAULT_MAX_REFINE = 6  # ...re-checked until the top N are refined, at most this many in total
KIND_ORDER = {k: i for i, k in enumerate(
    ("flight", "hotel", "price_baseline", "peak", "weather", "crowds", "holiday", "attraction",
     "photo", "confidence")
)}  # fmt: skip
TAG_MIN_WEIGHT = 0.5
BASELINE_PREFIX = "Typical trip cost for the deal comparison:"
NEAREST_FARE_DAYS = 3
CONCURRENCY = 8

# Last-resort hotel price when no live source answered: an editorial table (typical mid-range
# double-room price per night by country), labelled as such. `fetched_at` = when it was compiled.
ESTIMATE_SOURCE = "estimate:tripai-editorial"
ESTIMATE_FETCHED_AT = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)  # table compiled, nothing fetched
NIGHTLY_ESTIMATE_PLN = {
    "AL": 220, "AT": 480, "CY": 380, "CZ": 340, "DE": 450, "DK": 650, "ES": 420, "FR": 560,
    "GB": 620, "GR": 380, "HR": 400, "HU": 300, "IE": 600, "IS": 750, "IT": 460, "MT": 400,
    "NL": 600, "NO": 700, "PT": 380, "SE": 600,
}  # fmt: skip
DEFAULT_NIGHTLY_PLN = 450

# Luxury level -> which quantile of live hotel offers we price at.
LUXURY_QUANTILE = {
    LuxuryLevel.budget: 0.25,
    LuxuryLevel.standard: 0.5,
    LuxuryLevel.comfort: 0.75,
    LuxuryLevel.luxury: 0.9,
}


def _env_int(name: str, default: int) -> int:
    try:
        return int(config.env(name) or default)
    except ValueError:
        return default


def _city_tags(c: load.City) -> list[str]:
    return [t for t, w in sorted(c.tags.items(), key=lambda kv: -kv[1]) if w >= TAG_MIN_WEIGHT]


def _days_per_month(start: date, end: date) -> dict[tuple[int, int], int]:
    out: dict[tuple[int, int], int] = {}
    d = start
    while d <= end:
        out[(d.year, d.month)] = out.get((d.year, d.month), 0) + 1
        d += timedelta(days=1)
    return out


def _month_bounds(y: int, m: int) -> tuple[date, date]:
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return date(y, m, 1), nxt - timedelta(days=1)


def _span(start: date, end: date) -> str:
    return f"{start:%d %b}–{end:%d %b}"


def _quantile(values: list[float], q: float) -> float:
    xs = sorted(values)
    pos = q * (len(xs) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def _plain(name: str) -> str:
    """Search-friendly city name: "Valletta (Malta)" -> "Valletta"."""
    return name.split(" (")[0]


@dataclass
class _Quality:
    """Per-factor data quality (1 = live, exact dates) and a human-readable basis."""

    parts: dict[str, tuple[float, str]] = field(default_factory=dict)

    def set(self, factor: str, q: float, basis: str) -> None:
        self.parts[factor] = (q, basis)

    def mark_fixtures(self, evidence: Sequence[Evidence]) -> None:
        """A factor whose headline fact came from a fixture counts half."""
        for f in ("flight", "hotel", "weather"):
            first = next((e for e in evidence if e.kind == f), None)
            if first is not None and "fixture]" in first.source and f in self.parts:
                q, basis = self.parts[f]
                self.parts[f] = (q / 2, basis + " (fixture)")

    def evidence(self) -> Evidence:
        factors = ("flight", "hotel", "weather", "crowds")
        qs = [self.parts.get(f, (0.0, "unavailable"))[0] for f in factors]
        basis = "; ".join(f"{f}: {self.parts.get(f, (0.0, 'unavailable'))[1]}" for f in factors)
        return Evidence(
            kind="confidence",
            label=f"Data confidence (1 = live data for your exact dates). {basis}",
            value=round(sum(qs) / len(qs), 2),
            unit="0-1",
            source="tripai:live-provider",
            fetched_at=datetime.now(UTC),
        )


@dataclass
class _CityData:
    city: load.City
    tags: list[str]
    highlights: list[str]
    calendars: dict[tuple[int, int], FlightCalendar]
    climate: dict[tuple[int, int], WeatherSummary]
    explore: ExploreDestination | None
    explore_res: ExploreResult | None
    peak: tuple[int, int] | None = None  # (year, month) of the seed's busiest month, next one


def _session_cache(client: httpx.AsyncClient) -> Cache:
    """Like `connectors.cache.default_cache`, but the Supabase layer reuses the session's HTTP
    client (one TLS handshake instead of one per cache lookup)."""
    if config.cache_disabled():
        return NullCache()
    url, key = config.env("SUPABASE_URL"), config.env("SUPABASE_SECRET_KEY")
    if url and key:
        return LayeredCache(DiskCache(), SupabaseCache(url, key, client=client))
    return LayeredCache(DiskCache())


# First word of a `_Session.call` label -> source name (for the coverage summary).
_CALL_SOURCE = {
    "explore": "serpapi",
    "google_flights": "serpapi",
    "google_hotels": "serpapi",
    "open-meteo": "open_meteo",
    "serper": "serper",
    "travelpayouts": "travelpayouts",
}


class _Session:
    """Connectors sharing one HTTP client, a concurrency limit and per-request memoisation."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        cache: Cache | None,
        fixtures: bool | None,
        today: date | None,
        budget: SerpApiBudget | None = None,
    ):
        # fixtures=None: per-source mode from env (TRIPAI_FIXTURE_SOURCES, missing keys, ...)
        self.modes = (
            sources.modes()
            if fixtures is None
            else dict.fromkeys(sources.SOURCES, "fixture" if fixtures else "live")
        )
        kw = {"client": client, "cache": cache or _session_cache(client)}

        def fx(source: str) -> dict:
            return {**kw, "fixtures": self.modes[source] == "fixture"}

        self.tp = Travelpayouts(**fx("travelpayouts"))
        # SerpApi: metered live connectors + fixture twins served once a cap is hit
        self.budget = budget or global_budget()
        self.request_cap = request_cap()
        serp = fx("serpapi")
        self.serp = {
            "explore": SerpApiExplore(**serp),
            "flights": SerpApiFlights(**serp),
            "hotels": SerpApiHotels(**serp),
        }
        if not serp["fixtures"]:
            for conn in self.serp.values():
                self._meter(conn)
        self.serp_fx = {
            "explore": SerpApiExplore(**{**kw, "fixtures": True}),
            "flights": SerpApiFlights(**{**kw, "fixtures": True}),
            "hotels": SerpApiHotels(**{**kw, "fixtures": True}),
        }
        self.meteo = OpenMeteo(**fx("open_meteo"))
        self.serper = Serper(**fx("serper"))
        self.today = today
        self._sem = asyncio.Semaphore(CONCURRENCY)
        self.failures: list[str] = []  # real errors only
        self.uncovered: dict[str, int] = {}  # source -> fixture lookups with no recording
        self.capped = 0  # SerpApi calls skipped by the budget
        self.serpapi_calls = 0  # lookups through live connectors (cache hits included)
        self.serpapi_network = 0  # real SerpApi searches (metered)

    def _meter(self, conn: Any) -> None:
        """Wrap the connector's HTTP step: cache hits never get here, so only real searches
        count against the per-request and the shared daily cap."""
        http = conn._http

        async def metered(*a: Any, **k: Any) -> Any:
            if self.serpapi_network >= self.request_cap:
                raise BudgetExhausted(f"per-request SerpApi cap ({self.request_cap}) reached")
            self.serpapi_network += 1  # reserved before awaiting: concurrent calls see it
            try:
                await self.budget.take()
            except BudgetExhausted:
                self.serpapi_network -= 1
                raise
            return await http(*a, **k)

        conn._http = metered

    def live(self, source: str) -> bool:
        return self.modes[source] == "live"

    def label(self, e: Evidence) -> Evidence:
        """Tag evidence served from a recorded (real but not fresh) fixture."""
        src = sources.source_of_evidence(e.source)
        if src is None or self.live(src) or "fixture]" in e.source:
            return e
        return e.model_copy(update={"source": e.source + sources.RECORDED_TAG})

    def _uncovered(self, what: str) -> None:
        """A fixture-mode source with no recording for this request: the data is simply not
        available (expected: fixtures cover 14-19 Jan 2027 for 10 routes), not a failure."""
        src = _CALL_SOURCE.get(what.split()[0], what.split()[0])
        self.uncovered[src] = self.uncovered.get(src, 0) + 1

    async def call(self, what: str, fn: Callable[[], Awaitable[Any]]) -> Any | None:
        """Run one connector call; any failure is logged and becomes None (never raises)."""
        async with self._sem:
            try:
                return await fn()
            except FixtureNotFound:
                self._uncovered(what)
                return None
            except Exception as exc:  # noqa: BLE001 - graceful degradation is the contract
                log.warning("live provider: %s failed: %s", what, exc)
                self.failures.append(f"{what}: {type(exc).__name__}")
                return None

    async def serpapi(self, what: str, kind: str, fn: Callable[[Any], Awaitable[Any]]) -> Any:
        """SerpApi call through the metered connector `kind`; once a cap is hit, the recorded
        fixture for the same request (if any) answers instead, labelled as such."""
        self.serpapi_calls += self.live("serpapi")
        async with self._sem:
            try:
                return await fn(self.serp[kind])
            except BudgetExhausted:
                self.capped += 1  # deliberate spend limit, not a failure (summary line only)
            except FixtureNotFound:
                self._uncovered(what)
                return None
            except Exception as exc:  # noqa: BLE001 - graceful degradation is the contract
                log.warning("live provider: %s failed: %s", what, exc)
                self.failures.append(f"{what}: {type(exc).__name__}")
                return None
        res = await self.call(f"{what} (fixture)", lambda: fn(self.serp_fx[kind]))
        if res is not None and not res.synthetic:
            res.source += sources.RECORDED_TAG
        return res


class LiveProvider:
    """`TripDataProvider` backed by `tripai.seed` + `tripai.connectors`.

    `fixtures=True` forces connector fixtures (tests); `city_ids` restricts the seed city list;
    `fallback` serves (clearly labelled) fixture candidates if the live pipeline yields nothing;
    off by default (TRIPAI_LIVE_FALLBACK=1 turns it on): the API answers 503 instead, so synthetic
    numbers are never silently presented as a live result.
    """

    def __init__(
        self,
        *,
        max_cities: int | None = None,
        top_n: int | None = None,
        max_refine: int | None = None,
        fixtures: bool | None = None,
        cache: Cache | None = None,
        today: date | None = None,
        city_ids: Sequence[str] | None = None,
        fallback: TripDataProvider | None = None,
        use_fallback: bool | None = None,
        budget: SerpApiBudget | None = None,
    ) -> None:
        self.max_cities = max_cities or _env_int("TRIPAI_LIVE_MAX_CITIES", DEFAULT_MAX_CITIES)
        self.top_n = top_n if top_n is not None else _env_int("TRIPAI_LIVE_TOP_N", DEFAULT_TOP_N)
        self.max_refine = (
            max_refine
            if max_refine is not None
            else _env_int("TRIPAI_LIVE_MAX_REFINE", max(DEFAULT_MAX_REFINE, self.top_n))
        )
        if self.top_n <= 0:
            self.max_refine = 0
        self.fixtures = fixtures
        self.cache = cache
        self.today = today
        self.city_ids = list(city_ids) if city_ids else None
        if use_fallback is None:
            use_fallback = config.flag("TRIPAI_LIVE_FALLBACK")
        self.fallback = (fallback or FixtureProvider()) if use_fallback else None
        self.budget = budget
        self.last_stats: dict[str, Any] = {}

    async def budget_status(self) -> dict[str, Any]:
        return await (self.budget or global_budget()).status()

    def source_modes(self) -> dict[str, str]:
        """Per-source 'live' | 'fixture' (reported by GET /health)."""
        if self.fixtures is not None:
            return dict.fromkeys(sources.SOURCES, "fixture" if self.fixtures else "live")
        return sources.modes()

    # ------------------------------------------------------------------ seed

    def _seed_cities(self, origin: str) -> list[load.City]:
        out = [c for c in load.cities() if origin.upper() not in c.airports]
        if self.city_ids is not None:
            out = [c for c in out if c.id in self.city_ids or c.iata in self.city_ids]
        return out

    def _shortlist(self, origin: str, profile: TasteProfile) -> list[load.City]:
        def key(c: load.City) -> tuple:
            fit = taste_score(_city_tags(c), profile.interests, profile.dislikes)
            return (-(fit + (0.1 if origin.upper() in c.direct_from else 0.0)), c.id)

        return sorted(self._seed_cities(origin), key=key)[: self.max_cities]

    @staticmethod
    def _highlights(c: load.City, interests: dict[str, float] | None) -> list[str]:
        try:
            return [a.name for a in load.attractions(c.id, tags=interests or None, limit=3)]
        except Exception:  # noqa: BLE001
            return []

    async def cities(self, origin: str = "KRK") -> list[CityInfo]:
        return [
            CityInfo(
                city=c.name,
                country=c.country_name,
                iata=c.iata,
                tags=_city_tags(c),
                highlights=self._highlights(c, None),
            )
            for c in self._seed_cities(origin)
        ]

    # ------------------------------------------------------------------ entry point

    async def candidates(
        self,
        origin: str,
        windows: Sequence[FreeWindow],
        luxury: LuxuryLevel = LuxuryLevel.standard,
        *,
        profile: TasteProfile | None = None,
        weights: Weights | None = None,
    ) -> list[Candidate]:
        try:
            out = await self._live(origin, list(windows), luxury, profile, weights)
        except Exception:
            log.exception("live provider failed; falling back")
            out = []
        if not out and windows and self.fallback is not None:
            log.warning("live provider produced no candidates; serving labelled fixtures")
            self.last_stats["fallback"] = type(self.fallback).__name__
            return await self.fallback.candidates(origin, windows, luxury)
        return out

    async def _live(
        self,
        origin: str,
        windows: list[FreeWindow],
        luxury: LuxuryLevel,
        profile: TasteProfile | None,
        weights: Weights | None,
    ) -> list[Candidate]:
        if not windows:
            return []
        origin = origin.upper()
        profile = profile or TasteProfile(user_id="_live")
        cities = self._shortlist(origin, profile)
        nights = [max(1, (w.end - w.start).days) for w in windows]
        trip_days = (min(nights), min(max(nights), 30))
        async with httpx.AsyncClient(timeout=30) as client:
            s = _Session(client, self.cache, self.fixtures, self.today, self.budget)
            explore = await s.serpapi("explore", "explore", lambda c: c.explore(origin))
            got = await asyncio.gather(
                *(
                    self._city_data(s, origin, c, windows, trip_days, explore, profile)
                    for c in cities
                ),
                return_exceptions=True,
            )
            data: list[_CityData] = []
            for c, d in zip(cities, got):
                if isinstance(d, BaseException):  # one bad city never sinks the others
                    log.warning("live provider: city %s dropped: %r", c.id, d)
                    s.failures.append(f"city {c.id}: {type(d).__name__}")
                else:
                    data.append(d)
            cands: list[Candidate] = []
            quality: dict[str, _Quality] = {}
            for d in data:
                for w in windows:
                    try:
                        built = self._candidate(d, origin, w, luxury)
                    except Exception as exc:  # noqa: BLE001 - drop this option only
                        log.warning("live provider: %s %s dropped: %r", d.city.id, w.start, exc)
                        s.failures.append(f"candidate {d.city.id} {w.start}: {type(exc).__name__}")
                        continue
                    if built is not None:
                        cands.append(built[0])
                        quality[candidate_id(built[0])] = built[1]
            by_city = {d.city.iata: d for d in data}
            refined: set[str] = set()
            # Exact-date prices usually differ from the cached estimates, so re-rank after each
            # round until the top N are all refined or the refinement budget is spent.
            while cands and len(refined) < self.max_refine:
                top = [r.id for r in rank(cands, profile, weights, limit=self.top_n)]
                todo = [cid for cid in top if cid not in refined]
                todo = todo[: self.max_refine - len(refined)]
                if not todo:
                    break
                refined.update(todo)
                done = await asyncio.gather(
                    *(
                        self._refine(s, origin, c, by_city[c.iata], luxury, quality[cid])
                        for c in cands
                        if (cid := candidate_id(c)) in todo
                    )
                )
                swap = {candidate_id(c): c for c in done}
                cands = [swap.get(candidate_id(c), c) for c in cands]
            final = []
            for c in cands:
                ev = [s.label(e) for e in c.evidence]
                q = quality[candidate_id(c)]
                q.mark_fixtures(ev)
                ev = sorted([*ev, q.evidence()], key=lambda e: KIND_ORDER.get(e.kind, 99))
                final.append(c.model_copy(update={"evidence": ev}))
            cands = final
            self.last_stats = {
                "cities": len(cities),
                "candidates": len(cands),
                "refined": sorted(refined),
                "serpapi_calls": s.serpapi_calls,
                "serpapi_network": s.serpapi_network,
                "sources": s.modes,
                "failures": s.failures[:200],
                "uncovered": dict(s.uncovered),
                "capped": s.capped,
            }
            # one summary line per request (no per-call noise for expected gaps)
            log.info(
                "live provider: %d candidates from %d cities; SerpApi searches: %d, capped: %d; "
                "fixtures without coverage: %s; failures: %d",
                len(cands),
                len(cities),
                s.serpapi_network,
                s.capped,
                ", ".join(f"{k} x{v}" for k, v in sorted(s.uncovered.items())) or "none",
                len(s.failures),
            )
            return cands

    # ------------------------------------------------------------------ cheap pass

    async def _city_data(
        self,
        s: _Session,
        origin: str,
        c: load.City,
        windows: list[FreeWindow],
        trip_days: tuple[int, int],
        explore: ExploreResult | None,
        profile: TasteProfile,
    ) -> _CityData:
        dep_months = sorted({(w.start.year, w.start.month) for w in windows})
        all_months = sorted({ym for w in windows for ym in _days_per_month(w.start, w.end)})
        peak = self._peak_month(c, s.today)
        if peak is not None and peak not in dep_months:
            dep_months.append(peak)

        async def calendar(y: int, m: int) -> FlightCalendar | None:
            return await s.call(
                f"travelpayouts {origin}-{c.iata} {y}-{m:02d}",
                lambda: s.tp.month_calendar(origin, c.iata, f"{y}-{m:02d}", trip_days=trip_days),
            )

        async def climate(y: int, m: int) -> WeatherSummary | None:
            start, end = _month_bounds(y, m)
            return await s.call(
                f"open-meteo {c.id} {y}-{m:02d}",
                lambda: s.meteo.climate_normals(
                    c.lat, c.lon, start, end, place=c.name, today=s.today
                ),
            )

        cal_jobs = [calendar(*ym) for ym in dep_months]
        clim_jobs = [climate(*ym) for ym in all_months]
        cals, clims = await asyncio.gather(asyncio.gather(*cal_jobs), asyncio.gather(*clim_jobs))
        calendars = {ym: r for ym, r in zip(dep_months, cals) if r is not None and r.fares}
        climates = {ym: r for ym, r in zip(all_months, clims) if r is not None}
        # Peak-month weather only matters if there are peak-month fares to compare against.
        if peak in calendars and peak not in climates and (r := await climate(*peak)) is not None:
            climates[peak] = r
        return _CityData(
            city=c,
            tags=_city_tags(c),
            highlights=self._highlights(c, profile.interests),
            calendars=calendars,
            climate=climates,
            explore=self._explore_match(explore, c),
            explore_res=explore,
            peak=peak,
        )

    def _peak_month(self, c: load.City, today: date | None) -> tuple[int, int] | None:
        try:
            scores = load.crowd(c.id).score
        except KeyError:
            return None
        m = max(range(12), key=scores.__getitem__) + 1
        today = today or datetime.now(UTC).date()
        return (today.year if m >= today.month else today.year + 1, m)

    @staticmethod
    def _explore_match(explore: ExploreResult | None, c: load.City) -> ExploreDestination | None:
        if explore is None:
            return None
        hits = [d for d in explore.destinations if d.iata and d.iata in c.airports]
        hits.sort(key=lambda d: (d.name.lower() != c.name.lower(), d.flight_price is None))
        return hits[0] if hits else None

    def _flight(
        self, d: _CityData, origin: str, w: FreeWindow
    ) -> tuple[float, Evidence, float, str] | None:
        cal = d.calendars.get((w.start.year, w.start.month))
        if cal is not None:
            by_day = cal.by_departure_day()
            fare, note, q = by_day.get(w.start), "", 0.8
            if fare is not None and fare.return_at and fare.return_at.date() != w.end:
                q = 0.65
            if fare is None:
                near = [day for day in by_day if abs((day - w.start).days) <= NEAREST_FARE_DAYS]
                if near:
                    fare = by_day[min(near, key=lambda day: (abs((day - w.start).days), day))]
                    note, q = f"; nearest cached fare to {w.start:%d %b}", 0.55
            if fare is not None:
                back = f", back {fare.return_at:%d %b}" if fare.return_at else ""
                stops = "direct" if not fare.transfers else f"{fare.transfers} stop(s)"
                label = (
                    f"Return {origin}-{d.city.iata} dep {fare.departure_at:%d %b}{back}, "
                    f"{fare.airline or '?'} {stops} (Aviasales cached fare, not bookable{note})"
                )
                ev = cal._ev("flight", label, fare.price, cal.currency, fare.link)
                return fare.price, ev, q, "Aviasales cached fare"
            med = round(statistics.median(f.price for f in cal.fares))
            label = (
                f"Typical return {origin}-{d.city.iata} in {MONTHS[w.start.month - 1]} "
                f"(median of {len(cal.fares)} Aviasales cached fares, not your exact dates)"
            )
            return med, cal._ev("flight", label, med, cal.currency), 0.45, "month median fare"
        e = d.explore
        if e is not None and e.flight_price is not None and d.explore_res is not None:
            dates = f" {_span(e.start_date, e.end_date)}" if e.start_date and e.end_date else ""
            label = (
                f"Cheapest return {origin}-{e.iata}{dates} on Google Travel Explore "
                "(not your exact dates)"
            )
            ev = d.explore_res._ev("flight", label, e.flight_price, d.explore_res.currency, e.link)
            return e.flight_price, ev, 0.35, "Google Travel Explore"
        return None

    def _hotel(
        self, d: _CityData, w: FreeWindow, luxury: LuxuryLevel
    ) -> tuple[float, Evidence, float, str]:
        nights = max(1, (w.end - w.start).days)
        mult = LUXURY_HOTEL_MULT[luxury]
        e = d.explore
        if e is not None and e.hotel_price is not None and d.explore_res is not None:
            total = round(e.hotel_price * mult * nights)
            label = (
                f"Hotel {nights} nights in {d.city.name}: {e.hotel_price:.0f} PLN/night "
                f"(Google Travel Explore, not your exact dates) x{mult} for {luxury.value}"
            )
            return total, d.explore_res._ev("hotel", label, total, "PLN"), 0.5, "Explore nightly"
        nightly = NIGHTLY_ESTIMATE_PLN.get(d.city.country, DEFAULT_NIGHTLY_PLN)
        total = round(nightly * mult * nights)
        ev = Evidence(
            kind="hotel",
            label=(
                f"Hotel {nights} nights in {d.city.name}: rough estimate {nightly} PLN/night "
                f"x{mult} for {luxury.value} (no live hotel data; editorial per-country table of "
                "typical mid-range double rooms, compiled 3 Oct 2026, not a fetched price)"
            ),
            value=total,
            unit="PLN",
            source=ESTIMATE_SOURCE,
            fetched_at=ESTIMATE_FETCHED_AT,
        )
        return total, ev, 0.2, "editorial estimate"

    def _weather(
        self, d: _CityData, w: FreeWindow
    ) -> tuple[float, list[Evidence], float, str] | None:
        months = _days_per_month(w.start, w.end)
        got = {
            ym: d.climate[ym]
            for ym in months
            if ym in d.climate and d.climate[ym].avg_temp_max_c is not None
        }
        if not got:
            return None
        n = sum(months[ym] for ym in got)
        temp = round(sum(got[ym].avg_temp_max_c * months[ym] for ym in got) / n, 1)
        main = max(got, key=lambda ym: months[ym])
        summ = got[main]
        yrs = f"{min(summ.years)}–{max(summ.years)}" if summ.years else "historical"
        mnames = "/".join(MONTHS[m - 1] for _, m in sorted(got))
        ev = [
            summ._ev(
                "weather",
                f"Avg daily max in {d.city.name} {_span(w.start, w.end)} "
                f"({mnames} climate normals, {yrs} avg)",
                temp,
                "°C",
            )
        ]
        if summ.rainy_day_share is not None:
            ev.append(
                summ._ev(
                    "weather",
                    f"Rainy days in {d.city.name}, {MONTHS[main[1] - 1]} ({yrs} avg)",
                    summ.rainy_day_share,
                    "0-1",
                )
            )
        return temp, ev, 0.75, "month climate normals"

    def _crowds(self, d: _CityData, w: FreeWindow) -> tuple[float, list[Evidence], float, str]:
        months = _days_per_month(w.start, w.end)
        try:
            prof = load.crowd(d.city.id)
        except KeyError:
            ev = Evidence(
                kind="crowds",
                label=f"No crowd data for {d.city.name}: scored neutral",
                value=0.5,
                unit="0-1",
                source="tripai:live-provider",
                fetched_at=datetime.now(UTC),
            )
            return 0.5, [ev], 0.0, "unavailable"
        n = sum(months.values())
        crowd = round(sum(prof.score[m - 1] * k for (_, m), k in months.items()) / n, 2)
        seen = sorted(
            {m for _, m in months},
            key=lambda m: -sum(k for (_, mm), k in months.items() if mm == m),
        )
        ev = [load.crowd_evidence(d.city.id, m) for m in seen]
        q = 0.7 if prof.geo_level == "proxy" else 0.9
        return crowd, ev, q, f"Eurostat {prof.geo_level}"

    def _context_evidence(self, d: _CityData, origin: str, w: FreeWindow) -> list[Evidence]:
        out: list[Evidence] = []
        try:
            flags = load.crowd_flags(d.city.id, w.start, w.end)
            if flags:
                hm = load.meta("holidays.json")
                out.append(
                    Evidence(
                        kind="holiday",
                        label=f"Local holidays in {d.city.name} during your dates (busier)",
                        value="; ".join(flags),
                        source=hm.source,
                        fetched_at=hm.fetched_at,
                    )
                )
            breaks = [b for b in load.school_breaks(airport=origin) if b.overlaps(w.start, w.end)]
            if breaks:
                hm = load.meta("holidays.json")
                out.append(
                    Evidence(
                        kind="holiday",
                        label=f"PL school break overlaps (flights from {origin} may be fuller)",
                        value="; ".join(f"{b.name} {b.start}..{b.end}" for b in breaks),
                        source=hm.source,
                        fetched_at=hm.fetched_at,
                        url=breaks[0].url,
                    )
                )
        except (KeyError, ValueError) as exc:  # e.g. an origin airport without voivodeship
            log.debug("holiday context for %s skipped: %s", d.city.id, exc)
        if d.highlights:
            am = load.meta("attractions.json")
            try:
                top = load.attractions(d.city.id, limit=1)
            except Exception:  # noqa: BLE001 - the link is optional
                top = []
            out.append(
                Evidence(
                    kind="attraction",
                    label=f"Top sights in {d.city.name} matching your interests",
                    value=", ".join(d.highlights),
                    source=am.source,
                    fetched_at=am.fetched_at,
                    url=top[0].url if top else None,
                )
            )
        photo = self._seed_photo(d)
        if photo is not None:
            out.append(photo)
        return out

    @staticmethod
    def _seed_photo(d: _CityData) -> Evidence | None:
        try:
            items = load.attractions(d.city.id)
        except Exception:  # noqa: BLE001
            return None
        img = next((a for a in items if a.image), None)
        if img is None:
            return None
        am = load.meta("attractions.json")
        return Evidence(
            kind="photo",
            label=f"{img.name}, {d.city.name} (Wikimedia Commons)",
            value=img.image,
            source=am.source,
            fetched_at=am.fetched_at,
            url=img.url,
        )

    def _baseline(
        self, d: _CityData, origin: str, flight: float, hotel: float
    ) -> tuple[float, Evidence | None]:
        """Seasonal median: median cached fare across every month we fetched (incl. the peak
        month) + the same hotel cost, so the 'deal' score compares like with like."""
        fares = [f.price for cal in d.calendars.values() for f in cal.fares]
        if not fares:
            return flight + hotel, None
        med = round(statistics.median(fares))
        cal = next(iter(d.calendars.values()))
        months = ", ".join(f"{MONTHS[m - 1]} {y}" for y, m in sorted(d.calendars))
        ev = cal._ev(
            "price_baseline",
            f"{BASELINE_PREFIX} median cached return fare "
            f"{origin}-{d.city.iata} across {months} ({len(fares)} fares) + same hotel cost",
            round(med + hotel),
            "PLN",
        )
        return med + hotel, ev

    def _peak(self, d: _CityData, w: FreeWindow, hotel: float) -> tuple[PeakQuote | None, list]:
        ym = d.peak
        if ym is None or ym not in d.calendars:
            return None, []
        cal, clim = d.calendars[ym], d.climate.get(ym)
        if clim is None or clim.avg_temp_max_c is None:
            return None, []
        fare = round(statistics.median(f.price for f in cal.fares))
        month = f"{MONTHS[ym[1] - 1]} {ym[0]}"
        yrs = f"{min(clim.years)}–{max(clim.years)} avg" if clim.years else "historical avg"
        crowd = load.crowd_evidence(d.city.id, ym[1])
        # Own kind ("peak"): every PeakQuote number is sourced, and these facts never stand in
        # for the trip's own weather/crowds/baseline evidence.
        ev = [
            cal._ev(
                "peak",
                f"Peak-crowd month {month}: median cached return fare "
                f"{cal.origin}-{cal.destination} (hotel cost held equal to this trip)",
                fare,
                cal.currency,
            ),
            clim._ev(
                "peak",
                f"Peak-crowd month {month}: avg daily max in {d.city.name} ({yrs})",
                clim.avg_temp_max_c,
                "°C",
            ),
            crowd.model_copy(update={"kind": "peak", "label": "Peak-crowd month: " + crowd.label}),
        ]
        quote = PeakQuote(
            month=ym[1],
            flight_cost_pln=fare,
            hotel_cost_pln=hotel,
            temp_c=clim.avg_temp_max_c,
            crowd=crowd.value,
        )
        return quote, ev

    def _candidate(
        self, d: _CityData, origin: str, w: FreeWindow, luxury: LuxuryLevel
    ) -> tuple[Candidate, _Quality] | None:
        flight = self._flight(d, origin, w)
        weather = self._weather(d, w)
        if flight is None or weather is None:
            return None  # can't score without a price and a temperature
        q = _Quality()
        f_cost, f_ev, f_q, f_basis = flight
        h_cost, h_ev, h_q, h_basis = self._hotel(d, w, luxury)
        temp, w_ev, w_q, w_basis = weather
        crowd, c_ev, c_q, c_basis = self._crowds(d, w)
        q.set("flight", f_q, f_basis)
        q.set("hotel", h_q, h_basis)
        q.set("weather", w_q, w_basis)
        q.set("crowds", c_q, c_basis)
        median, base_ev = self._baseline(d, origin, f_cost, h_cost)
        peak, peak_ev = self._peak(d, w, h_cost)
        evidence = [
            f_ev,
            h_ev,
            *([base_ev] if base_ev else []),
            *peak_ev,
            *w_ev,
            *c_ev,
            *self._context_evidence(d, origin, w),
        ]
        cand = Candidate(
            city=d.city.name,
            country=d.city.country_name,
            iata=d.city.iata,
            tags=d.tags,
            window=w,
            flight_cost_pln=f_cost,
            hotel_cost_pln=h_cost,
            temp_c=temp,
            crowd=crowd,
            seasonal_median_cost_pln=median,
            peak=peak,
            highlights=d.highlights,
            evidence=evidence,
        )
        return cand, q

    # ------------------------------------------------------------------ top-N refinement

    async def _refine(
        self,
        s: _Session,
        origin: str,
        c: Candidate,
        d: _CityData,
        luxury: LuxuryLevel,
        q: _Quality,
    ) -> Candidate:
        w = c.window
        nights = c.nights
        jobs: list[Awaitable[Any]] = []
        jobs.append(
            s.serpapi(
                f"google_flights {origin}-{c.iata} {w.start}",
                "flights",
                lambda fl: fl.price_insights(origin, c.iata, w.start, w.end),
            )
        )
        jobs.append(
            s.serpapi(
                f"google_hotels {d.city.name} {w.start}",
                "hotels",
                lambda h: h.search(_plain(d.city.name), w.start, w.end, iata=c.iata),
            )
        )
        jobs.append(
            s.call(
                f"open-meteo window {d.city.id} {w.start}",
                lambda: s.meteo.weather(
                    d.city.lat, d.city.lon, w.start, w.end, place=d.city.name, today=s.today
                ),
            )
        )
        jobs.append(
            s.call(
                f"serper images {d.city.name}",
                lambda: s.serper.city_images(_plain(d.city.name), country=d.city.country_name),
            )
        )
        flights, hotels, weather, images = await asyncio.gather(*jobs)

        ev = list(c.evidence)
        upd: dict[str, Any] = {}
        flight_cost = c.flight_cost_pln
        flight_base: float | None = None
        if flights is not None and flights.lowest_price is not None:
            flight_cost = flights.lowest_price
            ev = [e for e in ev if e.kind != "flight"]
            ev[:0] = flights.evidence()
            q.set("flight", 1.0, "Google Flights, exact dates")
            if flights.typical_price_range:
                flight_base = sum(flights.typical_price_range) / 2
        upd["flight_cost_pln"] = flight_cost

        hotel_cost = c.hotel_cost_pln
        prices = [o.price_per_night for o in (hotels.offers if hotels else [])]
        prices = [p for p in prices if p is not None]
        if prices:
            pct = LUXURY_QUANTILE[luxury]
            nightly = round(_quantile(prices, pct))
            hotel_cost = nightly * nights
            ev = [e for e in ev if e.kind != "hotel"]
            mine = hotels._ev(
                "hotel",
                f"Hotel {nights} nights in {d.city.name} {_span(w.start, w.end)}: {nightly} PLN/night"
                f" ({round(pct * 100)}th percentile of {len(prices)} Google Hotels offers, "
                f"{luxury.value})",
                hotel_cost,
                hotels.currency,
            )
            ev[1:1] = [mine, *hotels.evidence()]
            q.set("hotel", 1.0, "Google Hotels, exact dates")
        upd["hotel_cost_pln"] = hotel_cost

        if weather is not None and weather.avg_temp_max_c is not None:
            upd["temp_c"] = weather.avg_temp_max_c
            upd["rainy_day_share"] = weather.rainy_day_share
            upd["sunshine_h"] = weather.avg_sunshine_h
            wev = weather.evidence()
            ev = [e for e in ev if e.kind != "weather"]  # avg max temp stays the first one
            ev.extend(wev)
            basis = "forecast" if weather.mode == "forecast" else "same dates, multi-year avg"
            q.set("weather", 1.0, basis)

        # Seasonal baseline: Google's typical range mid (exact dates) beats the calendar median.
        if flight_base is not None:
            ev = [e for e in ev if e.kind != "price_baseline"]  # replaced by Google's range
            ev.append(
                flights._ev(
                    "price_baseline",
                    f"{BASELINE_PREFIX} mid of Google's typical "
                    f"{origin}-{c.iata} fare range + same hotel cost",
                    round(flight_base + hotel_cost),
                    "PLN",
                )
            )
            upd["seasonal_median_cost_pln"] = flight_base + hotel_cost
        else:
            base_flight = c.seasonal_median_cost_pln - c.hotel_cost_pln
            upd["seasonal_median_cost_pln"] = base_flight + hotel_cost
        if c.peak is not None:
            upd["peak"] = c.peak.model_copy(update={"hotel_cost_pln": hotel_cost})

        best = images.best() if images is not None else None
        if best is not None:
            ev = [e for e in ev if e.kind != "photo"]
            ev.append(
                images._ev(
                    "photo",
                    f"{best.title or d.city.name} ({best.source or 'Google Images'})",
                    best.image_url,
                    None,
                    best.page_url,
                )
            )
        upd["evidence"] = ev
        return c.model_copy(update=upd)
