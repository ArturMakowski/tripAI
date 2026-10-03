"""proactive_scan(user_id): free windows (calendar + długi weekend radar, next 90 days) x candidates
-> rank (Provider + tripai.scoring) -> decide (tripai.notify.rules) -> inbox + web push.

The body is written once against a `run_step(name, fn, *args)` callable: under DBOS
(tripai.workflows.runtime) each call is a checkpointed, retried step; without DATABASE_URL it is
a plain await. Step outputs are JSON-able dicts so DBOS can checkpoint them, and the workflow body
itself does no I/O and reads no clock (`now` comes from the first step), so replays are exact.
"""

import hashlib
import inspect
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from tripai.api.state import Store
from tripai.models import FreeWindow, TasteProfile, Weights
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

SCAN_HORIZON_DAYS = 90
MAX_LEAVE_DAYS = 2
TOP_N = 10

RunStep = Callable[..., Awaitable[Any]]


@dataclass
class ScanDeps:
    provider: TripDataProvider
    calendar: CalendarProvider
    store: Store  # core per-user state: profile, weights, last recommendations
    notify: NotifyStore
    pusher: WebPusher


async def plain_step(name: str, fn: Callable[..., Any], *args: Any) -> Any:
    out = fn(*args)
    return await out if inspect.isawaitable(out) else out


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
    def load_context(self, user_id: str) -> dict:
        d = self.deps
        profile = d.store.get_profile(user_id) or TasteProfile(user_id=user_id)
        # personalize=False (Travel DNA y2): still notify, but rank on neutral default weights
        weights = (d.store.get_weights(user_id) if profile.personalize else None) or Weights()
        now = now_utc()
        last = d.notify.last_scan_run(user_id)
        return {
            "run_id": new_id(),
            "now": now.isoformat(),
            "profile": profile.model_dump(mode="json"),
            "weights": weights.model_dump(mode="json"),
            "prefs": d.notify.get_prefs(user_id).model_dump(mode="json"),
            "last_run": last.model_dump(mode="json") if last else None,
            "picks": _dump(d.notify.picks(user_id)),
            "sent_last_week": d.notify.count_since(user_id, now - timedelta(days=7)),
        }

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
            self.deps.store.save_recommendations(p.user_id, recs)
        return {"recs": _dump(recs), "candidates": len(cands), "trip_windows": len(trips)}

    async def rank_long_weekends(self, profile: dict, weights: dict, bridges: list[dict]) -> dict:
        """Best trip per soon long weekend (ranked on its own so it isn't crowded out)."""
        p, w = TasteProfile.model_validate(profile), Weights.model_validate(weights)
        best: list[dict | None] = []
        for b in bridges:
            bw = BridgeWindow.model_validate(b)
            trips = trip_windows([bw.window], p.trip_length_days)
            recs = rank(await _candidates(self.deps, p, w, trips), p, w, limit=1)
            if recs:
                self.deps.store.save_recommendations(p.user_id, recs)
            best.append(recs[0].model_dump(mode="json") if recs else None)
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
            out[pick.recommendation_id] = recs[0].model_dump(mode="json") if recs else None
        return {"recs": out}

    # 4 ------------------------------------------------------------------ persist + push
    def sent_keys(self, user_id: str, keys: list[str]) -> list[str]:
        return [k for k in keys if self.deps.notify.has_dedupe(user_id, k)]

    def save_notifications(self, user_id: str, notifications: list[dict]) -> dict:
        """Insert unless the dedupe key was already used (idempotent on step retry)."""
        saved = []
        for raw in notifications:
            n = Notification.model_validate(raw)
            if self.deps.notify.get_notification(n.id) is not None:
                saved.append(n.id)  # retried step: already inserted
            elif not self.deps.notify.has_dedupe(user_id, n.dedupe_key):
                self.deps.notify.add_notification(n)
                saved.append(n.id)
        return {"ids": saved}

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
    workflow_id: str | None = None,
) -> dict:
    s = Scan(deps)
    ctx = await run_step("load_context", s.load_context, user_id)
    now = datetime.fromisoformat(ctx["now"])
    today = date.fromisoformat(today_iso) if today_iso else now.astimezone(TZ).date()
    profile = TasteProfile.model_validate(ctx["profile"])
    run = ScanRun(
        id=ctx["run_id"],
        user_id=user_id,
        mode=mode,
        workflow_id=workflow_id,
        today=today,
        started_at=now,
        personalized=profile.personalize,
    )
    win = await run_step("find_windows", s.find_windows, today.isoformat())
    bridges_all = [BridgeWindow.model_validate(b) for b in win["bridges"]]
    soon = soon_long_weekends(bridges_all, today)
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
    saved = await run_step("save_notifications", s.save_notifications, user_id, _dump(notes))
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
