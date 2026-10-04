"""T13 "My trips": approved plans + watched picks, their latest price check, the user's target
price, and past trips to rate. Mounted by `install_notifications` (same deps as the scan).

Everything acts for the server-issued session user. Prices shown here are copied from the
recommendation the user approved/saved and from the proactive scan's re-pricing (connectors +
tripai.scoring), never computed here; `change_pln` is a plain difference of two exact-date prices.

T24 "manage my trips" (docs/USER_TESTING.md round 4): delete with undo (a soft delete the scan
skips), edit dates/party (re-priced through the normal pipeline: cache first, then a refresh that
may spend SerpApi within the daily cap, and the fit re-checked), and mark as booked (moves to the
past list; no more price watching).
"""

import asyncio
import inspect
import logging
import time
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from tripai.api.session import session_user
from tripai.api.spend import spend_history
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.notify.models import PlannedTrip, SavedPick, not_watched, now_utc, watching
from tripai.scoring import rank
from tripai.scoring.origins import candidates_for_origins
from tripai.scoring.party import party_total
from tripai.scoring.types import RankedRecommendation
from tripai.scoring.value import typical_spend
from tripai.scoring.windows import TZ

log = logging.getLogger(__name__)
User = Annotated[str, Depends(session_user)]
MAX_PARTY = 12  # same stepper bounds as onboarding (docs/USER_TESTING.md)
MAX_TRIP_NIGHTS = 30
REFRESH_MIN_INTERVAL_S = 5.0  # a refresh may spend SerpApi: one per trip every few seconds


def today_pl() -> date:
    return datetime.now(TZ).date()


def pick_from_trip(trip: PlannedTrip) -> SavedPick:
    """Watch an approved trip again (un-booked): its baseline is the price it was approved at."""
    return SavedPick(
        user_id=trip.user_id,
        recommendation_id=trip.recommendation_id,
        city=trip.city,
        iata=trip.iata,
        start=trip.start,
        end=trip.end,
        baseline_pln=trip.total_pln,
        baseline_source="tripai.scoring",
        baseline_fetched_at=now_utc(),
        saved_pln=trip.total_pln,
        saved_flight_pln=trip.flight_pln,
        saved_hotel_pln=trip.hotel_pln,
        saved_price_status=trip.price_status,
        travelers=trip.travelers,
    )


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
    # T24
    status: Literal["planned", "booked"] = "planned"
    booked_at: datetime | None = None
    rateable: bool = False  # the trip has ended: "Oceń wyjazd" (feeds the survey)
    pending: bool = False  # dates/party edited: cache-only price until POST /refresh finishes
    fit_label: str | None = None  # re-checked after an edit
    fit_summary: str | None = None


class TripsResponse(BaseModel):
    planned: list[TripItem]
    past: list[TripItem]  # booked trips + approved trips that have ended (rate them)
    max_watched: int


class DeleteResponse(BaseModel):
    id: str
    deleted_at: datetime  # POST /trips/{id}/restore undoes it


class TripPatch(BaseModel):
    """Edit one trip. Dates/party re-price it (the id changes with the dates); `status` books it
    ("booked": past list, no watching) or un-books it ("planned")."""

    start: date | None = None
    end: date | None = None
    travelers: int | None = Field(None, ge=1, le=MAX_PARTY)
    status: Literal["planned", "booked"] | None = None


class ApproveRequest(BaseModel):
    recommendation_id: str


class TargetRequest(BaseModel):
    target_pln: float | None = Field(None, gt=0, le=1_000_000)  # null clears it


def _party(flight: float | None, hotel: float | None, n: int) -> float | None:
    """What the whole party pays (tripai.scoring.party): flight x travellers + the stay."""
    return None if flight is None or hotel is None else round(party_total(flight, hotel, n), 2)


def item(trip: PlannedTrip | None, pick: SavedPick | None, today: date | None = None) -> TripItem:
    assert trip or pick
    base = trip or pick
    today = today or today_pl()
    booked = trip is not None and trip.status == "booked"
    pick = None if booked else pick  # a booked trip is no longer watched
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
        status="booked" if booked else "planned",
        booked_at=trip.booked_at if trip else None,
        rateable=trip is not None and base.end < today,
        pending=(trip.pending if trip else False) or (pick.pending if pick else False),
        fit_label=(trip.fit_label if trip else None) or (pick.fit_label if pick else None),
        fit_summary=(trip.fit_summary if trip else None) or (pick.fit_summary if pick else None),
    )


def split(trips: list[PlannedTrip], picks: list[SavedPick], today: date) -> TripsResponse:
    """Planned = approved (not booked/cancelled/deleted) + watched picks, one row per trip;
    past = booked trips (rateable once they end) + approved trips whose end date has passed.
    A watched pick that ended without being approved is dropped (it was never a plan, so there
    is nothing to rate). Deleted rows are hidden (they only wait for an undo)."""
    by_pick = {p.recommendation_id: p for p in picks if p.deleted_at is None}
    live = {
        t.recommendation_id: t for t in trips if t.status != "cancelled" and t.deleted_at is None
    }
    planned, past = [], []
    for rid, t in live.items():
        done = t.status in ("booked", "done") or t.end < today
        (past if done else planned).append(item(t, by_pick.get(rid), today))
    for rid, p in by_pick.items():
        if rid not in live and p.end >= today:
            planned.append(item(None, p, today))
    planned.sort(key=lambda i: (i.start, i.city))
    past.sort(key=lambda i: (i.end, i.city), reverse=True)
    return TripsResponse(planned=planned, past=past, max_watched=0)


def party_profile(profile: TasteProfile, travelers: int) -> TasteProfile:
    """The user's profile priced for `travelers` people (this trip only; the profile is unchanged).
    Children are kept up to n - 1, the rest are adults; a changed party gets the default rooms."""
    kids = min(profile.children, travelers - 1)
    same = profile.adults + profile.children == travelers
    return profile.model_copy(
        update={
            "adults": travelers - kids,
            "children": kids,
            "rooms": profile.rooms if same else None,
        }
    )


async def reprice(
    deps, uid: str, iata: str, start: date, end: date, travelers: int, *, fast: bool
) -> tuple[RankedRecommendation | None, TasteProfile]:
    """One trip through the normal pipeline (tripai.scoring.origins + rank, like /recommendations
    and the scan): every origin the user picked, only this city. `fast`: cache + Travelpayouts,
    never a new metered call; full: exact-date refinement within the SerpApi daily/request caps.
    The new card is stored for the session so its receipt and later approvals find it."""
    base = await deps.store.get_profile(uid) or TasteProfile(user_id=uid)
    profile = party_profile(base.model_copy(update={"user_id": uid}), travelers)
    stored = await deps.store.get_weights(uid) if profile.personalize else None
    weights = stored or Weights()
    typical = typical_spend(profile, await spend_history(deps.store, deps.notify, uid))
    params = inspect.signature(deps.provider.candidates).parameters
    extra: dict = {"only_iata": iata}
    if fast and "fast" in params and getattr(deps.provider, "supports_fast", False):
        extra["fast"] = True
    if "typical_spend_pln" in params:
        extra["typical_spend_pln"] = typical.pln
    win = FreeWindow(start=start, end=end, source="manual")
    cands = await candidates_for_origins(
        deps.provider, profile.origin_airports, [win], profile.luxury,
        profile=profile, weights=weights, **extra,
    )  # fmt: skip
    cands = [c for c in cands if c.iata == iata]
    recs = rank(cands, profile, weights, limit=1, typical_spend_pln=typical.pln)
    if not recs:
        return None, profile
    await deps.store.save_recommendations(uid, recs)
    return recs[0], profile


def price_fields(rec: RankedRecommendation) -> dict:
    """The approval's price columns from a (re)priced card."""
    return {
        "total_pln": rec.total_cost_pln,
        "flight_pln": rec.flight_cost_pln,
        "hotel_pln": rec.hotel_cost_pln,
        "price_status": rec.price_status,
        "travelers": rec.travelers,
    }


def trips_router(deps) -> APIRouter:
    """`deps` is the scan's ScanDeps (store, notify store, limits)."""
    r = APIRouter(tags=["trips"])
    notify = deps.notify

    def _today(today: date | None) -> date:
        return today or today_pl()

    def _find(
        uid: str, rid: str, deleted: bool = False
    ) -> tuple[PlannedTrip | None, SavedPick | None]:
        """The live trip/pick rows for `rid` (`deleted=True`: the soft-deleted ones, for undo)."""

        def ok(x) -> bool:
            return (x.deleted_at is not None) == deleted

        trips = notify.planned_trips(uid)
        trip = next((t for t in trips if t.recommendation_id == rid and ok(t)), None)
        pick = next((p for p in notify.picks(uid) if p.recommendation_id == rid and ok(p)), None)
        return trip, pick

    def _live(uid: str, rid: str) -> tuple[PlannedTrip | None, SavedPick | None]:
        trip, pick = _find(uid, rid)
        if trip is None and pick is None:
            raise HTTPException(404, "not one of your trips")
        return trip, pick

    last_refresh: dict[tuple[str, str], float] = {}

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
        trip, pick = await asyncio.to_thread(_live, uid, recommendation_id)
        if trip is not None and not_watched(trip):
            raise HTTPException(409, "this trip is booked: nothing left to watch")
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
        trip, pick = _live(uid, recommendation_id)
        if pick is not None:
            notify.remove_pick(uid, recommendation_id)
        return item(trip, None) if trip else None

    # ------------------------------------------------------------------ T24: delete + undo

    @r.delete("/trips/{recommendation_id}")
    def delete_trip(recommendation_id: str, uid: User) -> DeleteResponse:
        """Remove an approved or saved trip. A soft delete: it leaves My trips and the scan stops
        watching it at once (and frees its watch slot); POST /restore undoes it."""
        trip, pick = _live(uid, recommendation_id)
        at = now_utc()
        if trip is not None:
            notify.save_trip(trip.model_copy(update={"deleted_at": at}))
        if pick is not None:
            notify.patch_pick(uid, recommendation_id, {"deleted_at": at.isoformat()})
        return DeleteResponse(id=recommendation_id, deleted_at=at)

    @r.post("/trips/{recommendation_id}/restore")
    def restore_trip(recommendation_id: str, uid: User) -> TripItem:
        """Undo a delete: the trip, its price watch and its target come back as they were."""
        trip, pick = _find(uid, recommendation_id, deleted=True)
        if trip is None and pick is None:
            raise HTTPException(404, "nothing to restore")
        if trip is not None:
            trip = trip.model_copy(update={"deleted_at": None})
            notify.save_trip(trip)
        if pick is not None:
            pick = notify.patch_pick(
                uid, recommendation_id, {"deleted_at": None}
            ) or pick.model_copy(update={"deleted_at": None})
        return item(trip, pick)

    # ------------------------------------------------------------------ T24: edit + book

    @r.patch("/trips/{recommendation_id}")
    async def patch_trip(recommendation_id: str, req: TripPatch, uid: User) -> TripItem:
        """Book / un-book, or change the dates and/or party. A date or party change re-prices
        the trip from the cache at once (`pending`: shown as a pending estimate until
        POST /trips/{new id}/refresh confirms the exact-date price and re-checks the fit)."""
        trip, pick = await asyncio.to_thread(_live, uid, recommendation_id)
        base = trip or pick
        start, end = req.start or base.start, req.end or base.end
        travelers = req.travelers or base.travelers
        moved = (start, end, travelers) != (base.start, base.end, base.travelers)
        if moved:
            trip, pick = await _move(uid, trip, pick, start, end, travelers)
        if req.status is not None:
            trip, pick = await asyncio.to_thread(_set_status, uid, trip, pick, req.status)
        return item(trip, pick)

    def _set_status(uid: str, trip, pick, status: str):
        if status == "booked":
            if trip is None:  # a saved trip becomes a booked plan
                trip = PlannedTrip(
                    user_id=uid, recommendation_id=pick.recommendation_id, city=pick.city,
                    iata=pick.iata, start=pick.start, end=pick.end, total_pln=pick.first_pln,
                    flight_pln=pick.saved_flight_pln, hotel_pln=pick.saved_hotel_pln,
                    price_status=pick.saved_price_status, travelers=pick.travelers,
                    pending=pick.pending, fit_label=pick.fit_label, fit_summary=pick.fit_summary,
                )  # fmt: skip
            if trip.status != "booked":
                trip = trip.model_copy(update={"status": "booked", "booked_at": now_utc()})
                notify.save_trip(trip)
            if pick is not None:  # nothing left to buy: stop watching, free the slot
                notify.remove_pick(uid, pick.recommendation_id)
            return trip, None
        if trip is None or trip.status != "booked":
            return trip, pick  # already planned
        trip = trip.model_copy(update={"status": "planned", "booked_at": None})
        notify.save_trip(trip)
        if pick is None and trip.end >= today_pl() and _can_watch(uid, trip.recommendation_id):
            pick = pick_from_trip(trip)  # watching again, from the approved price
            notify.save_pick(pick)
        return trip, pick

    async def _move(uid: str, trip, pick, start: date, end: date, travelers: int):
        if trip is not None and trip.status == "booked":
            raise HTTPException(409, "un-book the trip before changing its dates")
        if start < today_pl():
            raise HTTPException(422, "the trip can't start in the past")
        if not 1 <= (end - start).days <= MAX_TRIP_NIGHTS:
            raise HTTPException(422, f"a trip is 1 to {MAX_TRIP_NIGHTS} nights")
        base = trip or pick
        rec, _ = await reprice(deps, uid, base.iata, start, end, travelers, fast=True)
        if rec is None:
            raise HTTPException(422, f"no price for {base.city} on these dates")
        new_id, old_id = rec.id, base.recommendation_id
        if new_id != old_id:
            t2, p2 = await asyncio.to_thread(_find, uid, new_id)
            if t2 is not None or p2 is not None:
                raise HTTPException(409, "you already have this trip on these dates")

        def write():
            nt = np = None
            fresh = {"pending": True, "fit_label": None, "fit_summary": None}
            if trip is not None:
                nt = trip.model_copy(
                    update={"recommendation_id": new_id, "start": rec.window.start,
                            "end": rec.window.end, **price_fields(rec), **fresh}
                )  # fmt: skip
                notify.save_trip(nt)
                if new_id != old_id:
                    notify.delete_trip(uid, old_id)
            if pick is not None:
                np = pick_from(uid, rec).model_copy(
                    update={"target_pln": pick.target_pln, "saved_at": pick.saved_at, **fresh}
                )
                if new_id != old_id:
                    notify.remove_pick(uid, old_id)
                notify.save_pick(np)
            return nt, np

        return await asyncio.to_thread(write)

    @r.post("/trips/{recommendation_id}/refresh")
    async def refresh_trip(recommendation_id: str, uid: User) -> TripItem:
        """The full re-price for an edited (pending) trip: exact-date refinement within the
        SerpApi caps (cache first), then the AI fit verdict re-checked against the Travel DNA.
        What it finds replaces the pending estimate; nothing found = the estimate stays labelled."""
        key = (uid, recommendation_id)
        now = time.monotonic()
        if now - last_refresh.get(key, -1e9) < REFRESH_MIN_INTERVAL_S:
            raise HTTPException(429, "just refreshed; try again in a few seconds",
                                headers={"Retry-After": "5"})  # fmt: skip
        last_refresh[key] = now
        trip, pick = await asyncio.to_thread(_live, uid, recommendation_id)
        if trip is not None and not_watched(trip):
            raise HTTPException(409, "this trip is booked: nothing left to price")
        base = trip or pick
        rec, profile = await reprice(
            deps, uid, base.iata, base.start, base.end, base.travelers, fast=False
        )
        fit = None
        if rec is not None and getattr(deps, "fit", None) is not None:
            try:
                fit = await deps.fit(rec, profile)
            except Exception as exc:  # noqa: BLE001 - no verdict is shown as "not judged yet"
                log.warning("fit re-check failed for %s: %s", rec.id, exc)
        verdict = {
            "fit_label": fit.label if fit else None,
            "fit_summary": fit.summary if fit else None,
        }

        def write():
            nt, np = trip, pick
            if rec is None:  # no price found now: keep the estimate, but it is no longer pending
                if nt is not None:
                    nt = nt.model_copy(update={"pending": False})
                    notify.save_trip(nt)
                if np is not None:
                    np = notify.patch_pick(uid, recommendation_id, {"pending": False}) or np
                return nt, np
            if nt is not None:
                upd = {"pending": False, **verdict}
                if trip.pending:  # the cache-only price was a placeholder: this is the price
                    upd |= price_fields(rec)
                nt = nt.model_copy(update=upd)
                notify.save_trip(nt)
            if np is not None:
                fields = {
                    "pending": False,
                    **verdict,
                    "last_pln": rec.total_cost_pln,
                    "last_flight_pln": rec.flight_cost_pln,
                    "last_hotel_pln": rec.hotel_cost_pln,
                    "last_travelers": rec.travelers,
                    "last_price_status": rec.price_status,
                    "last_checked_at": now_utc().isoformat(),
                }
                if pick.pending:
                    fields |= {
                        "saved_pln": rec.total_cost_pln,
                        "saved_flight_pln": rec.flight_cost_pln,
                        "saved_hotel_pln": rec.hotel_cost_pln,
                        "saved_price_status": rec.price_status,
                        "baseline_pln": rec.total_cost_pln,
                    }
                np = notify.patch_pick(uid, recommendation_id, fields) or np.model_copy(
                    update=fields
                )
            return nt, np

        return item(*await asyncio.to_thread(write))

    return r
