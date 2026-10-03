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
    interests: dict[str, float] = Field(default_factory=dict)  # tag -> weight 0..1, e.g. {"food": 0.9}
    dislikes: list[str] = Field(default_factory=list)  # e.g. ["crowds", "heat"]
    preferred_temp_c: tuple[float, float] = (15.0, 26.0)
    trip_length_days: tuple[int, int] = (3, 7)
    # Travel DNA (docs/TRAVEL_DNA.md): raw swipe answers q1..q12 -> 1..5, plus derived traits
    traits: dict[str, float] = Field(default_factory=dict)
    daily_discovery: bool | None = None
    personalize: bool = True  # False: neutral weights, feedback never changes the profile


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


class Recommendation(BaseModel):
    id: str
    city: str
    country: str
    iata: str
    window: FreeWindow
    total_cost_pln: float
    flight_cost_pln: float
    hotel_cost_pln: float
    score: ScoreBreakdown
    evidence: list[Evidence]
    highlights: list[str] = Field(default_factory=list)  # matching attractions
    why: str = ""  # LLM-written, grounded only in evidence
