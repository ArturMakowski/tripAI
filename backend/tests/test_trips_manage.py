"""T24 "manage my trips" (docs/USER_TESTING.md round 4): delete with undo, edit dates/party
(re-price + fit re-check), mark as booked. Offline: FixtureProvider, memory stores, fake push."""

import json
from datetime import date

import httpx
import pytest
from test_notify import PROFILE, TODAY, ScaledProvider, make, scan

from tripai.api import trips as trips_api
from tripai.models import FitVerdict
from tripai.notify.store import SupabaseNotifyStore
from tripai.scoring import FixtureProvider

DAY = date.fromisoformat(TODAY)  # 2026-10-20: "today" for the API (fixture trips are Nov-Jan)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("TRIPAI_SCAN_MIN_INTERVAL_S", "0")
    monkeypatch.setenv("TRIPAI_SCAN_PER_MIN", "1000")
    monkeypatch.setattr(trips_api, "today_pl", lambda: DAY)
    monkeypatch.setattr(trips_api, "REFRESH_MIN_INTERVAL_S", 0.0)


def recs(c, n=3, profile=PROFILE):
    return c.post("/recommendations", json={"profile": profile, "today": TODAY, "limit": n}).json()


def trips(c, today=TODAY):
    r = c.get("/trips", params={"today": today})
    assert r.status_code == 200, r.text
    return r.json()


def ids(items):
    return [i["id"] for i in items]


def shift(rid: str, days: int) -> tuple[str, str]:
    """The trip's dates moved by `days` (ISO start, end)."""
    from datetime import timedelta

    s = date.fromisoformat(f"{rid[4:8]}-{rid[8:10]}-{rid[10:12]}") + timedelta(days)
    e = date.fromisoformat(f"{rid[13:17]}-{rid[17:19]}-{rid[19:21]}") + timedelta(days)
    return s.isoformat(), e.isoformat()


# ---------------------------------------------------------------------------- delete + undo


def test_delete_then_undo_restores_everything():
    c, _, _ = make()
    r = recs(c)
    a, s = r[0]["id"], r[1]["id"]
    c.post("/trips", json={"recommendation_id": a})
    c.put(f"/trips/{a}/target", json={"target_pln": 777})
    c.post("/picks", json={"recommendation_id": s})

    gone = c.delete(f"/trips/{a}")
    assert gone.status_code == 200 and gone.json()["id"] == a
    assert ids(trips(c)["planned"]) == [s]
    assert [p["recommendation_id"] for p in c.get("/picks").json()] == [s]  # a is not watched
    assert c.put(f"/trips/{a}/target", json={"target_pln": 1}).status_code == 404

    back = c.post(f"/trips/{a}/restore").json()
    assert back["kind"] == "approved" and back["watched"] and back["target_pln"] == 777
    assert sorted(ids(trips(c)["planned"])) == sorted([a, s])
    assert c.post(f"/trips/{a}/restore").status_code == 404  # nothing left to undo

    c.delete(f"/trips/{s}")  # a saved-only trip too
    assert ids(trips(c)["planned"]) == [a]
    assert c.post(f"/trips/{s}/restore").json()["kind"] == "saved"
    assert c.delete("/trips/nope").status_code == 404


def test_delete_frees_the_watch_slot(monkeypatch):
    monkeypatch.setenv("TRIPAI_MAX_PICKS", "1")
    c, _, _ = make()
    r = recs(c)
    c.post("/picks", json={"recommendation_id": r[0]["id"]})
    assert c.post("/picks", json={"recommendation_id": r[1]["id"]}).status_code == 409
    c.delete(f"/trips/{r[0]['id']}")
    assert c.post("/picks", json={"recommendation_id": r[1]["id"]}).status_code == 200


def test_scan_skips_deleted_trips():
    provider = ScaledProvider()
    c, _, _ = make(provider=provider)
    rid = recs(c)[1]["id"]
    c.put("/notifications/prefs", json={"max_per_week": 50})
    c.post("/trips", json={"recommendation_id": rid})
    c.put(f"/trips/{rid}/target", json={"target_pln": 99999})
    c.delete(f"/trips/{rid}")
    provider.factor = 0.7
    out = scan(c)
    watched = {d["recommendation_id"] for d in out["run"]["decisions"]
               if d["kind"] in ("price_drop", "target_price")}  # fmt: skip
    assert rid not in watched
    assert not [n for n in out["notifications"] if n["kind"] in ("price_drop", "target_price")]


# ---------------------------------------------------------------------------- booked


def test_book_moves_to_past_and_stops_watching():
    provider = ScaledProvider()
    c, notify, _ = make(provider=provider)
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    c.put(f"/trips/{rid}/target", json={"target_pln": 99999})
    it = c.patch(f"/trips/{rid}", json={"status": "booked"}).json()
    assert it["status"] == "booked" and it["booked_at"] and not it["watched"]
    assert it["target_pln"] is None and it["rateable"] is False  # not over yet
    out = trips(c)
    assert out["planned"] == [] and ids(out["past"]) == [rid]
    assert c.get("/picks").json() == []
    assert c.put(f"/trips/{rid}/target", json={"target_pln": 1}).status_code == 409
    assert c.post(f"/trips/{rid}/refresh").status_code == 409

    # the scan never re-prices a booked trip, even if a watch row lingers (e.g. another replica)
    uid = c.get("/session").json()["user_id"]
    pick = trips_api.pick_from_trip(notify.planned_trips(uid)[0])
    notify.save_pick(pick.model_copy(update={"target_pln": 99999}))
    provider.factor = 0.7
    out = scan(c)
    assert rid not in {d["recommendation_id"] for d in out["run"]["decisions"]
                       if d["kind"] in ("price_drop", "target_price")}  # fmt: skip

    # after the trip it can be rated
    end = f"{rid[13:17]}-{rid[17:19]}-{rid[19:21]}"
    after = trips(
        c, today=f"{end[:8]}{int(end[8:]) + 1:02d}" if int(end[8:]) < 28 else "2027-02-01"
    )
    assert after["past"][0]["rateable"] is True


def test_unbook_watches_again_and_saved_trips_can_be_booked():
    c, _, _ = make()
    r = recs(c)
    a, s = r[0]["id"], r[1]["id"]
    c.post("/trips", json={"recommendation_id": a})
    c.patch(f"/trips/{a}", json={"status": "booked"})
    back = c.patch(f"/trips/{a}", json={"status": "planned"}).json()
    assert back["status"] == "planned" and back["watched"] and back["booked_at"] is None
    assert ids(trips(c)["planned"]) == [a]

    c.post("/picks", json={"recommendation_id": s})
    booked = c.patch(f"/trips/{s}", json={"status": "booked"}).json()
    assert booked["kind"] == "approved" and booked["status"] == "booked"
    assert booked["saved_pln"] == r[1]["total_cost_pln"]
    assert ids(trips(c)["past"]) == [s]


# ---------------------------------------------------------------------------- edit dates / party


async def good_fit(rec, profile):
    return FitVerdict(label="good_fit", confidence=0.8, summary="Food and history, calm month",
                      model="rules")  # fmt: skip


def test_edit_dates_reprices_pending_then_refresh_confirms():
    c, _, _ = make()
    c.app.state.scan_deps.fit = good_fit
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    c.put(f"/trips/{rid}/target", json={"target_pln": 900})
    start, end = shift(rid, 1)

    it = c.patch(f"/trips/{rid}", json={"start": start, "end": end}).json()
    new = it["id"]
    assert new != rid and new.startswith(rid[:3]) and it["start"] == start and it["end"] == end
    assert it["pending"] is True and it["fit_label"] is None  # cache-only until refreshed
    assert it["target_pln"] == 900 and it["watched"] and it["kind"] == "approved"
    assert it["checked_at"] is None  # no old price shown as this trip's latest check
    assert ids(trips(c)["planned"]) == [new]
    assert c.delete(f"/trips/{rid}").status_code == 404  # the old dates are gone

    done = c.post(f"/trips/{new}/refresh").json()
    assert done["pending"] is False and done["fit_label"] == "good_fit"
    assert done["checked_at"] and done["current_pln"] == done["saved_pln"]
    assert done["fit_summary"] == "Food and history, calm month"
    # the new card is stored for the session: its receipt (and approvals) find it
    assert c.post("/picks", json={"recommendation_id": new}).status_code == 200


def test_edit_party_uses_the_party_money_model():
    c, _, _ = make()
    r = recs(c)[0]
    c.post("/trips", json={"recommendation_id": r["id"]})
    it = c.patch(f"/trips/{r['id']}", json={"travelers": 2}).json()
    assert it["id"] == r["id"] and it["travelers"] == 2 and it["pending"]
    assert it["saved_party_pln"] == pytest.approx(
        it["saved_flight_pln"] * 2 + it["saved_hotel_pln"]
    )
    # 2 people share 1 room (the whole stay): flights double, the stay doesn't, per person drops
    assert it["saved_hotel_pln"] == r["hotel_cost_pln"]
    assert it["saved_pln"] == pytest.approx(it["saved_party_pln"] / 2)
    assert it["saved_pln"] < r["total_cost_pln"]


def test_edit_validation():
    c, _, _ = make()
    r = recs(c)
    a = r[0]["id"]
    c.post("/trips", json={"recommendation_id": a})
    s, _ = shift(a, 0)
    assert c.patch(f"/trips/{a}", json={"end": s}).status_code == 422  # 0 nights
    assert c.patch(f"/trips/{a}", json={"start": "2026-10-01"}).status_code == 422  # the past
    assert c.patch(f"/trips/{a}", json={"travelers": 13}).status_code == 422
    assert c.patch("/trips/nope", json={"travelers": 2}).status_code == 404
    # moving onto another trip of yours is refused, not merged
    s1, e1 = shift(a, 1)
    moved = c.patch(f"/trips/{a}", json={"start": s1, "end": e1}).json()["id"]
    c.post("/trips", json={"recommendation_id": a})  # the original dates again
    assert c.patch(f"/trips/{a}", json={"start": s1, "end": e1}).status_code == 409
    assert sorted(ids(trips(c)["planned"])) == sorted([a, moved])
    c.patch(f"/trips/{a}", json={"status": "booked"})
    s2, e2 = shift(a, 2)
    assert c.patch(f"/trips/{a}", json={"start": s2, "end": e2}).status_code == 409  # booked


def test_refresh_rate_limited(monkeypatch):
    monkeypatch.setattr(trips_api, "REFRESH_MIN_INTERVAL_S", 60.0)
    c, _, _ = make()
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    assert c.post(f"/trips/{rid}/refresh").status_code == 200
    assert c.post(f"/trips/{rid}/refresh").status_code == 429


class OneCityProvider(FixtureProvider):
    """Records `only_iata`: an edited or watched trip prices its own city, not the shortlist."""

    seen: list

    async def candidates(self, origin, windows, luxury=None, *, profile=None, weights=None,
                         typical_spend_pln=None, only_iata=None, fast=False):  # fmt: skip
        self.seen.append((only_iata, fast))
        out = await super().candidates(origin, windows, *(x for x in [luxury] if x),
                                       profile=profile)  # fmt: skip
        return [c for c in out if only_iata is None or c.iata == only_iata]


def test_reprice_and_scan_price_one_city():
    provider = OneCityProvider()
    provider.seen = []
    provider.supports_fast = True
    c, _, _ = make(provider=provider)
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    provider.seen.clear()
    c.patch(f"/trips/{rid}", json={"travelers": 2})
    assert provider.seen == [(rid[:3], True)]  # cache first
    provider.seen.clear()
    c.post(f"/trips/{rid}/refresh")
    assert provider.seen == [(rid[:3], False)]  # then the full pipeline
    provider.seen.clear()
    scan(c)
    assert (rid[:3], False) in provider.seen  # the scan's watched-pick re-price too


# ---------------------------------------------------------------------------- supabase before 0007


def test_supabase_delete_before_migration_0007_stays_deleted_here():
    """Without the 0007 columns the soft delete can't reach Supabase; this process keeps it,
    so the trip stays hidden and unwatched (and the scan skips it) until 0007 is applied."""
    sent: list[httpx.Request] = []
    pick_row = {"user_id": "u1", "recommendation_id": "FCO-20270114-20270118", "city": "Rome",
                "iata": "FCO", "start": "2027-01-14", "end": "2027-01-18", "baseline_pln": 900,
                "baseline_source": "s", "baseline_fetched_at": "2026-10-03T08:00:00+00:00",
                "saved_at": "2026-10-03T08:00:00+00:00", "target_pln": 800}  # fmt: skip

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(req)
        body = json.loads(req.content) if req.content else None
        row = body[0] if isinstance(body, list) else body
        if row and {"deleted_at", "pending", "fit_label", "booked_at"} & set(row):
            return httpx.Response(400, json={"code": "PGRST204", "message": "no column"})
        if req.method == "GET":
            return httpx.Response(200, json=[pick_row])
        if req.method == "PATCH":
            return httpx.Response(200, json=[{**pick_row, **row}])
        return httpx.Response(201)

    store = SupabaseNotifyStore("https://x.supabase.co", "k",
                                client=httpx.Client(transport=httpx.MockTransport(handler)))  # fmt: skip
    (pick,) = store.picks("u1")
    store.save_pick(pick)  # memory copy (as after POST /picks)
    assert sent[-1].method == "POST" and "deleted_at" not in json.loads(sent[-1].content)[0]
    store.patch_pick("u1", pick.recommendation_id, {"deleted_at": "2026-10-04T10:00:00+00:00"})
    (again,) = store.picks("u1")
    assert again.deleted_at is not None and again.target_pln == 800
