"""T13 "My trips": approvals, watched picks with their latest check, target-price alerts.
Offline: FixtureProvider (scaled to simulate fares moving), memory stores, fake push."""

import json

import httpx
import pytest
from test_notify import PROFILE, TODAY, ScaledProvider, make, scan

from tripai.api.trips import split
from tripai.models import Weights
from tripai.notify.models import PlannedTrip, SavedPick, now_utc
from tripai.notify.rules import draft_price_drop, draft_target_price
from tripai.notify.store import SupabaseNotifyStore
from tripai.scoring import rank
from tripai.workflows import scan as scan_mod


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    monkeypatch.setenv("TRIPAI_SCAN_MIN_INTERVAL_S", "0")
    monkeypatch.setenv("TRIPAI_SCAN_PER_MIN", "1000")


def recs(c, n=3):
    body = {"profile": PROFILE, "today": TODAY, "limit": n}
    return c.post("/recommendations", json=body).json()


def trips(c, today=TODAY):
    r = c.get("/trips", params={"today": today})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------- rules


def test_target_rule_exact_only(profile, windows, candidates):
    rec = rank(candidates, profile, Weights())[0]
    now = rec.total_cost_pln
    assert draft_target_price(rec, now - 1)[0] is None  # above target
    d, dec = draft_target_price(rec, now)  # at target: fires
    assert d and dec.notify and d.kind == "target_price"
    assert d.dedupe_key == f"target_price:{rec.id}:{now:.0f}"
    est = rec.model_copy(update={"price_status": "estimate"})
    assert draft_target_price(est, now * 2)[0] is None  # an estimate never triggers
    assert "never alerts" in draft_target_price(est, now * 2)[1].reason
    # same honesty for the 15% price-drop rule
    assert draft_price_drop(est, now * 2)[0] is None
    assert draft_price_drop(rec.model_copy(update={"price_status": "partial"}), now * 2)[0] is None


def test_target_text_pl_and_en(profile, windows, candidates):
    from tripai import i18n

    rec = rank(candidates, profile, Weights())[0]
    with i18n.using("pl"):
        d, _ = draft_target_price(rec, 99999)
    assert d.title.startswith("Twoja cena:") and "Twój cel" in d.body and "zł" in d.body
    with i18n.using("en"):
        d, _ = draft_target_price(rec, 99999)
    assert d.title.startswith("Your price:") and "your target" in d.body and "PLN" in d.body


# ---------------------------------------------------------------------------- API


def test_empty_trips():
    c, _, _ = make()
    assert trips(c) == {"planned": [], "past": [], "max_watched": 5}


def test_approve_persists_and_watches():
    c, notify, _ = make()
    r = recs(c)
    assert c.post("/trips", json={"recommendation_id": "nope"}).status_code == 404
    it = c.post("/trips", json={"recommendation_id": r[0]["id"]}).json()
    assert it["kind"] == "approved" and it["watched"] is True
    assert it["saved_pln"] == r[0]["total_cost_pln"] and it["current_pln"] is None
    # a swipe-saved pick shows up too, one row per trip
    c.post("/picks", json={"recommendation_id": r[1]["id"]})
    c.post("/picks", json={"recommendation_id": r[0]["id"]})  # already approved: no duplicate
    out = trips(c)
    assert sorted((i["id"], i["kind"]) for i in out["planned"]) == sorted(
        [(r[0]["id"], "approved"), (r[1]["id"], "saved")]
    )
    assert out["past"] == []
    uid = c.get("/session").json()["user_id"]
    assert [t.recommendation_id for t in notify.planned_trips(uid)] == [r[0]["id"]]
    # re-approving keeps the first approval
    first = notify.planned_trips(uid)[0].approved_at
    c.post("/trips", json={"recommendation_id": r[0]["id"]})
    assert notify.planned_trips(uid)[0].approved_at == first


def test_past_trips_and_expired_picks():
    c, _, _ = make()
    r = recs(c, 2)
    c.post("/trips", json={"recommendation_id": r[0]["id"]})
    c.post("/picks", json={"recommendation_id": r[1]["id"]})
    after = max(r[0]["window"]["end"], r[1]["window"]["end"])
    out = trips(c, today=after[:8] + "28")  # a day well after both trips (fixture: Jan 2027)
    assert [i["id"] for i in out["past"]] == [r[0]["id"]]  # approved -> rate it
    assert out["planned"] == []  # a watched pick that ended was never a plan


def test_scan_records_latest_check_and_change_since_saved():
    provider = ScaledProvider()
    c, _, _ = make(provider=provider)
    r = recs(c)
    c.post("/trips", json={"recommendation_id": r[1]["id"]})
    provider.factor = 0.9  # -10%: below the 15% price-drop rule, but "My trips" shows it
    scan(c)
    it = next(i for i in trips(c)["planned"] if i["id"] == r[1]["id"])
    assert it["price_status"] == "exact" and it["checked_at"]
    assert it["current_pln"] < it["saved_pln"]
    assert it["change_pln"] == pytest.approx(it["current_pln"] - it["saved_pln"])


def test_target_price_alert_once_then_rearm():
    provider = ScaledProvider()
    c, _, _ = make(provider=provider)
    r = recs(c)
    rid = r[1]["id"]
    c.put("/notifications/prefs", json={"max_per_week": 50})  # the weekly cap applies too
    c.post("/trips", json={"recommendation_id": rid})
    saved = r[1]["total_cost_pln"]
    assert c.put(f"/trips/{rid}/target", json={"target_pln": 0}).status_code == 422
    assert c.put("/trips/nope/target", json={"target_pln": 100}).status_code == 404
    it = c.put(f"/trips/{rid}/target", json={"target_pln": round(saved * 0.95)}).json()
    assert it["target_pln"] == round(saved * 0.95)

    out = scan(c)  # unchanged price: above target
    assert not [n for n in out["notifications"] if n["kind"] == "target_price"]
    dec = [d for d in out["run"]["decisions"] if d["kind"] == "target_price"]
    assert dec and "> target" in dec[0]["reason"]

    provider.factor = 0.8  # -20%: target reached; one alert, not also a price_drop
    out = scan(c)
    hits = [n for n in out["notifications"] if n["kind"] == "target_price"]
    assert len(hits) == 1 and hits[0]["recommendation_id"] == rid
    assert not [n for n in out["notifications"] if n["kind"] == "price_drop"]
    assert hits[0]["title"].startswith("Your price:")
    assert not [n for n in scan(c)["notifications"] if n["kind"] == "target_price"]  # no repeat

    now = hits[0]["recommendation"]["total_cost_pln"]
    c.put(f"/trips/{rid}/target", json={"target_pln": now})  # a new target re-arms
    assert [n["kind"] for n in scan(c)["notifications"]].count("target_price") == 1
    assert c.put(f"/trips/{rid}/target", json={"target_pln": None}).json()["target_pln"] is None


def test_target_alert_in_polish():
    provider = ScaledProvider()
    c, _, _ = make(provider=provider)
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    c.put(f"/trips/{rid}/target", json={"target_pln": 99999})
    out = scan(c, lang="pl")
    hit = next(n for n in out["notifications"] if n["kind"] == "target_price")
    assert hit["title"].startswith("Twoja cena:") and "zł" in hit["body"]


def test_estimate_never_triggers_target(monkeypatch):
    real_rank = scan_mod.rank

    def estimating(*a, **kw):
        return [r.model_copy(update={"price_status": "estimate"}) for r in real_rank(*a, **kw)]

    monkeypatch.setattr(scan_mod, "rank", estimating)
    c, _, _ = make()
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    c.put(f"/trips/{rid}/target", json={"target_pln": 99999})
    out = scan(c)
    assert not [n for n in out["notifications"] if n["kind"] in ("target_price", "price_drop")]
    it = trips(c)["planned"][0]
    assert it["price_status"] == "estimate" and it["change_pln"] is None  # shown, not compared


def test_target_on_unwatched_approval_respects_cap(monkeypatch):
    monkeypatch.setenv("TRIPAI_MAX_PICKS", "1")
    c, _, _ = make()
    r = recs(c)
    c.post("/picks", json={"recommendation_id": r[0]["id"]})
    it = c.post("/trips", json={"recommendation_id": r[1]["id"]}).json()
    assert it["watched"] is False  # cap reached: approved, not re-priced
    assert c.put(f"/trips/{r[1]['id']}/target", json={"target_pln": 100}).status_code == 409
    c.delete(f"/picks/{r[0]['id']}")
    it = c.put(f"/trips/{r[1]['id']}/target", json={"target_pln": 100}).json()
    assert it["watched"] is True and it["target_pln"] == 100


def test_target_set_mid_scan_survives_the_price_check():
    """The scan writes its check as a partial update, never a stale full row."""
    provider = ScaledProvider()
    c, notify, _ = make(provider=provider)
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    uid = c.get("/session").json()["user_id"]
    real = notify.patch_pick

    def racing(user_id, rec_id, fields):
        if "last_checked_at" in fields:  # the user sets a target while the scan runs
            real(user_id, rec_id, {"target_pln": 1234.0})
        return real(user_id, rec_id, fields)

    notify.patch_pick = racing
    scan(c)
    pick = notify.picks(uid)[0]
    assert pick.target_pln == 1234.0 and pick.last_checked_at is not None


def test_started_trips_are_not_repriced():
    c, _, _ = make()
    rid = recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    first_day = f"{rid[4:8]}-{rid[8:10]}-{rid[10:12]}"
    scan(c, today=first_day)
    it = trips(c, today=first_day)["planned"][0]
    assert it["id"] == rid and it["checked_at"] is None  # not re-priced once it started


def test_old_pick_rows_and_resave_keep_history():
    c, _, _ = make()
    r = recs(c)
    rid = r[0]["id"]
    c.post("/picks", json={"recommendation_id": rid})
    c.put(f"/trips/{rid}/target", json={"target_pln": 500})
    c.post("/picks", json={"recommendation_id": rid})  # swipe again: target kept
    assert trips(c)["planned"][0]["target_pln"] == 500
    legacy = SavedPick(user_id="u", recommendation_id="X", city="Rome", iata="FCO",
                       start="2027-01-14", end="2027-01-18", baseline_pln=900,
                       baseline_source="s", baseline_fetched_at=now_utc())  # fmt: skip
    assert legacy.first_pln == 900  # rows from before 0006: saved = baseline


def test_split_orders_and_skips_cancelled():
    from datetime import date

    def trip(rid, start, end, status="planned"):
        return PlannedTrip(user_id="u", recommendation_id=rid, city=rid, iata="FCO", start=start,
                           end=end, total_pln=1000, status=status)  # fmt: skip

    out = split(
        [trip("B", "2027-02-01", "2027-02-05"), trip("A", "2027-01-01", "2027-01-05"),
         trip("C", "2026-08-01", "2026-08-05"), trip("D", "2027-03-01", "2027-03-03", "cancelled")],
        [],
        date(2026, 10, 3),
    )  # fmt: skip
    assert [i.id for i in out.planned] == ["A", "B"]
    assert [i.id for i in out.past] == ["C"]


# ---------------------------------------------------------------------------- supabase


def test_supabase_trips_and_pick_patch():
    sent: list[httpx.Request] = []
    trip_row = {"id": "x", "user_id": "u1", "recommendation_id": "FCO-20270114-20270118",
                "city": "Rome", "country": "Italy", "iata": "FCO", "start": "2027-01-14",
                "end": "2027-01-18", "total_pln": 1200, "price_status": "exact", "travelers": 2,
                "status": "planned", "approved_at": "2026-10-03T08:00:00+00:00",
                "created_at": "2026-10-03T08:00:00+00:00"}  # fmt: skip
    pick_row = {"user_id": "u1", "recommendation_id": "FCO-20270114-20270118", "city": "Rome",
                "iata": "FCO", "start": "2027-01-14", "end": "2027-01-18", "baseline_pln": 1200,
                "baseline_source": "s", "baseline_fetched_at": "2026-10-03T08:00:00+00:00",
                "saved_at": "2026-10-03T08:00:00+00:00", "saved_pln": None,
                "saved_price_status": "exact", "travelers": 2, "target_pln": 1000,
                "last_pln": None, "last_price_status": None, "last_checked_at": None}  # fmt: skip

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(req)
        if req.method == "GET" and req.url.path.endswith("/trips"):
            return httpx.Response(200, json=[trip_row])
        if req.method == "PATCH":
            return httpx.Response(200, json=[{**pick_row, **json.loads(req.content)}])
        return httpx.Response(201)

    store = SupabaseNotifyStore("https://x.supabase.co", "k",
                                client=httpx.Client(transport=httpx.MockTransport(handler)))  # fmt: skip
    t = store.planned_trips("u1")
    assert t[0].city == "Rome" and t[0].travelers == 2
    get = next(r for r in sent if r.method == "GET")
    assert get.url.params["approved_at"] == "not.is.null"
    store.save_trip(t[0])
    post = next(r for r in sent if r.method == "POST")
    assert post.url.path == "/rest/v1/trips"
    assert post.url.params["on_conflict"] == "user_id,recommendation_id"
    p = store.patch_pick("u1", "FCO-20270114-20270118", {"target_pln": 950.0})
    patch = next(r for r in sent if r.method == "PATCH")
    assert json.loads(patch.content) == {"target_pln": 950.0}  # only the patched column
    assert patch.url.params["recommendation_id"] == "eq.FCO-20270114-20270118"
    assert p.target_pln == 950.0 and p.first_pln == 1200


# ---------------------------------------------------------------------------- review fixes (PR #34)


def _ended_pick(uid: str, rid: str = "BCN-20260812-20260817") -> SavedPick:
    return SavedPick(user_id=uid, recommendation_id=rid, city="Barcelona", iata="BCN",
                     start="2026-08-12", end="2026-08-17", baseline_pln=900,
                     baseline_source="s", baseline_fetched_at=now_utc())  # fmt: skip


def test_ended_picks_release_watch_slots(monkeypatch):
    """#1: a trip that has ended no longer holds one of the TRIPAI_MAX_PICKS slots."""
    monkeypatch.setenv("TRIPAI_MAX_PICKS", "1")
    c, notify, _ = make()
    r = recs(c)
    uid = c.get("/session").json()["user_id"]
    notify.save_pick(_ended_pick(uid))  # Aug 2026: before today
    assert c.post("/picks", json={"recommendation_id": r[0]["id"]}).status_code == 200
    it = c.post("/trips", json={"recommendation_id": r[0]["id"]}).json()
    assert it["watched"] is True
    assert c.post("/picks", json={"recommendation_id": r[1]["id"]}).status_code == 409  # 1 live


def test_scan_skips_ended_picks_before_the_cap(monkeypatch):
    monkeypatch.setenv("TRIPAI_MAX_PICKS", "1")
    c, notify, _ = make()
    rid = recs(c)[0]["id"]
    uid = c.get("/session").json()["user_id"]
    c.post("/picks", json={"recommendation_id": rid})
    ended = _ended_pick(uid).model_copy(update={"saved_at": now_utc()})  # newest: sorts first
    notify.save_pick(ended)
    out = scan(c)
    priced = {d["recommendation_id"] for d in out["run"]["decisions"] if d["kind"] == "price_drop"}
    assert rid in priced and ended.recommendation_id not in priced


def test_stop_watching():
    c, _, _ = make()
    r = recs(c)
    a, s = r[0]["id"], r[1]["id"]
    c.post("/trips", json={"recommendation_id": a})
    c.put(f"/trips/{a}/target", json={"target_pln": 500})
    c.post("/picks", json={"recommendation_id": s})
    it = c.delete(f"/trips/{a}/watch").json()  # approved: stays, unwatched, no target
    assert it["kind"] == "approved" and it["watched"] is False and it["target_pln"] is None
    assert c.delete(f"/trips/{s}/watch").json() is None  # saved only: leaves the list
    assert [i["id"] for i in trips(c)["planned"]] == [a]
    assert c.get("/picks").json() == []
    assert c.delete("/trips/nope/watch").status_code == 404


def test_supabase_pick_writes_before_migration_0006():
    """#3: without the 0006 columns the watch and its baseline are still persisted."""
    sent: list[httpx.Request] = []
    new_cols = {"saved_pln", "saved_price_status", "travelers", "target_pln", "last_pln",
                "last_price_status", "last_checked_at"}  # fmt: skip

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(req)
        body = json.loads(req.content) if req.content else None
        row = body[0] if isinstance(body, list) else body
        if row and new_cols & set(row):
            return httpx.Response(400, json={"code": "PGRST204",
                                             "message": "Could not find the 'saved_pln' column"})  # fmt: skip
        if req.method == "PATCH":
            return httpx.Response(200, json=[])
        return httpx.Response(201)

    store = SupabaseNotifyStore("https://x.supabase.co", "k",
                                client=httpx.Client(transport=httpx.MockTransport(handler)))  # fmt: skip
    pick = _ended_pick("u1").model_copy(update={"saved_pln": 900.0, "target_pln": 800.0})
    store.save_pick(pick)
    *_, retry = sent  # full row (0007), then the 0006 columns, then the 0003 ones
    assert len(sent) == 3 and {r.method for r in sent} == {"POST"}
    legacy = json.loads(retry.content)[0]
    assert "saved_pln" not in legacy and legacy["baseline_pln"] == 900
    sent.clear()
    assert store.patch_pick("u1", pick.recommendation_id, {"target_pln": 700.0}).target_pln == 700
    assert len(sent) == 1  # only 0006 columns: nothing to retry, memory keeps the target
    sent.clear()
    store.patch_pick("u1", pick.recommendation_id,
                     {"baseline_pln": 850.0, "last_pln": 850.0,
                      "last_checked_at": now_utc().isoformat()})  # fmt: skip
    assert [json.loads(r.content) for r in sent][1] == {"baseline_pln": 850.0}


# ---------------------------------------------------------------------------- party money (#38/#40)

PARTY = {**PROFILE, "adults": 2}


def party_recs(c, n=3):
    body = {"profile": PARTY, "today": TODAY, "limit": n}
    return c.post("/recommendations", json=body).json()


def test_party_money_model_on_my_trips():
    """Flight per traveller, hotel = the whole stay, party = flight x n + hotel, per person =
    party / n == total_cost_pln: My trips carries the same lines as the card."""
    provider = ScaledProvider()
    c, _, _ = make(provider=provider)
    r = party_recs(c)[0]
    assert r["travelers"] == 2
    it = c.post("/trips", json={"recommendation_id": r["id"]}).json()
    assert it["travelers"] == 2
    assert it["saved_flight_pln"] == r["flight_cost_pln"]
    assert it["saved_hotel_pln"] == r["hotel_cost_pln"]
    party = r["flight_cost_pln"] * 2 + r["hotel_cost_pln"]
    assert it["saved_party_pln"] == pytest.approx(party)
    assert it["saved_pln"] == pytest.approx(r["total_cost_pln"]) == pytest.approx(party / 2, abs=1)

    provider.factor = 0.9
    scan(c, profile=PARTY)
    cur = trips(c)["planned"][0]
    assert cur["current_travelers"] == 2
    want = cur["current_flight_pln"] * 2 + cur["current_hotel_pln"]
    assert cur["current_party_pln"] == pytest.approx(want)
    assert cur["change_pln"] == pytest.approx(cur["current_pln"] - cur["saved_pln"])
    assert cur["change_pln"] < 0


def test_party_size_change_is_not_a_price_change():
    """Saved for 2, re-priced for 1: different trips, so no "since saved" comparison."""
    c, _, _ = make()
    rid = party_recs(c)[0]["id"]
    c.post("/trips", json={"recommendation_id": rid})
    scan(c, profile=PROFILE)  # the profile is now 1 traveller
    it = trips(c)["planned"][0]
    assert it["travelers"] == 2 and it["current_travelers"] == 1
    assert it["current_pln"] is not None and it["change_pln"] is None


def test_target_alert_party_text_pl():
    c, _, _ = make()
    r = party_recs(c)[0]
    c.post("/trips", json={"recommendation_id": r["id"]})
    c.put(f"/trips/{r['id']}/target", json={"target_pln": 99999})
    out = scan(c, profile=PARTY, lang="pl")
    hit = next(n for n in out["notifications"] if n["kind"] == "target_price")
    rec = hit["recommendation"]
    assert "/os." in hit["body"] and "loty 2 ×" in hit["body"] and "razem dla 2 os." in hit["body"]
    group = rec["flight_cost_pln"] * 2 + rec["hotel_cost_pln"]
    assert f"{group:,.0f}".replace(",", " ") in hit["body"].replace(" ", " ")
