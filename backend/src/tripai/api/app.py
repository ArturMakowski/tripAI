"""FastAPI app, API v0 (see docs/ARCHITECTURE.md)."""

import asyncio
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from tripai.agents.explain import explain, template_why
from tripai.agents.interview import InterviewResult, interview
from tripai.agents.llm import llm_enabled, model_name
from tripai.api.schemas import (
    FeedbackRequest,
    FeedbackResponse,
    InterviewRequest,
    RecommendationsRequest,
    WindowsRequest,
)
from tripai.api.state import MemoryStore, Store
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.scoring import (
    SCORING_VERSION,
    BridgeWindow,
    CalendarProvider,
    CityInfo,
    FixtureCalendar,
    FixtureProvider,
    RankedRecommendation,
    TripDataProvider,
    apply_feedback,
    free_windows,
    long_weekends,
    rank,
    trip_windows,
)
from tripai.scoring.windows import MAX_LEAVE_DAYS, TZ


def _merge_windows(windows: list[FreeWindow]) -> list[FreeWindow]:
    seen: dict[tuple[date, date], FreeWindow] = {}
    for w in windows:
        seen.setdefault((w.start, w.end), w)
    return sorted(seen.values(), key=lambda w: (w.start, w.end))


def create_app(
    provider: TripDataProvider | None = None,
    calendar: CalendarProvider | None = None,
    store: Store | None = None,
) -> FastAPI:
    provider = provider or FixtureProvider()
    calendar = calendar or FixtureCalendar()
    store = store or MemoryStore()

    app = FastAPI(title="TripAI", version="0.1.0")
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    app.state.provider, app.state.calendar, app.state.store = provider, calendar, store

    @app.get("/health")
    async def health() -> dict:
        return {
            "ok": True,
            "provider": type(provider).__name__,
            "calendar": type(calendar).__name__,
            "llm": model_name() if llm_enabled() else None,
            "scoring_version": SCORING_VERSION,
        }

    @app.get("/cities")
    async def cities(origin: str = "KRK") -> list[CityInfo]:
        return await provider.cities(origin)

    @app.post("/interview")
    async def post_interview(req: InterviewRequest) -> InterviewResult:
        result = await interview(req.messages, user_id=req.user_id)
        if result.profile is not None:
            store.save_profile(result.profile)
        return result

    @app.get("/windows")
    async def get_windows(
        start: Annotated[date, Query(alias="from")],
        end: Annotated[date, Query(alias="to")],
        min_days: Annotated[int, Query(ge=1, le=60)] = 2,
    ) -> list[FreeWindow]:
        """Free windows from the connected calendar (fixture: 9-17 office job, PL holidays off)."""
        _check_range(start, end)
        busy = await calendar.busy(start, end)
        return free_windows(busy, start, end, min_days=min_days, source="gcal")

    @app.post("/windows")
    async def post_windows(req: WindowsRequest) -> list[FreeWindow]:
        """Free windows from explicit busy intervals."""
        _check_range(req.start, req.end)
        return free_windows(req.busy, req.start, req.end, min_days=req.min_days)

    @app.get("/windows/long-weekends")
    async def get_long_weekends(
        start: Annotated[date, Query(alias="from")],
        end: Annotated[date, Query(alias="to")],
        max_leave: Annotated[int, Query(ge=0, le=MAX_LEAVE_DAYS)] = 2,
    ) -> list[BridgeWindow]:
        """Długi weekend radar: PL holidays + bridge days ('take 1 day off -> 4 days')."""
        _check_range(start, end)
        return long_weekends(start, end, max_leave=max_leave)

    @app.post("/recommendations")
    async def post_recommendations(req: RecommendationsRequest) -> list[RankedRecommendation]:
        profile = req.profile
        weights = req.weights or store.get_weights(profile.user_id) or Weights()
        if req.windows:
            windows = req.windows
        else:
            today = req.today or datetime.now(TZ).date()
            end = today + timedelta(days=req.horizon_days)
            busy = await calendar.busy(today, end)
            radar = [b.window for b in long_weekends(today, end, max_leave=req.max_leave_days)]
            windows = _merge_windows(free_windows(busy, today, end, source="gcal") + radar)
        trips = trip_windows(windows, profile.trip_length_days)
        origin = profile.origin_airports[0] if profile.origin_airports else "KRK"
        candidates = await provider.candidates(origin, trips, profile.luxury)
        recs = rank(candidates, profile, weights, limit=req.limit)

        top = recs[: max(0, req.explain_top)]
        whys = await asyncio.gather(*(explain(r, profile.interests) for r in top))
        for r, why in zip(top, whys):
            r.why = why
        for r in recs[len(top) :]:
            r.why = template_why(r, profile.interests)

        store.save_profile(profile)
        store.save_weights(profile.user_id, weights)
        store.save_recommendations(profile.user_id, recs)
        return recs

    @app.post("/feedback")
    async def post_feedback(req: FeedbackRequest) -> FeedbackResponse:
        profile = req.profile or store.get_profile(req.user_id) or TasteProfile(user_id=req.user_id)
        weights = req.weights or store.get_weights(profile.user_id) or Weights()
        rec = store.get_recommendation(req.trip_id)
        tags: list[str] = []
        temp = None
        label = req.trip_id
        if rec is not None:
            tags, temp, label = rec.tags, rec.temp_c, rec.city
        else:
            iata = req.trip_id.split("-")[0].upper()
            info = next((c for c in await provider.cities("KRK") if c.iata == iata), None)
            if info is not None:
                tags, label = info.tags, info.city
        result = apply_feedback(profile, weights, req.answers, tags, temp, trip_label=label)
        store.save_profile(result.profile)
        store.save_weights(result.profile.user_id, result.weights)
        return FeedbackResponse(
            **result.profile.model_dump(),
            trip_id=req.trip_id,
            weights=result.weights,
            diff=result.diff,
            profile=result.profile,
        )

    return app


def _check_range(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(422, "`to` must be on or after `from`")
    if (end - start).days > 400:
        raise HTTPException(422, "range too long (max 400 days)")
