"""Notification-lane types (T5b). Mirrored by supabase/migrations/0003_notifications.sql."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import AfterValidator, BaseModel, Field

from tripai.models import Evidence, FitPoint, ScoreBreakdown
from tripai.scoring.types import RankedRecommendation

NotificationKind = Literal["new_top", "price_drop", "long_weekend", "target_price"]


def now_utc() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    """Naive datetimes from API clients are taken as UTC, so comparisons with now_utc() never
    raise (a naive snooze_until used to crash every scan for that user)."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


UTCDateTime = Annotated[datetime, AfterValidator(_aware)]


def new_id() -> str:
    return uuid4().hex


class NotificationPrefs(BaseModel):
    """Per-user control. In-app inbox is always on; push needs an explicit opt-in."""

    user_id: str
    push_opt_in: bool = False
    max_per_week: int = Field(3, ge=0, le=50)
    muted_cities: list[str] = Field(default_factory=list)  # city names or IATA codes
    snooze_until: UTCDateTime | None = None
    lang: Literal["en", "pl"] = "en"  # language of notification titles/bodies (scan-time)
    updated_at: UTCDateTime = Field(default_factory=now_utc)


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    """Browser `PushSubscription.toJSON()` plus the owner."""

    user_id: str
    endpoint: str
    keys: PushKeys
    created_at: UTCDateTime = Field(default_factory=now_utc)


class Notification(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    kind: NotificationKind
    title: str
    body: str  # every number in here comes from `recommendation` / `evidence`
    recommendation_id: str
    inputs_hash: str
    scoring_version: str
    why: str  # deterministic, evidence-only explanation (tripai.agents.explain.template_why)
    evidence: list[Evidence] = Field(default_factory=list)
    score: ScoreBreakdown
    fit_label: str | None = None
    fit_summary: str | None = None
    concerns: list[FitPoint] = Field(default_factory=list)
    recommendation: RankedRecommendation  # full card, so a tap can open /trips/{id} directly
    url: str
    dedupe_key: str
    scan_run_id: str | None = None
    created_at: UTCDateTime = Field(default_factory=now_utc)
    read_at: UTCDateTime | None = None
    pushed_at: UTCDateTime | None = None
    push_status: str | None = None  # "sent:2" | "inbox_only" | "not_opted_in" | "error:..."
    # Jev notification gate (tripai.agents.jev.jev_worth_interrupting): P(worth interrupting);
    # push only if interrupt_ok (p >= NOTIFY_MIN_P), otherwise the notification stays in the inbox
    interrupt_p: float | None = None
    interrupt_ok: bool | None = None
    interrupt_source: str | None = None  # "jev" | "rules" (Jev unavailable: fit label decides)


class SavedPick(BaseModel):
    """A trip the user watches for price drops. `baseline_pln` is the last real price we told them."""

    user_id: str
    recommendation_id: str
    city: str
    iata: str
    start: date
    end: date
    baseline_pln: float
    baseline_source: str
    baseline_fetched_at: UTCDateTime
    saved_at: UTCDateTime = Field(default_factory=now_utc)
    # T13 "My trips" (migration 0006): what it cost when saved (the baseline moves with every
    # price_drop alert; this one never does), the user's target price, and the latest scan check
    saved_pln: float | None = None  # None (rows from before 0006): baseline_pln
    saved_price_status: str = "exact"
    travelers: int = 1
    target_pln: float | None = Field(None, gt=0)
    last_pln: float | None = None
    last_price_status: str | None = None  # "exact" | "partial" | "estimate" (docs/BUDGET.md)
    last_checked_at: UTCDateTime | None = None

    @property
    def first_pln(self) -> float:
        return self.saved_pln if self.saved_pln is not None else self.baseline_pln


def watching(picks: list[SavedPick], today: date) -> list[SavedPick]:
    """Picks that still hold a watch slot: a trip that has ended has nothing left to buy, so it
    neither counts against TRIPAI_MAX_PICKS nor gets re-priced (T13 review #1)."""
    return [p for p in picks if p.end >= today]


class PlannedTrip(BaseModel):
    """A trip the user approved on the confirm page (supabase `trips`, columns from 0006).
    Nothing is booked: it is the user's plan, shown under "My trips" and rated after it ends."""

    user_id: str
    recommendation_id: str
    city: str
    country: str = ""
    iata: str
    start: date
    end: date
    total_pln: float  # per person all-in when approved (card == receipt == confirm)
    price_status: str = "exact"
    travelers: int = 1
    status: Literal["planned", "booked", "done", "cancelled"] = "planned"
    approved_at: UTCDateTime = Field(default_factory=now_utc)


class Decision(BaseModel):
    """One rule evaluation, kept on the scan run so 'why didn't I get a ping?' is answerable."""

    kind: NotificationKind
    recommendation_id: str | None = None
    notify: bool
    reason: str


class ScanRun(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    mode: Literal["dbos", "sync"] = "sync"
    trigger: Literal["manual", "scheduled"] = "manual"
    workflow_id: str | None = None
    today: date
    started_at: UTCDateTime = Field(default_factory=now_utc)
    finished_at: UTCDateTime | None = None
    personalized: bool = True
    windows: int = 0
    candidates: int = 0
    top_id: str | None = None
    top_city: str | None = None
    top_score: float | None = None
    inputs_hash: str | None = None
    prices: dict[str, float] = Field(default_factory=dict)  # rec id -> total PLN seen this run
    decisions: list[Decision] = Field(default_factory=list)
    notification_ids: list[str] = Field(default_factory=list)
    error: str | None = None


class ScanResult(BaseModel):
    run: ScanRun
    notifications: list[Notification]
