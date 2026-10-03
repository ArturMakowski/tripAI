"""FastAPI app, API v0 (see docs/ARCHITECTURE.md)."""

import asyncio
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from tripai.agents.dna_chat import DnaChatResult, chat_dna
from tripai.agents.explain import explain, template_why
from tripai.agents.fit import fit, fit_engine
from tripai.agents.interview import InterviewResult, interview
from tripai.agents.jev import jev_enabled, jev_model_name
from tripai.agents.llm import llm_enabled, model_name
from tripai.api.notify import install_notifications
from tripai.api.schemas import (
    ApiRecommendation,
    FeedbackRequest,
    FeedbackResponse,
    InterviewRequest,
    Phase,
    RecommendationsRequest,
    WindowsRequest,
)
from tripai.api.session import HEADER as SESSION_HEADER
from tripai.api.session import session_user
from tripai.api.state import MemoryStore, Store
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.notify.push import WebPusher
from tripai.notify.store import NotifyStore
from tripai.profile import DnaRequest, DnaResult, map_dna
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
    trip_windows,
)
from tripai.scoring.budget_fit import rank_within_budget
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
    notify_store: NotifyStore | None = None,
    pusher: WebPusher | None = None,
) -> FastAPI:
    provider = provider or FixtureProvider()
    calendar = calendar or FixtureCalendar()
    store = store or MemoryStore()

    app = FastAPI(title="TripAI", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[SESSION_HEADER],
    )
    User = Annotated[str, Depends(session_user)]  # server-issued; client `user_id`s are ignored
    app.state.provider, app.state.calendar, app.state.store = provider, calendar, store

    @app.get("/health")
    async def health() -> dict:
        budget = getattr(provider, "budget_status", None)
        return {
            "ok": True,
            "provider": type(provider).__name__,
            "calendar": type(calendar).__name__,
            "store": type(store).__name__,
            "sources": _source_modes(provider, calendar),
            "serpapi_budget": await budget() if callable(budget) else None,
            "llm": model_name() if llm_enabled() else None,
            "jev": f"typesafe:{jev_model_name()}" if jev_enabled() else None,
            "fit_engine": fit_engine(),
            "scoring_version": SCORING_VERSION,
            # issue #18: the frontend sends ?phase=fast|full only when this is advertised
            "phases": ["fast", "full"],
        }

    @app.get("/cities")
    async def cities(origin: str = "KRK") -> list[CityInfo]:
        return await provider.cities(origin)

    @app.post("/interview")
    async def post_interview(req: InterviewRequest, uid: User) -> InterviewResult:
        result = await interview(req.messages, user_id=uid)
        if result.profile is not None:
            result.profile.user_id = uid
            await store.save_profile(result.profile)
        return result

    @app.post("/interview/dna")
    async def post_interview_dna(req: InterviewRequest) -> DnaChatResult:
        """Chat -> Travel DNA answers (Jev). When `done`, POST `answers`/`yes_no` to /profile/dna."""
        return await chat_dna(req.messages)

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
    async def post_recommendations(
        req: RecommendationsRequest, uid: User, phase: Phase = "full"
    ) -> list[ApiRecommendation]:
        """phase=fast: < ~2 s answer from cache + Travelpayouts + seed (no exact-date SerpApi
        checks, no LLM), every rec `refined=false`; phase=full (default): the final answer.
        The frontend shows fast first and swaps in full when it arrives."""
        fast = phase == "fast"
        profile = req.profile.model_copy(update={"user_id": uid})
        # personalize=False: neutral defaults unless the user moves the slider explicitly
        stored = await store.get_weights(uid) if profile.personalize else None
        weights = req.weights or stored or Weights()
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
        extra = {"fast": True} if fast and getattr(provider, "supports_fast", False) else {}
        candidates = await provider.candidates(
            origin, trips, profile.luxury, profile=profile, weights=weights, **extra
        )
        if trips and not candidates:
            # A live provider with no data left must not pass off synthetic numbers as live:
            # 503 lets the client show its own clearly-labelled fallback.
            raise HTTPException(503, "no trip data available right now; try again shortly")
        ranked = rank_within_budget(candidates, profile, weights, limit=req.limit)
        recs = [
            ApiRecommendation(
                **r.model_dump(),
                budget=status,
                over_budget_pln=None if status is None else status.overage_pln,
                phase=phase,
                refined=not fast and _refined(r),
            )
            for r, status in ranked
        ]

        top = [] if fast else recs[: max(0, req.explain_top)]
        fit_recs = [] if fast else recs[: req.fit_top]
        # explanations and fit verdicts are independent LLM calls: run them all concurrently
        results = await asyncio.gather(
            *(explain(r, profile.interests) for r in top),
            *(fit(r, profile) for r in fit_recs),
        )
        for r, why in zip(top, results[: len(top)]):
            r.why = why
        for r in recs[len(top) :]:
            r.why = template_why(r, profile.interests)
        for r, verdict in zip(fit_recs, results[len(top) :]):
            r.fit = verdict

        if not fast:  # the full call always follows; persist the final answer only
            await store.save_profile(profile)
            await store.save_weights(uid, weights)
            await store.save_recommendations(uid, recs)
        return recs

    @app.post("/profile/dna")
    async def post_profile_dna(req: DnaRequest, uid: User) -> DnaResult:
        """Travel DNA swipe answers -> profile + weights + reasons (docs/TRAVEL_DNA.md)."""
        result = map_dna(req.model_copy(update={"user_id": uid}), base=await store.get_profile(uid))
        await store.save_profile(result.profile)
        await store.save_weights(uid, result.weights)
        return result

    @app.post("/feedback")
    async def post_feedback(req: FeedbackRequest, uid: User) -> FeedbackResponse:
        profile = req.profile or await store.get_profile(uid) or TasteProfile(user_id=uid)
        profile = profile.model_copy(update={"user_id": uid})
        weights = req.weights or await store.get_weights(uid) or Weights()
        rec = await store.get_recommendation(uid, req.trip_id)
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
        await store.save_profile(result.profile)
        await store.save_weights(uid, result.weights)
        await store.save_feedback(uid, req.trip_id, req.answers, result.diff)
        return FeedbackResponse(
            **result.profile.model_dump(),
            trip_id=req.trip_id,
            weights=result.weights,
            diff=result.diff,
            note=result.note,
            profile=result.profile,
        )

    # T5b: proactive scan, inbox, prefs, web push (tripai.api.notify)
    app.state.scan_deps = install_notifications(
        app, provider, calendar, store, notify_store, pusher
    )
    return app


def _refined(rec: RankedRecommendation) -> bool:
    """Prices checked for the exact dates (SerpApi Google Flights/Hotels, live or recorded)."""
    return any(
        e.source.startswith(("serpapi:google_flights", "serpapi:google_hotels"))
        for e in rec.evidence
    )


def _source_modes(provider: TripDataProvider, calendar: CalendarProvider) -> dict[str, str]:
    """Per data source: 'live' or 'fixture' (providers may expose `source_modes()`)."""
    modes = getattr(provider, "source_modes", None)
    out = dict(modes()) if callable(modes) else {"provider": "fixture"}
    out["gcal"] = getattr(calendar, "mode", "fixture")
    return out


def _check_range(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(422, "`to` must be on or after `from`")
    if (end - start).days > 400:
        raise HTTPException(422, "range too long (max 400 days)")
