"""Scoring-lane types. Extensions of the shared contract live here until promoted to models.py."""

from typing import Literal

from pydantic import BaseModel, Field

from tripai.models import Evidence, FlightDetails, FreeWindow, HotelDetails, Recommendation


class PeakQuote(BaseModel):
    """The same trip (same city, same length) priced in the city's peak-crowd month."""

    month: int  # 1..12
    flight_cost_pln: float
    hotel_cost_pln: float
    temp_c: float
    crowd: float  # 0..1
    # peak-month rain/sun if the provider knows them; None -> peak is scored on temperature only
    # (never with the off-season window's rain/sun, which would skew the comparison)
    rainy_day_share: float | None = None
    sunshine_h: float | None = None


class Candidate(BaseModel):
    """One (city, window) option with every number the scorer needs. Filled by a TripDataProvider."""

    city: str
    country: str
    iata: str
    tags: list[str] = Field(default_factory=list)
    window: FreeWindow
    flight_cost_pln: float  # per traveller
    hotel_cost_pln: float  # TOTAL for the room(s) for the stay (tripai.scoring.party)
    travelers: int = 1  # adults + children; the scorer compares per-person totals
    temp_c: float
    crowd: float  # 0..1, 1 = peak crowds
    rainy_day_share: float | None = None  # 0..1 share of days with >= 1 mm (Open-Meteo), if known
    sunshine_h: float | None = None  # avg daily sunshine hours, if known
    seasonal_median_cost_pln: float  # median per-person total of this trip across the year
    peak: PeakQuote | None = None
    highlights: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    # the concrete itinerary / property behind flight_cost_pln / hotel_cost_pln (if known)
    flight: FlightDetails | None = None
    hotel: HotelDetails | None = None
    # docs/BUDGET.md "Price honesty": "exact" = both legs priced for these dates; "partial" = one
    # leg; "estimate" = other dates / city average. Only exact prices feed the price factor.
    price_status: Literal["exact", "partial", "estimate"] = "exact"

    @property
    def party_total_pln(self) -> float:
        """Flights for every traveller + the rooms."""
        return self.flight_cost_pln * self.travelers + self.hotel_cost_pln

    @property
    def total_cost_pln(self) -> float:
        """Per person (what budgets and the price factor compare): party total / travellers."""
        return self.party_total_pln / max(1, self.travelers)

    @property
    def nights(self) -> int:
        return max(1, (self.window.end - self.window.start).days)


class Counterfactual(BaseModel):
    kind: Literal["peak_season", "next_window", "runner_up"]
    label: str
    city: str
    window: FreeWindow | None = None
    total_cost_pln: float
    cost_delta_pln: float  # other - this; positive = this trip is cheaper
    cost_delta_pct: float  # cost_delta_pln / other cost * 100
    score_total: float
    score_delta: float  # this - other; positive = this trip scores higher
    crowd: float | None = None
    temp_c: float | None = None
    text: str


class FlipHint(BaseModel):
    """Smallest single change that would swap this recommendation with its neighbour in the ranking."""

    rival_id: str
    rival_city: str
    factor: str | None = None  # weight that would need to change
    weight_from: float | None = None
    weight_to: float | None = None
    # alternatively: the higher-ranked trip of the pair (this one at rank 1, otherwise the rival
    # above) getting this much pricier
    price_increase_pln: float | None = None
    text: str


class InterestFilter(BaseModel):
    """Receipt for the personalize=False interest filter (so nothing is hidden silently)."""

    liked: list[str]  # interests >= 0.5 used as the filter
    dropped_cities: list[str]
    applied: bool  # False when nothing matched (fallback: no filtering) or nothing to drop
    text: str


class RankedRecommendation(Recommendation):
    """Recommendation + the 'why this, why now' receipt (counterfactuals, flip, reproducibility hash)."""

    rank: int
    counterfactuals: list[Counterfactual] = Field(default_factory=list)
    flip: FlipHint | None = None
    inputs_hash: str
    interest_filter: InterestFilter | None = None  # set only when personalize=False
    scoring_version: str
    tags: list[str] = Field(default_factory=list)
    temp_c: float | None = None
    crowd: float | None = None
