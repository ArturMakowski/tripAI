"""Proactive scan + notification endpoints (T5b). Mounted by `create_app`.

Every endpoint acts for the server-issued session user (`tripai.api.session`, X-TripAI-Session);
a client-sent `user_id` is ignored, so nobody can read, mute, subscribe to or trigger pushes for
another user. There are no accounts yet: a session is one browser.
"""

import asyncio
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from tripai.api.session import session_user
from tripai.api.state import Store
from tripai.models import TasteProfile, Weights
from tripai.notify.models import (
    Notification,
    NotificationPrefs,
    PushKeys,
    PushSubscription,
    SavedPick,
    ScanResult,
    ScanRun,
    now_utc,
)
from tripai.notify.push import VapidConfig, WebPusher
from tripai.notify.store import MemoryNotifyStore, NotifyStore
from tripai.scoring import CalendarProvider, TripDataProvider
from tripai.workflows import runtime
from tripai.workflows.scan import ScanDeps, ScanLimits, plain_step, scan_body

User = Annotated[str, Depends(session_user)]


class ScanRequest(BaseModel):
    today: date | None = None  # pin "now" for reproducible demos
    # optional: the client's current profile/weights (saved first, as POST /recommendations does)
    profile: TasteProfile | None = None
    weights: Weights | None = None


class InboxResponse(BaseModel):
    items: list[Notification]
    unread: int


class PrefsUpdate(BaseModel):
    # only False here: opting in happens through POST /push/subscribe (a user tap + permission)
    push_opt_in: bool | None = None
    max_per_week: int | None = Field(None, ge=0, le=50)
    muted_cities: list[str] | None = None
    snooze_until: str | None = None  # ISO datetime (naive = UTC), "" clears it


class SubscriptionJSON(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048)
    keys: PushKeys


class SubscribeRequest(BaseModel):
    subscription: SubscriptionJSON


class UnsubscribeRequest(BaseModel):
    endpoint: str


class PickRequest(BaseModel):
    recommendation_id: str


class ScanRateLimiter:
    """Per-process guard for the synchronous, provider-calling POST /scan/run: one scan per user
    every `min_interval_s`, and at most `per_min` scans per minute overall."""

    def __init__(self, limits: ScanLimits, clock=time.monotonic) -> None:
        self.limits, self.clock = limits, clock
        self.last: dict[str, float] = {}
        self.recent: deque[float] = deque()

    def check(self, user_id: str) -> None:
        now = self.clock()
        wait = self.limits.min_interval_s - (now - self.last.get(user_id, -1e9))
        if wait > 0:
            raise HTTPException(429, f"scan ran moments ago; try again in {wait:.0f} s",
                                headers={"Retry-After": str(int(wait) + 1)})  # fmt: skip
        while self.recent and now - self.recent[0] > 60:
            self.recent.popleft()
        if len(self.recent) >= self.limits.global_per_min:
            raise HTTPException(429, "too many scans right now; try again in a minute",
                                headers={"Retry-After": "60"})  # fmt: skip
        self.last[user_id] = now
        self.recent.append(now)


def install_notifications(
    app: FastAPI,
    provider: TripDataProvider,
    calendar: CalendarProvider,
    store: Store,
    notify: NotifyStore | None = None,
    pusher: WebPusher | None = None,
) -> ScanDeps:
    deps = ScanDeps(
        provider=provider,
        calendar=calendar,
        store=store,
        notify=notify or MemoryNotifyStore(),
        pusher=pusher or WebPusher(VapidConfig.from_env()),
    )
    app.state.notify = deps.notify
    app.state.scan_limiter = ScanRateLimiter(deps.limits)
    app.include_router(_router(deps, app.state.scan_limiter))
    return deps


def enable_durable_scans(app: FastAPI, deps: ScanDeps) -> None:
    """Launch DBOS on startup when DATABASE_URL is set (see tripai.workflows.runtime)."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        return
    runtime.set_deps(deps)
    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a: FastAPI):
        runtime.launch_dbos(url)  # on the server's event loop (DBOS recovers async workflows)
        try:
            async with inner(a) as state:
                yield state
        finally:
            runtime.shutdown_dbos()

    app.router.lifespan_context = lifespan


def _router(deps: ScanDeps, limiter: ScanRateLimiter) -> APIRouter:
    r = APIRouter(tags=["notifications"])
    notify = deps.notify

    @r.get("/session")
    async def get_session(uid: User) -> dict:
        """Issue (or confirm) the caller's session before parallel requests start."""
        return {"user_id": uid}

    # ------------------------------------------------------------------ scan
    @r.post("/scan/run")
    async def post_scan_run(req: ScanRequest, uid: User) -> ScanResult:
        """Run the proactive scan now (demo button). Durable DBOS workflow when enabled."""
        limiter.check(uid)
        if req.profile is not None:
            await deps.store.save_profile(req.profile.model_copy(update={"user_id": uid}))
        if req.weights is not None:
            await deps.store.save_weights(uid, req.weights)
        today = req.today.isoformat() if req.today else None
        if runtime.dbos_enabled():
            out = await runtime.run_scan(uid, today)
        else:
            out = await scan_body(deps, uid, today, run_step=plain_step)
        return ScanResult.model_validate(out)

    @r.get("/scan/last")
    async def get_last_scan(uid: User) -> ScanRun | None:
        """The last finished scan with every rule decision ('why didn't I get a ping?')."""
        return await asyncio.to_thread(notify.last_scan_run, uid)

    # ------------------------------------------------------------------ inbox
    @r.get("/notifications")
    def get_notifications(
        uid: User, limit: Annotated[int, Query(ge=1, le=200)] = 50
    ) -> InboxResponse:
        items = notify.notifications(uid, limit)
        return InboxResponse(items=items, unread=sum(1 for n in items if n.read_at is None))

    @r.get("/notifications/prefs")
    def get_prefs(uid: User) -> NotificationPrefs:
        return notify.get_prefs(uid)

    @r.put("/notifications/prefs")
    def put_prefs(req: PrefsUpdate, uid: User) -> NotificationPrefs:
        cur = notify.get_prefs(uid)
        upd = req.model_dump(exclude_unset=True)
        if upd.get("push_opt_in"):
            raise HTTPException(422, "opt in to push via POST /push/subscribe (needs a user tap)")
        if "snooze_until" in upd:
            upd["snooze_until"] = upd["snooze_until"] or None
        if "muted_cities" in upd:
            upd["muted_cities"] = sorted(
                {c.strip() for c in upd["muted_cities"] or [] if c.strip()}
            )
        try:
            prefs = NotificationPrefs.model_validate(
                {**cur.model_dump(), **upd, "user_id": uid, "updated_at": now_utc()}
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        notify.save_prefs(prefs)
        return prefs

    @r.post("/notifications/{notification_id}/read")
    def post_read(notification_id: str, uid: User) -> Notification:
        n = notify.get_notification(notification_id)
        if n is None or n.user_id != uid:
            raise HTTPException(404, "notification not found")
        if n.read_at is None:
            n.read_at = now_utc()
            notify.update_notification(n)
        return n

    # ------------------------------------------------------------------ web push
    @r.get("/push/vapid-public-key")
    def get_vapid_key() -> dict:
        vapid = deps.pusher.vapid
        return {"enabled": vapid is not None, "public_key": vapid.public_key if vapid else None}

    @r.post("/push/subscribe")
    def post_subscribe(req: SubscribeRequest, uid: User) -> NotificationPrefs:
        """Called only after the user tapped 'enable' and the browser granted permission;
        that tap is the explicit opt-in, so it also sets push_opt_in."""
        if not deps.pusher.enabled:
            raise HTTPException(503, "web push is not configured (VAPID keys missing)")
        s = req.subscription
        notify.add_subscription(PushSubscription(user_id=uid, endpoint=s.endpoint, keys=s.keys))
        prefs = notify.get_prefs(uid).model_copy(
            update={"push_opt_in": True, "updated_at": now_utc()}
        )
        notify.save_prefs(prefs)
        return prefs

    @r.delete("/push/subscribe")
    def delete_subscribe(req: UnsubscribeRequest, uid: User) -> NotificationPrefs:
        notify.remove_subscription(uid, req.endpoint)
        prefs = notify.get_prefs(uid)
        if not notify.subscriptions(uid):
            prefs = prefs.model_copy(update={"push_opt_in": False, "updated_at": now_utc()})
            notify.save_prefs(prefs)
        return prefs

    # ------------------------------------------------------------------ watched picks
    @r.get("/picks")
    def get_picks(uid: User) -> list[SavedPick]:
        return notify.picks(uid)

    @r.post("/picks")
    async def post_pick(req: PickRequest, uid: User) -> SavedPick:
        """Watch a recommendation for price drops; the baseline is its last real price."""
        rec = await deps.store.get_recommendation(uid, req.recommendation_id)
        if rec is None:
            raise HTTPException(404, "unknown recommendation id (fetch recommendations first)")
        mine = await asyncio.to_thread(notify.picks, uid)
        cap = deps.limits.max_picks
        if len(mine) >= cap and rec.id not in {p.recommendation_id for p in mine}:
            raise HTTPException(409, f"you can watch at most {cap} trips; unwatch one first")
        flight = next((e for e in rec.evidence if e.kind == "flight"), None)
        pick = SavedPick(
            user_id=uid,
            recommendation_id=rec.id,
            city=rec.city,
            iata=rec.iata,
            start=rec.window.start,
            end=rec.window.end,
            baseline_pln=rec.total_cost_pln,
            baseline_source=flight.source if flight else "tripai.scoring",
            baseline_fetched_at=flight.fetched_at if flight else now_utc(),
        )
        await asyncio.to_thread(notify.save_pick, pick)
        return pick

    @r.delete("/picks/{recommendation_id}")
    def delete_pick(recommendation_id: str, uid: User) -> dict:
        return {"removed": notify.remove_pick(uid, recommendation_id)}

    return r
