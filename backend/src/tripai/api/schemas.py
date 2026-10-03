from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from tripai.agents.interview import ChatMessage
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.scoring.feedback import FeedbackResult
from tripai.scoring.windows import BusyInterval


class InterviewRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    user_id: str = "demo"


class WindowsRequest(BaseModel):
    start: date = Field(alias="from")
    end: date = Field(alias="to")
    busy: list[BusyInterval] = Field(default_factory=list)
    min_days: int = 2

    model_config = {"populate_by_name": True}


class RecommendationsRequest(BaseModel):
    profile: TasteProfile
    windows: list[FreeWindow] | None = None  # None -> calendar free windows + long-weekend radar
    weights: Weights | None = None
    limit: int = 10
    explain_top: int = 3  # LLM explanations for the top N (template for the rest)
    today: date | None = None  # pin "now" for reproducible demos
    horizon_days: int = 120
    max_leave_days: int = 2


class FeedbackRequest(BaseModel):
    trip_id: str
    answers: dict[str, Any]  # {"crowds": 2, "food": 5, "loved": ["food"], "disliked": ["heat"]}
    user_id: str = "demo"
    profile: TasteProfile | None = None  # defaults to the stored profile for user_id
    weights: Weights | None = None


class FeedbackResponse(FeedbackResult):
    trip_id: str
