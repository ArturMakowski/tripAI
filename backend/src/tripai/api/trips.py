"""T13 "My trips": approved plans + watched picks, their latest price check, the user's target
price, and past trips to rate. Mounted by `install_notifications` (same deps as the scan).

Everything acts for the server-issued session user. Prices shown here are copied from the
recommendation the user approved/saved and from the proactive scan's re-pricing (connectors +
tripai.scoring), never computed here; `change_pln` is a plain difference of two exact-date prices.
"""

import asyncio
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from tripai.api.session import session_user
from tripai.notify.models import PlannedTrip, SavedPick, now_utc, watching
from tripai.scoring.party import party_total
from tripai.scoring.types import RankedRecommendation
from tripai.scoring.windows import TZ

User = Annotated[str, Depends(session_user)]


def today_pl() -> date:
    return datetime.now(TZ).date()


def pick_from(uid: str, rec: RankedRecommendation) -> SavedPick:
    """Watch a recommendation; its baseline is the price the user was shown."""
    flight = next((e for e in rec.evidence if e.kind == "flight"), None)
    return SavedPick(
        user_id=uid,
        recommendation_id=rec.id,
        city=rec.city,
        iata=rec.iata,
        start=rec.window.start,
        end=rec.window.end,
        baseline_pln=rec.total_cost_pln,
        baseline_source=flight.source if flight else "tripai.scoring",
        baseline_fetched_at=flight.fetched_at if flight else now_utc(),
        saved_pln=rec.total_cost_pln,
        saved_flight_pln=rec.flight_cost_pln,
        saved_hotel_pln=rec.hotel_cost_pln,
        saved_price_status=rec.price_status,
        travelers=rec.travelers,
    )


class TripItem(BaseModel):
    id: str  # recommendation id ("{IATA}-{yyyymmdd}-{yyyymmdd}")
    kind: Literal["approved", "saved"]
    city: str
    country: str = ""
    iata: str
    start: date
    end: date
    # Party money model (docs/BUDGET.md): *_pln = per person (== total_cost_pln); flight lines are
    # per traveller, hotel lines the whole stay; party = flight x travellers + hotel. Lines are null
    # on rows saved before they were recorded (the UI then shows the per-person figure only).
    travelers: int = 1
    saved_pln: float  # per person all-in when approved / saved
    saved_flight_pln: float | None = None
    saved_hotel_pln: float | None = None
    saved_party_pln: float | None = None
    saved_price_status: str = "exact"
    saved_at: datetime
    watched: bool  # re-priced by the proactive scan
    current_pln: float | None = None  # latest scan check (None: not checked yet / no price now)
    current_flight_pln: float | None = None
    current_hotel_pln: float | None = None
    current_party_pln: float | None = None
    current_travelers: int | None = None
    price_status: str | None = None  # of current_pln: "exact" | "partial" | "estimate"
    checked_at: datetime | None = None
    # current - saved per person; only when both are exact-date prices for the same party size
    change_pln: float | None = None
    target_pln: float | None = None  # per person


class TripsResponse(BaseModel):
    planned: list[TripItem]
    past: list[TripItem]  # approved trips that have ended: rate them (POST /feedback)
    max_watched: int


class ApproveRequest(BaseModel):
    recommendation_id: str


class TargetRequest(BaseModel):
    target_pln: float | None = Field(None, gt=0, le=1_000_000)  # null clears it


def _party(flight: float | None, hotel: float | None, n: int) -> float | None:
    """What the whole party pays (tripai.scoring.party): flight x travellers + the stay."""
    return None if flight is None or hotel is None else round(party_total(flight, hotel, n), 2)


def item(trip: PlannedTrip | None, pick: SavedPick | None) -> TripItem:
    assert trip or pick
    base = trip or pick
    if trip:
        saved, status, at = trip.total_pln, trip.price_status, trip.approved_at
        s_flight, s_hotel = trip.flight_pln, trip.hotel_pln
    else:
        saved, status, at = pick.first_pln, pick.saved_price_status, pick.saved_at
        s_flight, s_hotel = pick.saved_flight_pln, pick.saved_hotel_pln
    if pick and trip and s_flight is None:  # older approval row: the pick may have the lines
        s_flight, s_hotel = pick.saved_flight_pln, pick.saved_hotel_pln
    cur = pick.last_pln if pick else None
    cur_status = pick.last_price_status if pick else None
    c_flight = pick.last_flight_pln if pick else None
    c_hotel = pick.last_hotel_pln if pick else None
    c_n = (pick.last_travelers or base.travelers) if pick and cur is not None else None
    honest = (
        cur is not None and cur_status == "exact" and status == "exact" and c_n == base.travelers
    )
    return TripItem(
        id=base.recommendation_id,
        kind="approved" if trip else "saved",
        city=base.city,
        country=trip.country if trip else "",
        iata=base.iata,
        start=base.start,
        end=base.end,
        travelers=base.travelers,
        saved_pln=saved,
        saved_flight_pln=s_flight,
        saved_hotel_pln=s_hotel,
        saved_party_pln=_party(s_flight, s_hotel, base.travelers),
        saved_price_status=status,
        saved_at=at,
        watched=pick is not None,
        current_pln=cur,
        current_flight_pln=c_flight,
        current_hotel_pln=c_hotel,
        current_party_pln=_party(c_flight, c_hotel, c_n or 1),
        current_travelers=c_n,
        price_status=cur_status,
        checked_at=pick.last_checked_at if pick else None,
        change_pln=round(cur - saved, 2) if honest else None,
        target_pln=pick.target_pln if pick else None,
    )


def split(trips: list[PlannedTrip], picks: list[SavedPick], today: date) -> TripsResponse:
    """Planned = approved (not cancelled) + watched picks, one row per trip; past = approved
    trips whose end date has passed. A watched pick that ended without being approved is
    dropped (it was never a plan, so there is nothing to rate)."""
    by_pick = {p.recommendation_id: p for p in picks}
    live = {t.recommendation_id: t for t in trips if t.status != "cancelled"}
    planned, past = [], []
    for rid, t in live.items():
        (past if t.end < today else planned).append(item(t, by_pick.get(rid)))
    for rid, p in by_pick.items():
        if rid not in live and p.end >= today:
            planned.append(item(None, p))
    planned.sort(key=lambda i: (i.start, i.city))
    past.sort(key=lambda i: (i.end, i.city), reverse=True)
    return TripsResponse(planned=planned, past=past, max_watched=0)


def trips_router(deps) -> APIRouter:
    """`deps` is the scan's ScanDeps (store, notify store, limits)."""
    r = APIRouter(tags=["trips"])
    notify = deps.notify

    def _today(today: date | None) -> date:
        return today or today_pl()

    def _find(uid: str, rid: str) -> tuple[PlannedTrip | None, SavedPick | None]:
        trip = next((t for t in notify.planned_trips(uid) if t.recommendation_id == rid), None)
        pick = next((p for p in notify.picks(uid) if p.recommendation_id == rid), None)
        return trip, pick

    def _can_watch(uid: str, rid: str) -> bool:
        mine = notify.picks(uid)
        live = watching(mine, today_pl())  # ended trips don't hold a slot
        return len(live) < deps.limits.max_picks or rid in {p.recommendation_id for p in mine}

    @r.get("/trips")
    def get_trips(uid: User, today: Annotated[date | None, Query()] = None) -> TripsResponse:
        out = split(notify.planned_trips(uid), notify.picks(uid), _today(today))
        out.max_watched = deps.limits.max_picks
        return out

    @r.post("/trips")
    async def post_trip(req: ApproveRequest, uid: User) -> TripItem:
        """Persist an approval from the confirm page (nothing is booked) and watch its price
        when a watch slot is free, so the scan re-checks it and target alerts work."""
        rec = await deps.store.get_recommendation(uid, req.recommendation_id)
        if rec is None:
            raise HTTPException(404, "unknown recommendation id (fetch recommendations first)")
        trip = PlannedTrip(
            user_id=uid,
            recommendation_id=rec.id,
            city=rec.city,
            country=rec.country,
            iata=rec.iata,
            start=rec.window.start,
            end=rec.window.end,
            total_pln=rec.total_cost_pln,
            flight_pln=rec.flight_cost_pln,
            hotel_pln=rec.hotel_cost_pln,
            price_status=rec.price_status,
            travelers=rec.travelers,
        )

        def write() -> TripItem:
            old, pick = _find(uid, rec.id)
            kept = old.model_copy(update={"status": "planned"}) if old else trip
            notify.save_trip(kept)  # re-approving keeps the first approval's price and time
            if pick is None and _can_watch(uid, rec.id):
                pick = pick_from(uid, rec)
                notify.save_pick(pick)
            return item(kept, pick)

        return await asyncio.to_thread(write)

    @r.put("/trips/{recommendation_id}/target")
    async def put_target(recommendation_id: str, req: TargetRequest, uid: User) -> TripItem:
        """Set (or clear with null) the price at which the proactive scan alerts this user.
        Compared with the per-person all-in price for the exact dates; estimates never alert."""
        trip, pick = await asyncio.to_thread(_find, uid, recommendation_id)
        if trip is None and pick is None:
            raise HTTPException(404, "not one of your trips")
        if pick is None:  # approved but not watched yet: watch it now (cap applies)
            rec = await deps.store.get_recommendation(uid, recommendation_id)
            if rec is None:
                raise HTTPException(404, "trip is no longer priced; open it from Trips again")
            if not await asyncio.to_thread(_can_watch, uid, recommendation_id):
                cap = deps.limits.max_picks
                raise HTTPException(409, f"you can watch at most {cap} trips; unwatch one first")
            pick = pick_from(uid, rec)
            await asyncio.to_thread(notify.save_pick, pick)
        fields = {"target_pln": req.target_pln}
        new = await asyncio.to_thread(notify.patch_pick, uid, recommendation_id, fields)
        return item(trip, new or pick.model_copy(update=fields))

    @r.delete("/trips/{recommendation_id}/watch")
    def delete_watch(recommendation_id: str, uid: User) -> TripItem | None:
        """ "Stop watching": frees the watch slot and drops the target. An approved trip stays in
        My trips (unwatched); a trip that was only saved leaves the list (returns null)."""
        trip, pick = _find(uid, recommendation_id)
        if trip is None and pick is None:
            raise HTTPException(404, "not one of your trips")
        if pick is not None:
            notify.remove_pick(uid, recommendation_id)
        return item(trip, None) if trip else None

    return r
