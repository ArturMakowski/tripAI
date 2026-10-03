"""proactive_scan(user_id): free windows (calendar + długi weekend radar, next 90 days) x candidates
-> rank (Provider + tripai.scoring) -> decide (tripai.notify.rules) -> inbox + web push.

The body is written once against a `run_step(name, fn, *args)` callable: under DBOS
(tripai.workflows.runtime) each call is a checkpointed, retried step; without DATABASE_URL it is
a plain await. Step outputs are JSON-able dicts so DBOS can checkpoint them, and the workflow body
itself does no I/O and reads no clock (`now` comes from the first step), so replays are exact.

Cost: the paid steps (provider calls) are capped by `ScanLimits` (soon long weekends, watched
picks) and are not retried; the LiveProvider's own SerpApi budget caps each call on top.
"""

import asyncio
import hashlib
import importlib
import inspect
import logging
import os
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from tripai.api.state import Store
from tripai.models import FitVerdict, FreeWindow, TasteProfile, Weights
from tripai.notify.models import (
    Decision,
    Notification,
    NotificationPrefs,
    SavedPick,
    ScanResult,
    ScanRun,
    new_id,
    now_utc,
)
from tripai.notify.push import WebPusher
from tripai.notify.rules import (
    Draft,
    apply_user_control,
    draft_long_weekend,
    draft_new_top,
    draft_price_drop,
    soon_long_weekends,
    to_notification,
)
from tripai.notify.store import NotifyStore
from tripai.scoring import (
    BridgeWindow,
    CalendarProvider,
    TripDataProvider,
    free_windows,
    long_weekends,
    rank,
    trip_windows,
)
from tripai.scoring.types import Candidate, RankedRecommendation
from tripai.scoring.windows import TZ

log = logging.getLogger(__name__)

SCAN_HORIZON_DAYS = 90
MAX_LEAVE_DAYS = 2
TOP_N = 10
PAID_STEPS = frozenset({"rank_trips", "rank_long_weekends", "price_picks"})  # never retried

RunStep = Callable[..., Awaitable[Any]]
FitFn = Callable[[RankedRecommendation, TasteProfile], Awaitable[FitVerdict]]


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class ScanLimits:
    """Bounds on what one scan / one daily run may cost (env-tunable)."""

    max_long_weekends: int = field(default_factory=lambda: _env_int("TRIPAI_SCAN_MAX_LW", 2))
    max_picks: int = field(default_factory=lambda: _env_int("TRIPAI_MAX_PICKS", 5))
    max_users: int = field(default_factory=lambda: _env_int("TRIPAI_SCAN_MAX_USERS", 50))
    active_days: int = field(default_factory=lambda: _env_int("TRIPAI_SCAN_ACTIVE_DAYS", 14))
    min_interval_s: int = field(default_factory=lambda: _env_int("TRIPAI_SCAN_MIN_INTERVAL_S", 60))
    global_per_min: int = field(default_factory=lambda: _env_int("TRIPAI_SCAN_PER_MIN", 10))


def default_fit() -> FitFn | None:
    """T1c's fit verdict (`tripai.agents.fit.fit`: LLM, else deterministic rules) when installed."""
    try:
        return importlib.import_module("tripai.agents.fit").fit
    except (ImportError, AttributeError):
        return None


@dataclass
class ScanDeps:
    provider: TripDataProvider
    calendar: CalendarProvider
    store: Store  # core per-user state: profile, weights, last recommendations (async)
    notify: NotifyStore  # sync: always called from a worker thread
    pusher: WebPusher
    fit: FitFn | None = field(default_factory=default_fit)
    limits: ScanLimits = field(default_factory=ScanLimits)


async def plain_step(name: str, fn: Callable[..., Any], *args: Any) -> Any:
    if inspect.iscoroutinefunction(fn):
        return await fn(*args)
    return await asyncio.to_thread(fn, *args)  # sync steps hit Supabase: keep the loop free


_locks: dict[str, asyncio.Lock] = {}


def user_lock(user_id: str) -> asyncio.Lock:
    """One scan per user at a time in this process (cron + 'Run scan now' can't interleave)."""
    return _locks.setdefault(user_id, asyncio.Lock())


def _dump(models: Sequence[Any]) -> list[dict]:
    return [m.model_dump(mode="json") for m in models]


def _merge_windows(windows: list[FreeWindow]) -> list[FreeWindow]:
    seen: dict[tuple[date, date], FreeWindow] = {}
    for w in windows:
        seen.setdefault((w.start, w.end), w)
    return sorted(seen.values(), key=lambda w: (w.start, w.end))


async def _candidates(
    deps: ScanDeps, profile: TasteProfile, weights: Weights, windows: list[FreeWindow]
) -> list[Candidate]:
    if not windows:
        return []
    origin = profile.origin_airports[0] if profile.origin_airports else "KRK"
    params = inspect.signature(deps.provider.candidates).parameters
    extra = {"profile": profile, "weights": weights} if "profile" in params else {}
    return await deps.provider.candidates(origin, windows, profile.luxury, **extra)


class Scan:
    """The steps. Each method is one DBOS step: does I/O, returns JSON."""

    def __init__(self, deps: ScanDeps) -> None:
        self.deps = deps

    # 1 ------------------------------------------------------------------ context
    async def load_context(self, user_id: str) -> dict:
        d = self.deps
        profile = await d.store.get_profile(user_id) or TasteProfile(user_id=user_id)
        profile = profile.model_copy(update={"user_id": user_id})
        # personalize=False (Travel DNA y2): still notify, but rank on neutral default weights
        stored = await d.store.get_weights(user_id) if profile.personalize else None
        weights = stored or Weights()
        return {
            **await asyncio.to_thread(self._notify_context, user_id),
            "profile": profile.model_dump(mode="json"),
            "weights": weights.model_dump(mode="json"),
        }

    def _notify_context(self, user_id: str) -> dict:
        n = self.deps.notify
        now = now_utc()
        last = n.last_scan_run(user_id)
        picks = sorted(n.picks(user_id), key=lambda p: p.saved_at, reverse=True)
        return {
            "run_id": new_id(),
            "now": now.isoformat(),
            "prefs": n.get_prefs(user_id).model_dump(mode="json"),
            "last_run": last.model_dump(mode="json") if last else None,
            "picks": _dump(picks[: self.deps.limits.max_picks]),
            "sent_last_week": n.count_since(user_id, now - timedelta(days=7)),
        }

    async def _with_fit(self, rec: RankedRecommendation, profile: TasteProfile) -> dict:
        """Attach the AI fit verdict (docs/FIT_VERDICT.md) to a notification candidate."""
        if self.deps.fit is not None and rec.fit is None:
            try:
                rec.fit = await self.deps.fit(rec, profile)
            except Exception as exc:  # noqa: BLE001 - no verdict -> score thresholds apply
                log.warning("fit verdict failed for %s: %s", rec.id, exc)
        return rec.model_dump(mode="json")

    # 2 ------------------------------------------------------------------ windows
    async def find_windows(self, today_iso: str) -> dict:
        today = date.fromisoformat(today_iso)
        end = today + timedelta(days=SCAN_HORIZON_DAYS)
        busy = await self.deps.calendar.busy(today, end)
        bridges = long_weekends(today, end, max_leave=MAX_LEAVE_DAYS)
        windows = _merge_windows(
            free_windows(busy, today, end, source="gcal") + [b.window for b in bridges]
        )
        return {"windows": _dump(windows), "bridges": _dump(bridges)}

    # 3 ------------------------------------------------------------------ rank
    async def rank_trips(self, profile: dict, weights: dict, windows: list[dict]) -> dict:
        p, w = TasteProfile.model_validate(profile), Weights.model_validate(weights)
        trips = trip_windows([FreeWindow.model_validate(x) for x in windows], p.trip_length_days)
        cands = await _candidates(self.deps, p, w, trips)
        recs = rank(cands, p, w, limit=TOP_N)
        if recs:
            await self.deps.store.save_recommendations(p.user_id, recs)
        out = _dump(recs)
        if recs:  # only the #1 can trigger new_top: one verdict per scan
            out[0] = await self._with_fit(recs[0], p)
        return {"recs": out, "candidates": len(cands), "trip_windows": len(trips)}

    async def rank_long_weekends(self, profile: dict, weights: dict, bridges: list[dict]) -> dict:
        """Best trip per soon long weekend (ranked on its own so it isn't crowded out)."""
        p, w = TasteProfile.model_validate(profile), Weights.model_validate(weights)
        best: list[dict | None] = []
        for b in bridges:
            bw = BridgeWindow.model_validate(b)
            trips = trip_windows([bw.window], p.trip_length_days)
            recs = rank(await _candidates(self.deps, p, w, trips), p, w, limit=1)
            if recs:
                await self.deps.store.save_recommendations(p.user_id, recs)
            best.append(await self._with_fit(recs[0], p) if recs else None)
        return {"best": best}

    async def price_picks(self, profile: dict, weights: dict, picks: list[dict]) -> dict:
        """Re-price every watched pick (same city, same dates) from the provider."""
        p, w = TasteProfile.model_validate(profile), Weights.model_validate(weights)
        out: dict[str, dict | None] = {}
        for raw in picks:
            pick = SavedPick.model_validate(raw)
            win = FreeWindow(start=pick.start, end=pick.end)
            cands = [c for c in await _candidates(self.deps, p, w, [win]) if c.iata == pick.iata]
            recs = rank(cands, p, w, limit=1)
            out[pick.recommendation_id] = await self._with_fit(recs[0], p) if recs else None
        return {"recs": out}

    # 4 ------------------------------------------------------------------ persist + push
    def sent_keys(self, user_id: str, keys: list[str]) -> list[str]:
        return [k for k in keys if self.deps.notify.has_dedupe(user_id, k)]

    def save_notifications(self, user_id: str, notifications: list[dict], max_week: int) -> dict:
        """Insert in priority order. The weekly cap is re-counted here (another scan may have sent
        some since load_context) and the insert itself is unique on the dedupe key, so concurrent
        scans neither exceed the cap nor send the same notification twice. Idempotent on retry."""
        n_store = self.deps.notify
        saved: list[str] = []
        skipped: dict[str, str] = {}
        week_ago = now_utc() - timedelta(days=7)
        for raw in notifications:
            n = Notification.model_validate(raw)
            if n_store.get_notification(n.id) is not None:
                saved.append(n.id)  # retried step: already inserted
            elif n_store.count_since(user_id, week_ago) >= max_week:
                skipped[n.id] = f"weekly limit reached ({max_week}/week)"
            elif n_store.add_notification(n):
                saved.append(n.id)
            else:
                skipped[n.id] = "already notified"
        return {"ids": saved, "skipped": skipped}

    def update_pick_baselines(self, user_id: str, updates: list[dict]) -> dict:
        for raw in updates:
            self.deps.notify.save_pick(SavedPick.model_validate(raw))
        return {"updated": len(updates)}

    def push(self, user_id: str, notification_id: str) -> dict:
        d = self.deps
        n = d.notify.get_notification(notification_id)
        if n is None:
            return {"push_status": "missing", "pushed_at": None}
        if n.pushed_at is not None:
            # retried step: never double-push
            return {"push_status": n.push_status, "pushed_at": n.pushed_at.isoformat()}
        prefs = d.notify.get_prefs(user_id)
        subs = d.notify.subscriptions(user_id)
        if not prefs.push_opt_in:
            status = "not_opted_in"
        elif not subs:
            status = "no_subscription"
        elif not d.pusher.enabled:
            status = "vapid_not_configured"
        else:
            res = d.pusher.send(subs, n)
            for endpoint in res.gone or []:
                d.notify.remove_subscription(user_id, endpoint)
            status = res.status
            if res.sent:
                n.pushed_at = now_utc()
        n.push_status = status
        d.notify.update_notification(n)
        pushed_at = n.pushed_at.isoformat() if n.pushed_at else None
        return {"push_status": status, "pushed_at": pushed_at}

    def save_run(self, run: dict) -> dict:
        self.deps.notify.save_scan_run(ScanRun.model_validate(run))
        return {"ok": True}


def build_drafts(
    ctx: dict, ranked: dict, lw: dict, priced: dict, bridges: list[BridgeWindow]
) -> tuple[list[Draft], list[Decision]]:
    """Pure: every rule over the step outputs."""
    last = ScanRun.model_validate(ctx["last_run"]) if ctx["last_run"] else None
    recs = [RankedRecommendation.model_validate(r) for r in ranked["recs"]]
    drafts: list[Draft] = []
    decisions: list[Decision] = []

    def add(pair: tuple[Draft | None, Decision]) -> None:
        if pair[0] is not None:
            drafts.append(pair[0])
        decisions.append(pair[1])

    add(
        draft_new_top(
            recs[0] if recs else None,
            last.top_id if last else None,
            last.top_city if last else None,
        )
    )
    for b, raw in zip(bridges, lw["best"], strict=True):
        add(draft_long_weekend(b, RankedRecommendation.model_validate(raw) if raw else None))
    picks = {p["recommendation_id"]: p for p in ctx["picks"]}
    for rec_id, raw in priced["recs"].items():
        if raw is None:
            decisions.append(
                Decision(kind="price_drop", recommendation_id=rec_id, notify=False,
                         reason="no current price for this pick")
            )  # fmt: skip
            continue
        add(draft_price_drop(RankedRecommendation.model_validate(raw),
                             picks[rec_id]["baseline_pln"]))  # fmt: skip
    return drafts, decisions


def finalize(
    ctx: dict, drafts: list[Draft], sent_keys: list[str]
) -> tuple[list[Notification], list[Decision], list[SavedPick]]:
    """Pure: user-control filters, then notifications with ids derived from (run, dedupe key)
    so a DBOS replay produces the same ids. Also the new 'last price we told you' per pick."""
    now = datetime.fromisoformat(ctx["now"])
    profile = TasteProfile.model_validate(ctx["profile"])
    prefs = NotificationPrefs.model_validate(ctx["prefs"])
    kept, dropped = apply_user_control(
        drafts, prefs, now=now, sent_last_week=ctx["sent_last_week"], already_sent=set(sent_keys)
    )
    notes = []
    for d in kept:
        n = to_notification(d, profile.user_id, profile.interests, ctx["run_id"])
        nid = hashlib.sha256(f"{ctx['run_id']}|{d.dedupe_key}".encode()).hexdigest()[:32]
        notes.append(n.model_copy(update={"id": nid, "created_at": now}))
    picks = {p["recommendation_id"]: SavedPick.model_validate(p) for p in ctx["picks"]}
    updates = []
    for d in kept:
        if d.kind == "price_drop" and d.rec.id in picks:
            flight = next((e for e in d.rec.evidence if e.kind == "flight"), None)
            updates.append(
                picks[d.rec.id].model_copy(
                    update={
                        "baseline_pln": d.rec.total_cost_pln,
                        "baseline_source": flight.source if flight else "tripai.scoring",
                        "baseline_fetched_at": flight.fetched_at if flight else now,
                    }
                )
            )
    return notes, dropped, updates


async def scan_body(
    deps: ScanDeps,
    user_id: str,
    today_iso: str | None = None,
    *,
    run_step: RunStep = plain_step,
    mode: str = "sync",
    trigger: str = "manual",
    workflow_id: str | None = None,
) -> dict:
    async with user_lock(user_id):
        return await _scan(deps, user_id, today_iso, run_step, mode, trigger, workflow_id)


async def _scan(deps, user_id, today_iso, run_step, mode, trigger, workflow_id) -> dict:
    s = Scan(deps)
    ctx = await run_step("load_context", s.load_context, user_id)
    now = datetime.fromisoformat(ctx["now"])
    today = date.fromisoformat(today_iso) if today_iso else now.astimezone(TZ).date()
    profile = TasteProfile.model_validate(ctx["profile"])
    run = ScanRun(
        id=ctx["run_id"],
        user_id=user_id,
        mode=mode,
        trigger=trigger,
        workflow_id=workflow_id,
        today=today,
        started_at=now,
        personalized=profile.personalize,
    )
    win = await run_step("find_windows", s.find_windows, today.isoformat())
    bridges_all = [BridgeWindow.model_validate(b) for b in win["bridges"]]
    soon = soon_long_weekends(bridges_all, today)[: deps.limits.max_long_weekends]
    ranked = await run_step("rank_trips", s.rank_trips, ctx["profile"], ctx["weights"],
                            win["windows"])  # fmt: skip
    lw = await run_step("rank_long_weekends", s.rank_long_weekends, ctx["profile"],
                        ctx["weights"], _dump(soon))  # fmt: skip
    priced = await run_step("price_picks", s.price_picks, ctx["profile"], ctx["weights"],
                            ctx["picks"])  # fmt: skip

    drafts, decisions = build_drafts(ctx, ranked, lw, priced, soon)
    sent = await run_step("sent_keys", s.sent_keys, user_id, [d.dedupe_key for d in drafts])
    notes, dropped, pick_updates = finalize(ctx, drafts, sent)
    overruled = {(d.kind, d.recommendation_id) for d in dropped}
    decisions = [
        d for d in decisions if not (d.notify and (d.kind, d.recommendation_id) in overruled)
    ]
    decisions += dropped
    prefs = NotificationPrefs.model_validate(ctx["prefs"])
    saved = await run_step("save_notifications", s.save_notifications, user_id, _dump(notes),
                           prefs.max_per_week)  # fmt: skip
    by_id = {n.id: n for n in notes}
    for nid, reason in saved["skipped"].items():
        late = by_id[nid]
        decisions = [
            d
            for d in decisions
            if not (
                d.notify and d.kind == late.kind and d.recommendation_id == late.recommendation_id
            )
        ]
        decisions.append(Decision(kind=late.kind, recommendation_id=late.recommendation_id,
                                  notify=False, reason=reason))  # fmt: skip
    sent_ids = set(saved["ids"])
    pick_updates = [
        u
        for u in pick_updates
        if any(by_id[i].recommendation_id == u.recommendation_id for i in sent_ids)
    ]
    if pick_updates:
        await run_step("update_pick_baselines", s.update_pick_baselines, user_id,
                       _dump(pick_updates))  # fmt: skip
    pushed = {nid: await run_step("push", s.push, user_id, nid) for nid in saved["ids"]}

    recs = ranked["recs"]
    run.windows = len(win["windows"])
    run.candidates = ranked["candidates"]
    if recs:
        run.top_id, run.top_city = recs[0]["id"], recs[0]["city"]
        run.top_score = recs[0]["score"]["total"]
        run.inputs_hash = recs[0]["inputs_hash"]
    run.prices = {r["id"]: r["total_cost_pln"] for r in recs}
    run.prices |= {k: v["total_cost_pln"] for k, v in priced["recs"].items() if v}
    run.decisions = decisions
    run.notification_ids = saved["ids"]
    run.finished_at = now
    await run_step("save_run", s.save_run, run.model_dump(mode="json"))
    kept = [
        Notification.model_validate({**n.model_dump(), **pushed[n.id]})
        for n in notes
        if n.id in pushed
    ]
    return ScanResult(run=run, notifications=kept).model_dump(mode="json")
