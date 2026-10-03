"""FastAPI app, API v0 (see docs/ARCHITECTURE.md)."""

import asyncio
import inspect
import logging
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from tripai import i18n
from tripai.agents.dna_chat import DnaChatResult, chat_dna
from tripai.agents.explain import explain, template_why
from tripai.agents.fit import fit, fit_engine
from tripai.agents.interview import InterviewResult, interview
from tripai.agents.jev import jev_enabled, jev_model_name
from tripai.agents.llm import llm_enabled, model_name
from tripai.api.internal import (
    InternalKeyMiddleware,
    internal_caller,
    internal_key,
    require_key_when_deployed,
)
from tripai.api.lang import LanguageMiddleware, use_lang
from tripai.api.notify import install_notifications
from tripai.api.schemas import (
    ApiRecommendation,
    FeedbackRequest,
    FeedbackResponse,
    InterviewRequest,
    Phase,
    ReactionRequest,
    ReactionResponse,
    RecommendationsRequest,
    WindowsRequest,
)
from tripai.api.session import HEADER as SESSION_HEADER
from tripai.api.session import session_user
from tripai.api.spend import forget as forget_spend
from tripai.api.spend import spend_history
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
from tripai.scoring.engine import candidate_id
from tripai.scoring.feedback import Change
from tripai.scoring.reactions import ReactionRecord, apply_reaction, undo_reaction
from tripai.scoring.value import annotate_value, typical_spend
from tripai.scoring.windows import MAX_LEAVE_DAYS, TZ

log = logging.getLogger(__name__)


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
    key = internal_key()
    require_key_when_deployed(key)
    app.add_middleware(LanguageMiddleware)  # Accept-Language / ?lang= -> i18n context
    if (
        key is None
    ):  # local dev: browser may call the API directly. With a key: same-origin proxy only
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=[SESSION_HEADER, "Content-Language"],
        )
    app.add_middleware(
        InternalKeyMiddleware, key=key
    )  # added last = outermost (tripai.api.internal)
    User = Annotated[str, Depends(session_user)]  # server-issued; client `user_id`s are ignored
    app.state.provider, app.state.calendar, app.state.store = provider, calendar, store

    @app.get("/health")
    async def health(request: Request) -> dict:
        if not internal_caller(request):  # public health check: liveness only, no internals
            return {"ok": True}
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
        use_lang(req.lang)
        result = await interview(req.messages, user_id=uid)
        if result.profile is not None:
            result.profile.user_id = uid
            await store.save_profile(result.profile)
        return result

    @app.post("/interview/dna")
    async def post_interview_dna(req: InterviewRequest) -> DnaChatResult:
        """Chat -> Travel DNA answers (Jev). When `done`, POST `answers`/`yes_no` to /profile/dna."""
        use_lang(req.lang)
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
        lang: str | None = None,  # also read by LanguageMiddleware; listed for the docs
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
        use_lang(req.lang)
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
        # one price reference for everything: refinement targets, ranking, badges (BUDGET.md)
        typical = typical_spend(
            profile, await spend_history(store, getattr(app.state, "notify", None), uid)
        )
        if "typical_spend_pln" in inspect.signature(provider.candidates).parameters:
            extra["typical_spend_pln"] = typical.pln
        candidates = await provider.candidates(
            origin, trips, profile.luxury, profile=profile, weights=weights, **extra
        )
        if trips and not candidates:
            # A live provider with no data left must not pass off synthetic numbers as live:
            # 503 lets the client show its own clearly-labelled fallback.
            raise HTTPException(503, "no trip data available right now; try again shortly")
        # T6: city+dates swiped "Nie dla mnie" stay out of this user's lists (undo brings them back)
        hidden = {k for k, r in (await store.get_reactions(uid)).items() if r.hidden}
        if hidden:
            candidates = [c for c in candidates if candidate_id(c) not in hidden]
        ranked = rank_within_budget(
            candidates, profile, weights, limit=req.limit, typical_spend_pln=typical.pln
        )
        chip_key = "value.typical_chip" if typical.source == "history" else "value.typical_chip_dna"
        chip = i18n.t(chip_key, amount=i18n.fmt_pln(typical.pln))
        recs = [
            ApiRecommendation(
                **r.model_dump(),
                budget=status,
                over_budget_pln=None if status is None else status.overage_pln,
                phase=phase,
                refined=not fast and _refined(r),
                typical_spend_pln=typical.pln,
                typical_spend_source=typical.source,
                typical_spend_label=chip,
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
        annotate_value(recs, profile, weights, typical)  # after fit: great_value needs it

        if not fast:  # the full call always follows; persist the final answer only
            await store.save_profile(profile)
            await store.save_weights(uid, weights)
            await store.save_recommendations(uid, recs)
        return recs

    @app.post("/profile/dna")
    async def post_profile_dna(req: DnaRequest, uid: User) -> DnaResult:
        """Travel DNA swipe answers -> profile + weights + reasons (docs/TRAVEL_DNA.md)."""
        use_lang(req.lang)
        result = map_dna(req.model_copy(update={"user_id": uid}), base=await store.get_profile(uid))
        await store.save_profile(result.profile)
        await store.save_weights(uid, result.weights)
        return result

    @app.post("/feedback")
    async def post_feedback(req: FeedbackRequest, uid: User) -> FeedbackResponse:
        use_lang(req.lang)
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

    async def _profile_and_weights(
        uid: str, profile: TasteProfile | None, weights: Weights | None
    ) -> tuple[TasteProfile, Weights]:
        p = profile or await store.get_profile(uid) or TasteProfile(user_id=uid)
        return p.model_copy(update={"user_id": uid}), (
            weights or await store.get_weights(uid) or Weights()
        )

    def _reaction_response(
        rec_id: str, record: ReactionRecord | None, city: str, profile, weights, diff, note
    ) -> ReactionResponse:
        return ReactionResponse(
            recommendation_id=rec_id,
            reaction=record.reaction if record else None,
            city=city,
            profile=profile,
            weights=weights,
            diff=diff,
            note=note,
            hidden=bool(record and record.hidden),
            learned=[c.field.split(".", 1)[1] for c in diff if c.field.startswith("interests.")],
        )

    @app.get("/reactions")
    async def get_reactions(uid: User) -> list[ReactionRecord]:
        """This session's swipes, newest first (dislikes = hidden city+dates)."""
        recs = await store.get_reactions(uid)
        return sorted(recs.values(), key=lambda r: r.created_at, reverse=True)

    @app.post("/reactions")
    async def post_reaction(req: ReactionRequest, uid: User) -> ReactionResponse:
        """T6 swipe -> small deterministic nudge of interests (and maybe one weight), with reasons.
        personalize=False: recorded, nothing changes, `note` says so."""
        use_lang(req.lang)
        forget_spend(uid)  # a like/love changes the typical-spend history
        rec = await store.get_recommendation(uid, req.recommendation_id)
        if rec is None:
            raise HTTPException(404, "unknown recommendation id (fetch recommendations first)")
        profile, weights = await _profile_and_weights(uid, req.profile, req.weights)
        previous = (await store.get_reactions(uid)).get(rec.id)
        undo_diff: list[Change] = []
        if previous is not None:  # re-swiping a card replaces the old reaction
            profile, weights, undo_diff, _ = undo_reaction(profile, weights, previous)
        result = apply_reaction(profile, weights, rec, req.reaction)
        await store.save_profile(result.profile)
        await store.save_weights(uid, result.weights)
        await store.save_reaction(result.record)
        return _reaction_response(rec.id, result.record, rec.city, result.profile, result.weights,
                                  undo_diff + result.diff, result.note)  # fmt: skip

    @app.delete("/reactions/{recommendation_id}")
    async def delete_reaction(
        recommendation_id: str, uid: User, profile: TasteProfile | None = None
    ) -> ReactionResponse:
        """Undo a swipe: revert exactly what it changed (unless changed again since) and unhide.
        Language: `?lang=` or Accept-Language (the body, if any, is the current profile)."""
        previous = (await store.get_reactions(uid)).get(recommendation_id)
        if previous is None:
            raise HTTPException(404, "no reaction for this recommendation")
        base, weights = await _profile_and_weights(uid, profile, None)
        new_profile, new_weights, diff, note = undo_reaction(base, weights, previous)
        await store.save_profile(new_profile)
        await store.save_weights(uid, new_weights)
        await store.delete_reaction(uid, recommendation_id)
        return _reaction_response(recommendation_id, None, previous.city, new_profile,
                                  new_weights, diff, note)  # fmt: skip

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
