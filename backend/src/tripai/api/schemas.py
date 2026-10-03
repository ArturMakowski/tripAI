from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from tripai.agents.interview import ChatMessage
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.scoring.feedback import Change
from tripai.scoring.windows import MAX_LEAVE_DAYS, BusyInterval


class InterviewRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    user_id: str = "demo"


class WindowsRequest(BaseModel):
    start: date = Field(alias="from")
    end: date = Field(alias="to")
    busy: list[BusyInterval] = Field(default_factory=list)
    min_days: int = Field(2, ge=1, le=60)

    model_config = {"populate_by_name": True}


class RecommendationsRequest(BaseModel):
    profile: TasteProfile
    # None -> calendar free windows + long-weekend radar
    windows: list[FreeWindow] | None = Field(None, max_length=60)
    weights: Weights | None = None
    limit: int = Field(10, ge=1, le=50)
    explain_top: int = Field(3, ge=0, le=10)  # LLM explanations for the top N (template for rest)
    today: date | None = None  # pin "now" for reproducible demos
    horizon_days: int = Field(120, ge=1, le=400)
    max_leave_days: int = Field(2, ge=0, le=MAX_LEAVE_DAYS)


class FeedbackRequest(BaseModel):
    trip_id: str
    answers: dict[str, Any]  # {"crowds": 2, "food": 5, "loved": ["food"], "disliked": ["heat"]}
    user_id: str = "demo"
    profile: TasteProfile | None = None  # defaults to the stored profile for user_id
    weights: Weights | None = None


class FeedbackResponse(TasteProfile):
    """Spec (ARCHITECTURE.md): the updated TasteProfile, so its fields are top-level.
    Additive extras: the new weights, the human-readable diff, and `profile` nested for convenience."""

    trip_id: str
    weights: Weights
    diff: list[Change]
    profile: TasteProfile
