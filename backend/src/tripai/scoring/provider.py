"""Connector seam: the scorer only sees `Candidate`s produced by a `TripDataProvider`.

T2 plugs live connectors in by implementing `TripDataProvider`; until then `FixtureProvider`
serves ~10 EU cities from KRK out of hand-curated, clearly-labelled fixture numbers.
"""

import hashlib
import statistics
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Protocol

from pydantic import BaseModel, Field

from tripai.models import Evidence, FreeWindow, LuxuryLevel, TasteProfile, Weights
from tripai.scoring.types import Candidate, PeakQuote
from tripai.scoring.windows import BusyInterval, pl_holidays, work_calendar


class CityInfo(BaseModel):
    city: str
    country: str
    iata: str
    tags: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)


class TripDataProvider(Protocol):
    async def cities(self, origin: str) -> list[CityInfo]: ...

    async def candidates(
        self,
        origin: str,
        windows: Sequence[FreeWindow],
        luxury: LuxuryLevel,
        *,
        profile: TasteProfile | None = None,  # lets a provider spend its live-call budget on
        weights: Weights | None = None,  # the options this user is likely to see
        typical_spend_pln: float | None = None,  # the price reference those are ranked with
    ) -> list[Candidate]: ...


class CalendarProvider(Protocol):
    async def busy(self, start: date, end: date) -> list[BusyInterval]: ...


# ---------------------------------------------------------------- fixtures

# Hand-curated sample numbers (never fetched from any API). Evidence says so: source
# "fixture:sample" is shown as "TripAI sample data"; `fetched_at` is when the set was compiled.
SAMPLE_SOURCE = "fixture:sample"
FIXTURE_FETCHED_AT = datetime(2026, 10, 3, 8, 0, tzinfo=UTC)
LUXURY_HOTEL_MULT = {
    LuxuryLevel.budget: 0.55,
    LuxuryLevel.standard: 1.0,
    LuxuryLevel.comfort: 1.6,
    LuxuryLevel.luxury: 2.8,
}
# Month-of-year shapes (Jan..Dec).
_FLIGHT_SEASON = [0.7, 0.65, 0.8, 1.0, 1.0, 1.2, 1.5, 1.5, 1.0, 0.9, 0.7, 1.1]
_HOTEL_SEASON = [0.7, 0.7, 0.8, 0.95, 1.05, 1.25, 1.4, 1.45, 1.15, 0.95, 0.75, 0.9]
_CROWD_SEASON = [0.35, 0.35, 0.45, 0.6, 0.7, 0.85, 1.0, 1.0, 0.8, 0.6, 0.4, 0.45]


class _FixtureCity(BaseModel):
    info: CityInfo
    flight_base_pln: float  # return KRK-X, standard month
    hotel_night_pln: float  # standard double room, standard month
    crowd_scale: float  # peak crowd level 0..1
    temps_c: list[float]  # mean daily max per month


def _c(city, country, iata, tags, highlights, flight, hotel, crowd, temps) -> _FixtureCity:
    return _FixtureCity(
        info=CityInfo(city=city, country=country, iata=iata, tags=tags, highlights=highlights),
        flight_base_pln=flight,
        hotel_night_pln=hotel,
        crowd_scale=crowd,
        temps_c=temps,
    )


FIXTURE_CITIES: list[_FixtureCity] = [
    _c("Rome", "Italy", "FCO", ["history", "food", "art", "architecture", "city"],
       ["Colosseum", "Trastevere food walk", "Vatican Museums"], 380, 420, 0.95,
       [12, 14, 16, 19, 23, 28, 31, 31, 27, 22, 16, 13]),
    _c("Barcelona", "Spain", "BCN", ["beach", "nightlife", "architecture", "food", "city"],
       ["Sagrada Família", "Barceloneta beach", "El Born tapas"], 420, 450, 1.0,
       [14, 15, 17, 19, 22, 26, 29, 29, 26, 22, 17, 14]),
    _c("Lisbon", "Portugal", "LIS", ["food", "history", "viewpoints", "nightlife", "surf"],
       ["Alfama miradouros", "Time Out Market", "Belém"], 650, 380, 0.85,
       [15, 16, 18, 20, 22, 26, 28, 28, 27, 23, 18, 16]),
    _c("Athens", "Greece", "ATH", ["history", "food", "beach"],
       ["Acropolis", "Plaka tavernas", "Riviera beaches"], 560, 320, 0.8,
       [13, 14, 16, 20, 25, 30, 33, 33, 29, 24, 19, 15]),
    _c("Valletta", "Malta", "MLA", ["beach", "diving", "history", "sun"],
       ["Blue Lagoon", "Grand Harbour", "Mdina"], 480, 360, 0.7,
       [16, 16, 17, 20, 24, 28, 31, 31, 28, 25, 21, 17]),
    _c("Naples", "Italy", "NAP", ["food", "history", "pizza", "nature"],
       ["Pompeii", "Spaccanapoli pizza", "Vesuvius hike"], 360, 300, 0.7,
       [13, 14, 16, 19, 23, 28, 31, 31, 27, 23, 18, 14]),
    _c("Málaga", "Spain", "AGP", ["beach", "food", "art", "sun"],
       ["Picasso Museum", "Alcazaba", "Malagueta beach"], 540, 340, 0.75,
       [17, 18, 20, 22, 25, 29, 31, 31, 29, 24, 20, 17]),
    _c("Paris", "France", "CDG", ["art", "food", "museums", "architecture", "romance"],
       ["Louvre", "Montmartre", "Le Marais bistros"], 450, 560, 0.95,
       [7, 9, 13, 16, 20, 23, 26, 25, 21, 16, 11, 8]),
    _c("Copenhagen", "Denmark", "CPH", ["design", "food", "cycling", "city"],
       ["Nyhavn", "Tivoli", "Reffen street food"], 330, 600, 0.6,
       [3, 3, 6, 11, 16, 19, 22, 21, 18, 13, 8, 4]),
    _c("Edinburgh", "United Kingdom", "EDI", ["history", "hiking", "whisky", "festivals"],
       ["Arthur's Seat", "Royal Mile", "Old Town closes"], 400, 480, 0.65,
       [7, 8, 10, 12, 15, 18, 19, 19, 17, 13, 10, 7]),
]  # fmt: skip


def _jitter(*parts: object) -> float:
    """Deterministic ±10% day-of-departure noise (stands in for real fare variance)."""
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return 0.9 + 0.2 * (h[0] / 255)


def _month_weights(start: date, end: date) -> dict[int, int]:
    counts: dict[int, int] = {}
    for i in range((end - start).days + 1):
        m = (start + timedelta(days=i)).month
        counts[m] = counts.get(m, 0) + 1
    return counts


class FixtureProvider:
    """In-memory provider. Numbers are hand-curated approximations, labelled `fixture:sample`
    ("TripAI sample data") in evidence; nothing here was fetched or recorded from an API."""

    def __init__(self, cities: Sequence[_FixtureCity] = FIXTURE_CITIES):
        self._cities = list(cities)

    async def cities(self, origin: str = "KRK") -> list[CityInfo]:
        return [c.info for c in self._cities]

    def _quote(self, c: _FixtureCity, month: int, nights: int, luxury: LuxuryLevel, key: str):
        flight = c.flight_base_pln * _FLIGHT_SEASON[month - 1] * _jitter(c.info.iata, key)
        hotel = c.hotel_night_pln * _HOTEL_SEASON[month - 1] * LUXURY_HOTEL_MULT[luxury] * nights
        return round(flight), round(hotel)

    def _candidate(
        self, c: _FixtureCity, origin: str, w: FreeWindow, luxury: LuxuryLevel
    ) -> Candidate:
        nights = max(1, (w.end - w.start).days)
        months = _month_weights(w.start, w.end)
        month = max(months, key=lambda m: (months[m], -m))
        n_days = sum(months.values())
        flight, hotel = self._quote(c, month, nights, luxury, w.start.isoformat())
        temp = round(sum(c.temps_c[m - 1] * n for m, n in months.items()) / n_days, 1)
        crowd = round(
            sum(_CROWD_SEASON[m - 1] * n for m, n in months.items()) / n_days * c.crowd_scale, 2
        )
        yearly = [sum(self._quote(c, m, nights, luxury, "median")) for m in range(1, 13)]
        median = round(statistics.median(yearly))
        peak_m = max(range(1, 13), key=lambda m: (_CROWD_SEASON[m - 1], c.temps_c[m - 1]))
        pf, ph = self._quote(c, peak_m, nights, luxury, "peak")
        peak = PeakQuote(
            month=peak_m,
            flight_cost_pln=pf,
            hotel_cost_pln=ph,
            temp_c=c.temps_c[peak_m - 1],
            crowd=round(_CROWD_SEASON[peak_m - 1] * c.crowd_scale, 2),
        )
        dates = f"{w.start:%d.%m}-{w.end:%d.%m}"
        ev = [
            Evidence(kind="flight", label=f"Return {origin}-{c.info.iata} {dates}", value=flight,
                     unit="PLN", source=SAMPLE_SOURCE, fetched_at=FIXTURE_FETCHED_AT),
            Evidence(kind="hotel", label=f"Hotel {nights} nights in {c.info.city} ({luxury})",
                     value=hotel, unit="PLN", source=SAMPLE_SOURCE,
                     fetched_at=FIXTURE_FETCHED_AT),
            Evidence(kind="price_baseline", label="Seasonal median total for this trip",
                     value=median, unit="PLN", source=SAMPLE_SOURCE,
                     fetched_at=FIXTURE_FETCHED_AT),
            Evidence(kind="weather", label=f"Avg daily max in {c.info.city} {dates}", value=temp,
                     unit="°C", source=SAMPLE_SOURCE,
                     fetched_at=FIXTURE_FETCHED_AT),
            Evidence(kind="crowds", label="Tourist crowd index (1 = peak)", value=crowd,
                     unit="0-1", source=SAMPLE_SOURCE,
                     fetched_at=FIXTURE_FETCHED_AT),
            Evidence(kind="attraction", label="Top sights", value=", ".join(c.info.highlights),
                     source=SAMPLE_SOURCE, fetched_at=FIXTURE_FETCHED_AT),
        ]  # fmt: skip
        return Candidate(
            city=c.info.city,
            country=c.info.country,
            iata=c.info.iata,
            tags=c.info.tags,
            window=w,
            flight_cost_pln=flight,
            hotel_cost_pln=hotel,
            temp_c=temp,
            crowd=crowd,
            seasonal_median_cost_pln=median,
            peak=peak,
            highlights=c.info.highlights,
            evidence=ev,
        )

    async def candidates(
        self,
        origin: str,
        windows: Sequence[FreeWindow],
        luxury: LuxuryLevel = LuxuryLevel.standard,
        *,
        profile: TasteProfile | None = None,
        weights: Weights | None = None,
        typical_spend_pln: float | None = None,
    ) -> list[Candidate]:
        return [self._candidate(c, origin, w, luxury) for c in self._cities for w in windows]


class FixtureCalendar:
    """Demo calendar: a 9-17 office job, Mon-Fri, PL public holidays off."""

    async def busy(self, start: date, end: date) -> list[BusyInterval]:
        return work_calendar(start, end, pl_holidays(start, end))
