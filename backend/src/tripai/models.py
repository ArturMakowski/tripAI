"""Shared contract between backend lanes and the frontend (mirror in frontend/lib/types.ts)."""

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class LuxuryLevel(StrEnum):
    budget = "budget"
    standard = "standard"
    comfort = "comfort"
    luxury = "luxury"


class TasteProfile(BaseModel):
    user_id: str
    origin_airports: list[str] = Field(default_factory=lambda: ["KRK"])
    budget_pln: int | None = None  # total per person
    luxury: LuxuryLevel = LuxuryLevel.standard
    interests: dict[str, float] = Field(
        default_factory=dict
    )  # tag -> weight 0..1, e.g. {"food": 0.9}
    dislikes: list[str] = Field(default_factory=list)  # e.g. ["crowds", "heat"]
    preferred_temp_c: tuple[float, float] = (15.0, 26.0)
    trip_length_days: tuple[int, int] = (3, 7)
    # Travel DNA (docs/TRAVEL_DNA.md): raw swipe answers q1..q12 -> 1..5, plus derived traits
    traits: dict[str, float] = Field(default_factory=dict)
    daily_discovery: bool | None = None
    personalize: bool = True  # False: neutral weights, feedback never changes the profile
    # Party (docs/BUDGET.md "Party pricing"): flights x travellers, hotel per room
    adults: int = 1
    children: int = 0
    rooms: int | None = None  # None = ceil((adults + children) / 2)


class FreeWindow(BaseModel):
    start: date
    end: date
    source: str = "manual"  # "gcal" | "manual"


class Weights(BaseModel):
    """Slider: price <-> comfort <-> experience. Normalised by scoring."""

    price: float = 0.4
    weather: float = 0.2
    crowds: float = 0.15
    taste: float = 0.25


class Evidence(BaseModel):
    kind: str  # "flight" | "hotel" | "weather" | "crowds" | "holiday" | "attraction"
    label: str  # human readable, e.g. "Return KRK-FCO 14-19 Jan"
    value: float | str
    unit: str | None = None  # "PLN", "°C", "0-1"
    source: str  # "serpapi:google_flights", "travelpayouts", "open-meteo", "eurostat", ...
    fetched_at: datetime
    url: str | None = None


class ScoreBreakdown(BaseModel):
    price: float  # each 0..1, higher = better
    weather: float
    crowds: float
    taste: float
    total: float


class FlightLeg(BaseModel):
    airline: str  # e.g. "Ryanair"
    flight_number: str | None = None  # e.g. "FR 1234"
    from_iata: str
    to_iata: str
    depart_at: datetime | None = None  # local time at departure airport
    arrive_at: datetime | None = None
    duration_min: int | None = None


class FlightDetails(BaseModel):
    """The concrete itinerary behind flight_cost_pln (docs/TRIP_DETAILS.md)."""

    outbound: list[FlightLeg] = Field(default_factory=list)
    inbound: list[FlightLeg] = Field(default_factory=list)
    stops_outbound: int | None = None
    stops_inbound: int | None = None
    price_pln: float | None = None
    booking_url: str | None = None
    source: str  # e.g. "serpapi:google_flights", "travelpayouts" (airline code only)
    fetched_at: datetime


class TransferOption(BaseModel):
    mode: str  # "public_transport" | "taxi" | "drive" | "walk" | "train" | "bus"
    duration_min: int | None = None
    distance_km: float | None = None
    price_pln: float | None = None
    note: str | None = None  # e.g. "Metro line A, 1 change"
    source: str  # "serpapi:google_hotels" | "osrm" | "estimate:haversine"
    fetched_at: datetime


class GeoPoint(BaseModel):
    lat: float
    lon: float
    label: str | None = None


class HotelDetails(BaseModel):
    """The concrete stay behind hotel_cost_pln (docs/TRIP_DETAILS.md)."""

    name: str
    address: str | None = None
    location: GeoPoint | None = None
    rating: float | None = None  # e.g. 4.4
    reviews: int | None = None
    stars: int | None = None  # hotel class
    price_pln_total: float | None = None
    distance_to_center_km: float | None = None  # computed vs the city's centre point
    airport: GeoPoint | None = None
    city_center: GeoPoint | None = None
    transfers: list[TransferOption] = Field(default_factory=list)  # airport -> hotel
    booking_url: str | None = None
    photo_url: str | None = None
    source: str  # e.g. "serpapi:google_hotels"
    fetched_at: datetime


class FitPoint(BaseModel):
    text: str
    dna: list[str] = Field(default_factory=list)  # Travel DNA card ids, e.g. ["q6", "q11"]
    evidence: list[int] = Field(default_factory=list)  # indexes into Recommendation.evidence


class FitVerdict(BaseModel):
    """AI second opinion: is this offer good for this user's DNA? See docs/FIT_VERDICT.md."""

    label: str  # "great_fit" | "good_fit" | "mixed" | "poor_fit"
    confidence: float
    summary: str
    matches: list[FitPoint] = Field(default_factory=list)
    concerns: list[FitPoint] = Field(default_factory=list)
    model: str  # pydantic-ai model string, or "rules" for the deterministic fallback
    inputs_hash: str = ""
    created_at: datetime | None = None


class Recommendation(BaseModel):
    id: str
    city: str
    country: str
    iata: str
    window: FreeWindow
    # Money model (docs/BUDGET.md "Party pricing"); for one traveller total = flight + hotel:
    total_cost_pln: float  # == per_person_pln (kept for backward compatibility)
    flight_cost_pln: float  # per traveller (one return ticket)
    hotel_cost_pln: float  # TOTAL for the room(s) for the whole stay, not per person
    score: ScoreBreakdown
    evidence: list[Evidence]
    highlights: list[str] = Field(default_factory=list)  # matching attractions
    why: str = ""  # LLM-written, grounded only in evidence
    fit: FitVerdict | None = None
    travelers: int = 1  # adults + children
    party_total_pln: float | None = (
        None  # whole group: flight_cost_pln x travelers + hotel_cost_pln
    )
    per_person_pln: float | None = None  # party_total_pln / travelers (== total_cost_pln)
    price_status: str = "exact"  # "exact" (these dates) | "partial" | "estimate" (other dates / city avg; not ranked on)
    value_badge: str | None = None  # "great_value" | "worth_splurge" (docs/BUDGET.md)
    value_reason: str | None = None  # deterministic, numbers from evidence
    flight: FlightDetails | None = None  # which flight (docs/TRIP_DETAILS.md)
    hotel: HotelDetails | None = (
        None  # which hotel, where, transfers, distance to centre  # AI fit verdict vs Travel DNA (docs/FIT_VERDICT.md)
    )
