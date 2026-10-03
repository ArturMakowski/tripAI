from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

from tripai.agents.interview import ChatMessage
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.scoring.budget_fit import BudgetStatus
from tripai.scoring.feedback import Change
from tripai.scoring.reactions import Reaction
from tripai.scoring.types import RankedRecommendation
from tripai.scoring.windows import MAX_LEAVE_DAYS, BusyInterval


class InterviewRequest(BaseModel):
    lang: str | None = None  # "pl" | "en" (else Accept-Language, else en)
    messages: list[ChatMessage] = Field(default_factory=list)
    user_id: str = "demo"  # ignored: the server-issued session decides (tripai.api.session)


class WindowsRequest(BaseModel):
    start: date = Field(alias="from")
    end: date = Field(alias="to")
    busy: list[BusyInterval] = Field(default_factory=list)
    min_days: int = Field(2, ge=1, le=60)

    model_config = {"populate_by_name": True}


class RecommendationsRequest(BaseModel):
    lang: str | None = None  # "pl" | "en" (else Accept-Language, else en)
    profile: TasteProfile
    # None -> calendar free windows + long-weekend radar
    windows: list[FreeWindow] | None = Field(None, max_length=60)
    weights: Weights | None = None
    limit: int = Field(10, ge=1, le=50)
    explain_top: int = Field(3, ge=0, le=10)  # LLM explanations for the top N (template for rest)
    fit_top: int = Field(5, ge=0, le=10)  # AI fit verdict for the top N (docs/FIT_VERDICT.md)
    today: date | None = None  # pin "now" for reproducible demos
    horizon_days: int = Field(120, ge=1, le=400)
    max_leave_days: int = Field(2, ge=0, le=MAX_LEAVE_DAYS)


class FeedbackRequest(BaseModel):
    lang: str | None = None  # "pl" | "en" (else Accept-Language, else en)
    trip_id: str
    answers: dict[str, Any]  # {"crowds": 2, "food": 5, "loved": ["food"], "disliked": ["heat"]}
    user_id: str = "demo"  # ignored: the server-issued session decides (tripai.api.session)
    profile: TasteProfile | None = None  # defaults to the session user's stored profile
    weights: Weights | None = None


class FeedbackResponse(TasteProfile):
    """Spec (ARCHITECTURE.md): the updated TasteProfile, so its fields are top-level.
    Additive extras: the new weights, the human-readable diff, and `profile` nested for convenience."""

    trip_id: str
    weights: Weights
    diff: list[Change]
    note: str | None = None  # e.g. why nothing changed (personalize=False)
    profile: TasteProfile


Phase = Literal["fast", "full"]


class ApiRecommendation(RankedRecommendation):
    """What POST /recommendations returns: the ranked recommendation plus API-layer status.
    (Proposed for the shared contract; until then it lives here and in frontend types.)"""

    budget: BudgetStatus | None = None  # None when the profile has no budget_pln
    # issue #18: total - budget when positive, 0 within budget, None without a budget
    over_budget_pln: float | None = None
    phase: Phase = "full"  # "fast": cache/Travelpayouts/seed estimates; "full": final answer
    refined: bool = False  # flight/hotel verified with exact-date Google prices (SerpApi)


class ReactionRequest(BaseModel):
    """T6: a swipe on a recommendation card."""

    recommendation_id: str = Field(min_length=1, max_length=80)
    # like = "Chcę tam" (right), dislike = "Nie dla mnie" (left), love = "Super!" (up)
    reaction: Reaction
    user_id: str = "demo"  # ignored: the server-issued session decides (tripai.api.session)
    profile: TasteProfile | None = None  # defaults to the session user's stored profile
    weights: Weights | None = None


class ReactionResponse(BaseModel):
    recommendation_id: str
    reaction: Reaction | None  # None after an undo
    city: str
    profile: TasteProfile
    weights: Weights
    diff: list[Change]  # same shape as /feedback's diff
    note: str | None = None  # e.g. why nothing changed (personalize=False)
    hidden: bool  # this city+dates is now left out of /recommendations for you
    # interest tags this swipe moved, for the toast
    learned: list[str] = Field(default_factory=list)
