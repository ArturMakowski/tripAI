"""Proactive scan + notification endpoints (T5b). Mounted by `create_app`."""

import os
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated

from fastapi import APIRouter, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

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
from tripai.workflows.scan import ScanDeps, plain_step, scan_body

UserId = Annotated[str, Query(min_length=1, max_length=128)]


class ScanRequest(BaseModel):
    user_id: str = "demo"
    today: date | None = None  # pin "now" for reproducible demos
    # optional: the client's current profile/weights (saved first, as POST /recommendations does)
    profile: TasteProfile | None = None
    weights: Weights | None = None


class InboxResponse(BaseModel):
    items: list[Notification]
    unread: int


class PrefsUpdate(BaseModel):
    user_id: str = "demo"
    push_opt_in: bool | None = None
    max_per_week: int | None = Field(None, ge=0, le=50)
    muted_cities: list[str] | None = None
    snooze_until: str | None = None  # ISO datetime, "" clears it


class SubscriptionJSON(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048)
    keys: PushKeys


class SubscribeRequest(BaseModel):
    user_id: str = "demo"
    subscription: SubscriptionJSON


class UnsubscribeRequest(BaseModel):
    user_id: str = "demo"
    endpoint: str


class PickRequest(BaseModel):
    user_id: str = "demo"
    recommendation_id: str


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
    app.include_router(_router(deps))
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


def _router(deps: ScanDeps) -> APIRouter:
    r = APIRouter(tags=["notifications"])
    notify = deps.notify

    # ------------------------------------------------------------------ scan
    @r.post("/scan/run")
    async def post_scan_run(req: ScanRequest) -> ScanResult:
        """Run the proactive scan now (demo button). Durable DBOS workflow when enabled."""
        if req.profile is not None:
            if req.profile.user_id != req.user_id:
                raise HTTPException(422, "profile.user_id must match user_id")
            deps.store.save_profile(req.profile)
        if req.weights is not None:
            deps.store.save_weights(req.user_id, req.weights)
        today = req.today.isoformat() if req.today else None
        if runtime.dbos_enabled():
            out = await runtime.run_scan(req.user_id, today)
        else:
            out = await scan_body(deps, req.user_id, today, run_step=plain_step)
        return ScanResult.model_validate(out)

    @r.get("/scan/last")
    async def get_last_scan(user_id: UserId = "demo") -> ScanRun | None:
        """The last finished scan with every rule decision ('why didn't I get a ping?')."""
        return notify.last_scan_run(user_id)

    # ------------------------------------------------------------------ inbox
    @r.get("/notifications")
    def get_notifications(
        user_id: UserId = "demo", limit: Annotated[int, Query(ge=1, le=200)] = 50
    ) -> InboxResponse:
        items = notify.notifications(user_id, limit)
        return InboxResponse(items=items, unread=sum(1 for n in items if n.read_at is None))

    @r.get("/notifications/prefs")
    def get_prefs(user_id: UserId = "demo") -> NotificationPrefs:
        return notify.get_prefs(user_id)

    @r.put("/notifications/prefs")
    def put_prefs(req: PrefsUpdate) -> NotificationPrefs:
        cur = notify.get_prefs(req.user_id)
        upd = req.model_dump(exclude_unset=True, exclude={"user_id"})
        if "snooze_until" in upd:
            upd["snooze_until"] = upd["snooze_until"] or None
        if "muted_cities" in upd:
            upd["muted_cities"] = sorted(
                {c.strip() for c in upd["muted_cities"] or [] if c.strip()}
            )
        try:
            prefs = NotificationPrefs.model_validate(
                {**cur.model_dump(), **upd, "updated_at": now_utc()}
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        notify.save_prefs(prefs)
        return prefs

    @r.post("/notifications/{notification_id}/read")
    def post_read(notification_id: str, user_id: UserId = "demo") -> Notification:
        n = notify.get_notification(notification_id)
        if n is None or n.user_id != user_id:
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
    def post_subscribe(req: SubscribeRequest) -> NotificationPrefs:
        """Called only after the user tapped 'enable' and the browser granted permission;
        that tap is the explicit opt-in, so it also sets push_opt_in."""
        if not deps.pusher.enabled:
            raise HTTPException(503, "web push is not configured (VAPID keys missing)")
        s = req.subscription
        notify.add_subscription(
            PushSubscription(user_id=req.user_id, endpoint=s.endpoint, keys=s.keys)
        )
        prefs = notify.get_prefs(req.user_id).model_copy(
            update={"push_opt_in": True, "updated_at": now_utc()}
        )
        notify.save_prefs(prefs)
        return prefs

    @r.delete("/push/subscribe")
    def delete_subscribe(req: UnsubscribeRequest) -> NotificationPrefs:
        notify.remove_subscription(req.user_id, req.endpoint)
        prefs = notify.get_prefs(req.user_id)
        if not notify.subscriptions(req.user_id):
            prefs = prefs.model_copy(update={"push_opt_in": False, "updated_at": now_utc()})
            notify.save_prefs(prefs)
        return prefs

    # ------------------------------------------------------------------ watched picks
    @r.get("/picks")
    def get_picks(user_id: UserId = "demo") -> list[SavedPick]:
        return notify.picks(user_id)

    @r.post("/picks")
    def post_pick(req: PickRequest) -> SavedPick:
        """Watch a recommendation for price drops; the baseline is its last real price."""
        rec = deps.store.get_recommendation(req.recommendation_id)
        if rec is None:
            raise HTTPException(404, "unknown recommendation id (fetch recommendations first)")
        flight = next((e for e in rec.evidence if e.kind == "flight"), None)
        pick = SavedPick(
            user_id=req.user_id,
            recommendation_id=rec.id,
            city=rec.city,
            iata=rec.iata,
            start=rec.window.start,
            end=rec.window.end,
            baseline_pln=rec.total_cost_pln,
            baseline_source=flight.source if flight else "tripai.scoring",
            baseline_fetched_at=flight.fetched_at if flight else now_utc(),
        )
        notify.save_pick(pick)
        return pick

    @r.delete("/picks/{recommendation_id}")
    def delete_pick(recommendation_id: str, user_id: UserId = "demo") -> dict:
        return {"removed": notify.remove_pick(user_id, recommendation_id)}

    return r
