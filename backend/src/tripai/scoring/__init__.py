"""Deterministic scoring: the LLM never produces prices or scores, this package does."""

from tripai.scoring.engine import SCORING_VERSION, normalise_weights, rank, score_candidate
from tripai.scoring.feedback import FeedbackResult, apply_feedback
from tripai.scoring.provider import (
    CalendarProvider,
    CityInfo,
    FixtureCalendar,
    FixtureProvider,
    TripDataProvider,
)
from tripai.scoring.types import Candidate, Counterfactual, FlipHint, RankedRecommendation
from tripai.scoring.windows import (
    BridgeWindow,
    BusyInterval,
    free_windows,
    long_weekends,
    pl_holidays,
    trip_windows,
)

__all__ = [
    "SCORING_VERSION",
    "BridgeWindow",
    "BusyInterval",
    "CalendarProvider",
    "Candidate",
    "CityInfo",
    "Counterfactual",
    "FeedbackResult",
    "FixtureCalendar",
    "FixtureProvider",
    "FlipHint",
    "RankedRecommendation",
    "TripDataProvider",
    "apply_feedback",
    "free_windows",
    "long_weekends",
    "normalise_weights",
    "pl_holidays",
    "rank",
    "score_candidate",
    "trip_windows",
]
