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
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

from tripai import i18n
from tripai.connectors import config
from tripai.connectors.base import SYNTHETIC_TAG, FixtureNotFound
from tripai.connectors.cache import Cache, DiskCache, LayeredCache, NullCache, SupabaseCache
from tripai.connectors.open_meteo import OpenMeteo, WeatherSummary
from tripai.connectors.osrm import Osrm
from tripai.connectors.serpapi import (
    ExploreDestination,
    ExploreResult,
    SerpApiExplore,
    SerpApiFlights,
    SerpApiHotels,
)
from tripai.connectors.serper import Serper
from tripai.connectors.travelpayouts import FlightCalendar, Travelpayouts
from tripai.live import details, sources
from tripai.live.budget import BudgetExhausted, SerpApiBudget, global_budget, request_cap
from tripai.models import (
    Evidence,
    FlightDetails,
    FreeWindow,
    HotelDetails,
    LuxuryLevel,
    TasteProfile,
    Weights,
)
from tripai.scoring import party
from tripai.scoring.engine import MONTHS, candidate_id, taste_score
from tripai.scoring.provider import LUXURY_HOTEL_MULT, CityInfo, FixtureProvider, TripDataProvider
from tripai.scoring.types import Candidate, PeakQuote
from tripai.seed import load

log = logging.getLogger(__name__)

DEFAULT_MAX_CITIES = 12
DEFAULT_EXACT_TOP = 10  # cards that get a free exact-date Travelpayouts fare (price honesty)
DEFAULT_TOP_N = 3  # exact-date SerpApi flights + hotels for this many cities...
DEFAULT_MAX_REFINE = 6  # ...re-checked until the top N are refined, at most this many in total
KIND_ORDER = {k: i for i, k in enumerate(
    ("flight", "hotel", "party", "price_baseline", "peak", "weather", "crowds", "holiday", "attraction",
     "photo", "confidence")
)}  # fmt: skip
TAG_MIN_WEIGHT = 0.5
BASELINE_PREFIX = "Typical trip cost for the deal comparison:"
NEAREST_FARE_DAYS = 3
# Parallel requests per source within one /recommendations call (per-city fetches all run
# concurrently; these only bound the fan-out per API).
# OSRM has its own small pool: a call sleeping in the 1 req/s throttle must not hold a
# Travelpayouts slot.
CONCURRENCY = {"travelpayouts": 8, "open_meteo": 16, "serpapi": 4, "serper": 4, "osrm": 2}
REFINE_WEATHER_TIMEOUT_S = 6.0  # exact-window weather; past it the month normals stay
OSRM_TIMEOUT_S = 5.0  # airport -> hotel drive; past it the card simply has no transfer row
MAX_HOTEL_KM = 75  # Google Hotels offers farther than this from the city centre are dropped
FAST_DEADLINE_S = 1.5  # phase=fast: cities whose cheap data isn't back by then are skipped

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


def _src(res: Any) -> str:
    """A connector result's source, tagged when it came from a hand-modelled fixture."""
    return res.source + (SYNTHETIC_TAG if getattr(res, "synthetic", False) else "")


def _flight_evidence(flights: Any, price: float) -> list[Evidence]:
    """Google Flights evidence whose headline number is the price actually used (the cheapest
    listed itinerary), not `price_insights.lowest_price` (Google doesn't promise they match)."""
    ev = flights.evidence()
    if flights.lowest_price is not None and flights.lowest_price != price:
        log.info(
            "google_flights lowest_price %s != cheapest itinerary %s", flights.lowest_price, price
        )
    head = next((i for i, e in enumerate(ev) if isinstance(e.value, (int, float))), None)
    if head is not None:
        ev[head] = ev[head].model_copy(
            update={"value": price, "label": ev[head].label.replace("lowest", "cheapest itinerary")}
        )
    return ev


def _party_evidence(
    flight_pp: float, room_total: float, profile: TasteProfile | None
) -> list[Evidence]:
    """How the per-person price is built for a group (docs/BUDGET.md "Party pricing")."""
    n, r = party.travelers(profile), party.rooms(profile)
    if n == 1 and r == 1:
        return []
    group = flight_pp * n + room_total * r
    label = i18n.t(
        "party.label",
        n=n,
        r=r,
        flight=i18n.fmt_pln(flight_pp),
        room=i18n.fmt_pln(room_total),
        group=i18n.fmt_pln(group),
        pp=i18n.fmt_pln(group / n),
    )
    return [
        Evidence(
            kind="party",
            label=label,
            value=round(group),
            unit="PLN",
            source="tripai:party",
            fetched_at=datetime.now(UTC),
        )
    ]


def _plain(name: str) -> str:
    """Search-friendly city name: "Valletta (Malta)" -> "Valletta"."""
    return name.split(" (")[0]


@dataclass
class _Quality:
    """Per-factor data quality (1 = live, exact dates) and a human-readable basis."""

    parts: dict[str, tuple[float, str]] = field(default_factory=dict)
    exact: dict[str, bool] = field(default_factory=dict)  # "flight"/"hotel" priced for these dates
    tried_exact: bool = False  # exact-date Travelpayouts lookup already done for this card

    def price_status(self) -> str:
        n = sum(self.exact.get(k, False) for k in ("flight", "hotel"))
        return ("estimate", "partial", "exact")[n]

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
    "osrm": "osrm",
    "serper": "serper",
    "travelpayouts": "travelpayouts",
}


SEED_CLIMATE_SOURCE = "seed:climate (open-meteo:archive ERA5)"


def _seed_climate(c: load.City, y: int, m: int) -> WeatherSummary | None:
    """Month normals from data/climate.json (Open-Meteo ERA5, fetched once by
    `tripai.seed.climate`), shaped like a live `climate_normals` result."""
    try:
        cc = load.climate(c.id)
    except Exception:  # noqa: BLE001 - no snapshot -> no fallback
        return None
    if cc is None or (mc := cc.months[m - 1]).temp_max_c is None:
        return None
    start, end = _month_bounds(y, m)
    return WeatherSummary(
        source=SEED_CLIMATE_SOURCE,
        fetched_at=load.meta("climate.json").fetched_at,
        latitude=c.lat,
        longitude=c.lon,
        place=c.name,
        start=start,
        end=end,
        mode="climate_normal",
        years=cc.years,
        days=[],
        avg_temp_max_c=mc.temp_max_c,
        avg_temp_min_c=mc.temp_min_c,
        avg_precipitation_mm=mc.precipitation_mm,
        rainy_day_share=mc.rainy_day_share,
        avg_sunshine_h=mc.sunshine_h,
    )


class _Session:
    """Connectors sharing one HTTP client, a concurrency limit and per-request memoisation."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        cache: Cache | None,
        fixtures: bool | None,
        today: date | None,
        budget: SerpApiBudget | None = None,
        fast: bool = False,
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
        self.fast = fast  # cache-only SerpApi, no fixture stand-ins
        self.profile: TasteProfile | None = None  # party size for per-person hotel shares
        self.deadline: float | None = None  # monotonic; set by the provider in the fast phase
        self.late_calls = 0
        self.request_cap = 0 if fast else request_cap()
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
        self.osrm = Osrm(**fx("osrm"))
        self.today = today
        self._sems = {src: asyncio.Semaphore(n) for src, n in CONCURRENCY.items()}
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

    def label_details(self, c: Candidate) -> Candidate:
        """Same fixture tagging as evidence, for the flight/hotel details and transfers."""
        upd: dict[str, Any] = {}
        if c.flight is not None:
            upd["flight"] = c.flight.model_copy(update={"source": self._tag(c.flight.source)})
        if c.hotel is not None:
            transfers = [
                t.model_copy(update={"source": self._tag(t.source)}) for t in c.hotel.transfers
            ]
            upd["hotel"] = c.hotel.model_copy(
                update={"source": self._tag(c.hotel.source), "transfers": transfers}
            )
        return c.model_copy(update=upd) if upd else c

    def _tag(self, source: str) -> str:
        src = sources.source_of_evidence(source)
        if src is None or self.live(src) or "fixture]" in source:
            return source
        return source + sources.RECORDED_TAG

    @staticmethod
    def _source(what: str) -> str:
        return _CALL_SOURCE.get(what.split()[0], what.split()[0])

    def _sem(self, what: str) -> asyncio.Semaphore:
        return self._sems.get(self._source(what)) or self._sems["travelpayouts"]

    def _uncovered(self, what: str) -> None:
        """A fixture-mode source with no recording for this request: the data is simply not
        available (expected: fixtures cover 14-19 Jan 2027 for 10 routes), not a failure."""
        src = self._source(what)
        self.uncovered[src] = self.uncovered.get(src, 0) + 1

    async def call(
        self, what: str, fn: Callable[[], Awaitable[Any]], timeout: float | None = None
    ) -> Any | None:
        """Run one connector call; any failure is logged and becomes None (never raises).
        Calls past `timeout`, or still running at the fast-phase deadline, are abandoned
        (counted in `late_calls`)."""
        async with self._sem(what):
            try:
                if self.deadline is not None:
                    left = self.deadline - time.monotonic()
                    if left <= 0:
                        raise TimeoutError
                    timeout = left if timeout is None else min(timeout, left)
                if timeout is not None:
                    return await asyncio.wait_for(fn(), timeout)
                return await fn()
            except TimeoutError:
                self.late_calls += 1
                return None
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
        async with self._sem("explore"):
            try:
                return await fn(self.serp[kind])
            except BudgetExhausted:
                if self.fast:
                    return None  # fast phase: cache hits only, by design
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

    supports_fast = True  # POST /recommendations?phase=fast passes fast=True

    def __init__(
        self,
        *,
        max_cities: int | None = None,
        top_n: int | None = None,
        max_refine: int | None = None,
        exact_top: int | None = None,
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
        self.fast_deadline = float(config.env("TRIPAI_FAST_DEADLINE_S") or FAST_DEADLINE_S)
        self.exact_top = (
            exact_top
            if exact_top is not None
            else _env_int("TRIPAI_LIVE_EXACT_TOP", DEFAULT_EXACT_TOP)
        )

    def _refine_targets(
        self,
        cands: list[Candidate],
        profile: TasteProfile,
        weights: Weights | None,
        typical_spend_pln: float | None = None,
    ) -> list[str]:
        """Exact-date checks go to what the user will see first: the top N under the same
        hard-budget policy and price reference (typical spend) the API applies."""
        return self._targets(cands, profile, weights, self.top_n, typical_spend_pln)

    @staticmethod
    def _targets(
        cands: list[Candidate],
        profile: TasteProfile,
        weights: Weights | None,
        n: int,
        typical_spend_pln: float | None = None,
    ) -> list[str]:
        """Which cards to verify next. Status-blind on purpose: every card is ranked on its
        current (possibly other-dates) price as if it were known, so verifying a card can't lift
        it over unverified ones - a refined trip whose exact price came back high drops out and
        the next candidate gets checked. (Display ranking stays exact-first: budget_fit.)"""
        from tripai.scoring.budget_fit import rank_within_budget

        blind = [c.model_copy(update={"price_status": "exact"}) for c in cands]
        ranked = rank_within_budget(
            blind, profile, weights, limit=n, typical_spend_pln=typical_spend_pln
        )
        return [r.id for r, _ in ranked]

    async def _drive_transfer(self, s: "_Session", h: HotelDetails) -> HotelDetails:
        """No Google travel times for this property: driving time airport -> hotel via OSRM
        (cached forever per pair, throttled), labelled as an estimate. Never public transport."""
        if h.airport is None or h.location is None:
            return h
        a, b = h.airport, h.location
        route = await s.call(
            f"osrm {a.lat:.3f},{a.lon:.3f}->{b.lat:.3f},{b.lon:.3f}",
            lambda: s.osrm.drive(a.lat, a.lon, b.lat, b.lon),
            timeout=OSRM_TIMEOUT_S,
        )
        if route is None:
            return h
        t = details.drive_transfer(route.duration_min, route.distance_km, route.fetched_at)
        return h.model_copy(update={"transfers": [t.model_copy(update={"source": _src(route)})]})

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
        fast: bool = False,
        typical_spend_pln: float | None = None,
    ) -> list[Candidate]:
        """`fast=True` (POST /recommendations?phase=fast): cached SerpApi only, no exact-date
        refinement, and a FAST_DEADLINE_S budget for the per-city fetches."""
        try:
            out = await self._live(
                origin, list(windows), luxury, profile, weights, fast, typical_spend_pln
            )
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
        fast: bool = False,
        typical_spend_pln: float | None = None,
    ) -> list[Candidate]:
        if not windows:
            return []
        started = time.monotonic()
        origin = origin.upper()
        profile = profile or TasteProfile(user_id="_live")
        cities = self._shortlist(origin, profile)
        nights = [max(1, (w.end - w.start).days) for w in windows]
        trip_days = (min(nights), min(max(nights), 30))
        async with httpx.AsyncClient(timeout=30) as client:
            s = _Session(client, self.cache, self.fixtures, self.today, self.budget, fast=fast)
            if fast:
                s.deadline = started + self.fast_deadline
            explore = await s.serpapi("explore", "explore", lambda c: c.explore(origin))
            tasks = [
                asyncio.ensure_future(
                    self._city_data(s, origin, c, windows, trip_days, explore, profile)
                )
                for c in cities
            ]
            # safety net; in the fast phase every call already stops at s.deadline
            timeout = (
                max(0.0, self.fast_deadline + 0.25 - (time.monotonic() - started)) if fast else None
            )
            _, pending = await asyncio.wait(tasks, timeout=timeout)
            for t in pending:  # phase=fast: too slow (cold cache) -> left to phase=full
                t.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            data: list[_CityData] = []
            late: list[str] = []
            for c, t in zip(cities, tasks):
                if t.cancelled():
                    late.append(c.id)
                    continue
                d = t.exception() or t.result()
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
                        built = self._candidate(d, origin, w, luxury, profile)
                    except Exception as exc:  # noqa: BLE001 - drop this option only
                        log.warning("live provider: %s %s dropped: %r", d.city.id, w.start, exc)
                        s.failures.append(f"candidate {d.city.id} {w.start}: {type(exc).__name__}")
                        continue
                    if built is not None:
                        cands.append(built[0])
                        quality[candidate_id(built[0])] = built[1]
            by_city = {d.city.iata: d for d in data}
            s.profile = profile
            # Price honesty: give the cards users see first an exact-date fare (free Travelpayouts
            # prices_for_dates) before anything is shown as this trip's price.
            cands = await self._exact_flights(
                s, origin, cands, quality, profile, weights, typical_spend_pln
            )
            refined: set[str] = set()
            # Exact-date prices usually differ from the cached estimates, so re-rank after each
            # round until the top N are all refined or the refinement budget is spent.
            while cands and not fast and len(refined) < self.max_refine:
                top = self._refine_targets(cands, profile, weights, typical_spend_pln)
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
                c = s.label_details(c)
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
                "phase": "fast" if fast else "full",
                "late": late,
                "late_calls": s.late_calls,
                "seconds": round(time.monotonic() - started, 2),
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
        peak = None if s.fast else self._peak_month(c, s.today)  # fast: no peak counterfactual
        if peak is not None and peak not in dep_months:
            dep_months.append(peak)

        async def calendar(y: int, m: int) -> FlightCalendar | None:
            return await s.call(
                f"travelpayouts {origin}-{c.iata} {y}-{m:02d}",
                lambda: s.tp.month_calendar(origin, c.iata, f"{y}-{m:02d}", trip_days=trip_days),
            )

        async def climate(y: int, m: int) -> WeatherSummary | None:
            # Month normals come from the committed ERA5 snapshot (same Open-Meteo archive, no
            # network): the cheap pass used to cost ~170 archive calls per cold request. Live
            # Open-Meteo stays for cities missing from the snapshot and for the exact-window
            # weather of refined cards.
            if (snap := _seed_climate(c, y, m)) is not None or s.fast:
                return snap
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
    ) -> tuple[float, Evidence, float, str, FlightDetails | None, bool] | None:
        """(price, evidence, quality, basis, itinerary, exact). The itinerary is the one behind
        that exact price (None for a month median); `exact` only for a fare that departs on the
        window's first day and returns on its last (docs/BUDGET.md "Price honesty")."""
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
                det = details.flight_from_fare(fare, origin, _src(cal), cal.fetched_at)
                exact = (
                    fare.departure_at.date() == w.start
                    and fare.return_at is not None
                    and fare.return_at.date() == w.end
                )
                return fare.price, ev, q, "Aviasales cached fare", det, exact
            med = round(statistics.median(f.price for f in cal.fares))
            label = (
                f"Typical return {origin}-{d.city.iata} in {MONTHS[w.start.month - 1]} "
                f"(median of {len(cal.fares)} Aviasales cached fares, not your exact dates)"
            )
            ev = cal._ev("flight", label, med, cal.currency)
            return med, ev, 0.45, "month median fare", None, False
        e = d.explore
        if e is not None and e.flight_price is not None and d.explore_res is not None:
            dates = f" {_span(e.start_date, e.end_date)}" if e.start_date and e.end_date else ""
            label = (
                f"Cheapest return {origin}-{e.iata}{dates} on Google Travel Explore "
                "(not your exact dates)"
            )
            ev = d.explore_res._ev("flight", label, e.flight_price, d.explore_res.currency, e.link)
            res = d.explore_res
            det = details.flight_from_explore(e, origin, _src(res), res.fetched_at)
            return e.flight_price, ev, 0.35, "Google Travel Explore", det, False
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
                f"Hotel {nights} nights in {d.city.name}, price for 1 room: "
                f"{e.hotel_price:.0f} PLN/night "
                f"(Google Travel Explore, not your exact dates) x{mult} for {luxury.value}"
            )
            return total, d.explore_res._ev("hotel", label, total, "PLN"), 0.5, "Explore nightly"
        nightly = NIGHTLY_ESTIMATE_PLN.get(d.city.country, DEFAULT_NIGHTLY_PLN)
        total = round(nightly * mult * nights)
        ev = Evidence(
            kind="hotel",
            label=(
                f"Hotel {nights} nights in {d.city.name}, price for 1 room: rough estimate "
                f"{nightly} PLN/night "
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
        # the level we show in the evidence (share of peak nights where known) is what we score
        crowd = round(
            sum(load.crowd_level(d.city.id, m) * k for (_, m), k in months.items()) / n, 2
        )
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
            crowd.model_copy(
                update={"kind": "peak", "label": i18n.t("crowd.peak_month") + crowd.label}
            ),
        ]
        quote = PeakQuote(
            month=ym[1],
            flight_cost_pln=fare,
            hotel_cost_pln=hotel,
            temp_c=clim.avg_temp_max_c,
            crowd=crowd.value,  # == load.crowd_level: the same scale as the candidate's crowd
        )
        return quote, ev

    def _candidate(
        self,
        d: _CityData,
        origin: str,
        w: FreeWindow,
        luxury: LuxuryLevel,
        profile: TasteProfile | None = None,
    ) -> tuple[Candidate, _Quality] | None:
        flight = self._flight(d, origin, w)
        weather = self._weather(d, w)
        if flight is None or weather is None:
            return None  # can't score without a price and a temperature
        q = _Quality()
        f_cost, f_ev, f_q, f_basis, f_details, f_exact = flight
        h_room, h_ev, h_q, h_basis = self._hotel(d, w, luxury)  # per room, never exact here
        h_cost = party.hotel_share(h_room, profile)  # this person's share of the rooms
        temp, w_ev, w_q, w_basis = weather
        crowd, c_ev, c_q, c_basis = self._crowds(d, w)
        q.set("flight", f_q, f_basis)
        q.set("hotel", h_q, h_basis)
        q.set("weather", w_q, w_basis)
        q.set("crowds", c_q, c_basis)
        q.exact = {"flight": f_exact, "hotel": False}
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
            evidence=[*evidence, *_party_evidence(f_cost, h_room, profile)],
            flight=f_details,
            price_status=q.price_status(),
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
                # with the country: "Naples hotels" alone returns Naples, Florida
                lambda h: h.search(
                    f"{_plain(d.city.name)}, {d.city.country_name}", w.start, w.end, iata=c.iata
                ),
            )
        )
        jobs.append(
            s.call(
                f"open-meteo window {d.city.id} {w.start}",
                lambda: s.meteo.weather(
                    d.city.lat, d.city.lon, w.start, w.end, place=d.city.name, today=s.today
                ),
                timeout=REFINE_WEATHER_TIMEOUT_S,  # a throttled Open-Meteo must not stall /full
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
        flight_details = c.flight
        cheapest = next((o for o in (flights.options if flights else []) if o.price), None)
        if flights is not None and (cheapest is not None or flights.lowest_price is not None):
            # the itinerary shown is the one priced: Google's cheapest listed option
            if cheapest is not None:
                flight_cost = cheapest.price
                flight_details = details.flight_from_option(
                    cheapest, _src(flights), flights.fetched_at, flights.url
                )
            else:
                flight_cost, flight_details = flights.lowest_price, None
            ev = [e for e in ev if e.kind != "flight"]
            ev[:0] = _flight_evidence(flights, flight_cost)
            q.set("flight", 1.0, "Google Flights, exact dates")
            q.exact["flight"] = True
            if flights.typical_price_range:
                flight_base = sum(flights.typical_price_range) / 2
        elif not q.exact.get("flight") and not q.tried_exact:
            # SerpApi capped/failed: exact-date Travelpayouts next (unless the free pass already
            # asked for exactly these dates and got nothing)
            got = await self._exact_flight(s, origin, c)
            if got is not None:
                flight_cost, f_ev, flight_details = got  # shown = priced
                ev = [e for e in ev if e.kind != "flight"]
                ev.insert(0, f_ev)
                q.set("flight", 0.85, "Aviasales fare, exact dates")
                q.exact["flight"] = True
        upd["flight_cost_pln"] = flight_cost
        upd["flight"] = flight_details

        hotel_cost = c.hotel_cost_pln
        hotel_details = None
        pct = LUXURY_QUANTILE[luxury]
        if hotels is not None:  # only offers in this city (wrong-city results do happen)
            near = [
                o
                for o in hotels.offers
                if o.lat is None
                or details.haversine_km(o.lat, o.lon, d.city.lat, d.city.lon) <= MAX_HOTEL_KM
            ]
            hotels = hotels.model_copy(update={"offers": near})
        picked = details.pick_offer(hotels.offers, pct) if hotels else None
        if picked is not None:
            offer, n_priced = picked
            hotel_room = details.stay_cost(offer, nights)  # this property is what is shown
            hotel_cost = party.hotel_share(hotel_room, s.profile)  # per-person share of rooms
            q.exact["hotel"] = True
            ev = [e for e in ev if e.kind != "hotel"]
            mine = hotels._ev(
                "hotel",
                f"{offer.name}: {nights} nights in {d.city.name} {_span(w.start, w.end)}, "
                f"price for 1 room, {offer.price_per_night:.0f} PLN/night (the property at the "
                f"{round(pct * 100)}th percentile of {n_priced} Google Hotels offers, "
                f"{luxury.value})",
                round(hotel_room),  # the property's price for the stay (one room)
                hotels.currency,
                offer.link,
            )
            ev[1:1] = [mine, *hotels.evidence()]
            q.set("hotel", 1.0, "Google Hotels, exact dates")
            # the airport the *priced* flight lands at, never the city's main code by default:
            # Google's itinerary (with Google's own airport name), else the Travelpayouts /
            # Explore itinerary's landing airport, else unknown -> no airport pin, no OSRM
            arrival_iata, arrival_name = None, None
            if flight_details is not None and flight_details.outbound:
                arrival_iata = flight_details.outbound[-1].to_iata
                if flight_details.source.startswith("serpapi:google_flights") and cheapest:
                    arrival_name = cheapest.legs[-1].to_name
            hotel_details = details.hotel_details(  # group price: this property x rooms
                offer, hotel_room * party.rooms(s.profile), d.city, arrival_iata, arrival_name,
                _src(hotels), hotels.fetched_at,
            )  # fmt: skip
            if not hotel_details.transfers:
                hotel_details = await self._drive_transfer(s, hotel_details)
        upd["hotel_cost_pln"] = hotel_cost
        upd["hotel"] = hotel_details

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
        upd["price_status"] = q.price_status()
        room_total = hotel_cost * party.travelers(s.profile) / party.rooms(s.profile)
        ev = [e for e in ev if e.kind != "party"] + _party_evidence(
            flight_cost, room_total, s.profile
        )

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

    # ------------------------------------------------------------------ exact-date fares

    async def _exact_flight(self, s: "_Session", origin: str, c: Candidate):
        """Cheapest Aviasales cached fare for exactly these dates (Travelpayouts prices_for_dates
        with departure_at/return_at), or None. Free; cached 6 h."""
        w = c.window
        res = await s.call(
            f"travelpayouts exact {origin}-{c.iata} {w.start}",
            lambda: s.tp.prices_for_dates(origin, c.iata, w.start, w.end),
        )
        fares = [
            f
            for f in (res.fares if res is not None else [])
            if f.departure_at.date() == w.start and f.return_at and f.return_at.date() == w.end
        ]
        if not fares:
            return None
        f = min(fares, key=lambda f: f.price)
        stops = "direct" if not f.transfers else f"{f.transfers} stop(s)"
        label = (
            f"Return {origin}-{c.iata} {_span(w.start, w.end)} (your dates), "
            f"{f.airline or '?'} {stops}, cheapest of {len(fares)} Aviasales cached fares "
            "(not bookable)"
        )
        det = details.flight_from_fare(f, origin, _src(res), res.fetched_at)
        return f.price, res._ev("flight", label, f.price, res.currency, f.link), det

    async def _exact_flights(
        self,
        s: "_Session",
        origin: str,
        cands: list[Candidate],
        quality: dict[str, "_Quality"],
        profile: TasteProfile,
        weights: Weights | None,
        typical_spend_pln: float | None = None,
    ) -> list[Candidate]:
        """Exact-date fares for the top EXACT_TOP cards whose flight is from other dates."""
        top = self._targets(cands, profile, weights, self.exact_top, typical_spend_pln)
        todo = [
            c
            for c in cands
            if candidate_id(c) in top and not quality[candidate_id(c)].exact.get("flight")
        ]
        got = await asyncio.gather(*(self._exact_flight(s, origin, c) for c in todo))
        for c in todo:
            quality[candidate_id(c)].tried_exact = True
        swap: dict[str, Candidate] = {}
        for c, hit in zip(todo, got):
            if hit is None:
                continue
            q = quality[candidate_id(c)]
            q.set("flight", 0.85, "Aviasales fare, exact dates")
            q.exact["flight"] = True
            price, f_ev, f_det = hit
            room = c.hotel_cost_pln * party.travelers(profile) / party.rooms(profile)
            ev = [f_ev, *(e for e in c.evidence if e.kind not in ("flight", "party"))]
            swap[candidate_id(c)] = c.model_copy(
                update={
                    "flight_cost_pln": price,
                    "flight": f_det,  # the itinerary behind the exact-date price
                    "evidence": [*ev, *_party_evidence(price, room, profile)],
                    "price_status": q.price_status(),
                }
            )
        return [swap.get(candidate_id(c), c) for c in cands]
