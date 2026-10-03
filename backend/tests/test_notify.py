"""T5b: proactive scan + notifications. Offline: FixtureProvider, fake push sender, no DBOS."""

import asyncio
import json
import re
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.models import FitPoint, FitVerdict, TasteProfile, Weights
from tripai.notify import vapid
from tripai.notify.models import NotificationPrefs
from tripai.notify.push import VapidConfig, WebPusher, generate_vapid_keys
from tripai.notify.rules import (
    Draft,
    apply_user_control,
    draft_long_weekend,
    draft_new_top,
    draft_price_drop,
    gate,
)
from tripai.notify.store import MemoryNotifyStore, SupabaseNotifyStore
from tripai.scoring import FixtureCalendar, FixtureProvider, long_weekends, rank
from tripai.workflows import runtime
from tripai.workflows.scan import ScanDeps, scan_body

PROFILE = {"user_id": "u1", "budget_pln": 2500, "interests": {"food": 0.9, "history": 0.7}}
TODAY = "2026-10-20"  # Nov 7-11 (św. Marcina bridge) starts 18 days later


class ScaledProvider(FixtureProvider):
    """Fixture prices times `factor` (flight + hotel + their evidence), to simulate a fare drop."""

    factor = 1.0

    async def candidates(self, origin, windows, luxury=None, **kw):
        out = await super().candidates(origin, windows, *(x for x in [luxury] if x))
        if self.factor == 1.0:
            return out
        scaled = []
        for c in out:
            f = float(round(c.flight_cost_pln * self.factor))
            h = float(round(c.hotel_cost_pln * self.factor))
            ev = [
                e.model_copy(update={"value": {"flight": f, "hotel": h}[e.kind]})
                if e.kind in ("flight", "hotel")
                else e
                for e in c.evidence
            ]
            scaled.append(c.model_copy(update={"flight_cost_pln": f, "hotel_cost_pln": h,
                                               "evidence": ev}))  # fmt: skip
        return scaled


class FakeSender:
    def __init__(self, fail_status: int | None = None):
        self.calls: list[dict] = []
        self.fail_status = fail_status

    def __call__(self, **kw):
        self.calls.append(kw)
        if self.fail_status:
            err = Exception("push failed")
            err.response = httpx.Response(self.fail_status)
            raise err


def make(provider=None, sender=None, vapid_on=True):
    notify = MemoryNotifyStore()
    pub, priv = generate_vapid_keys()
    cfg = VapidConfig(pub, priv, "mailto:test@example.com") if vapid_on else None
    pusher = WebPusher(cfg, sender=sender or FakeSender())
    app = create_app(provider=provider, notify_store=notify, pusher=pusher)
    return TestClient(app), notify, pusher


def scan(c, **extra):
    body = {"user_id": "u1", "today": TODAY, "profile": PROFILE, **extra}
    r = c.post("/scan/run", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", text))


def allowed_numbers(n: dict) -> set[str]:
    """Every number a notification may show: from the card, its evidence and dates."""
    rec = n["recommendation"]
    vals = {rec["total_cost_pln"], rec["flight_cost_pln"], rec["hotel_cost_pln"],
            round(rec["score"]["total"] * 100)}  # fmt: skip
    vals |= {e["value"] for e in rec["evidence"] if isinstance(e["value"], (int, float))}
    out = {f"{v:.0f}" for v in vals if isinstance(v, (int, float))}
    for d in (rec["window"]["start"], rec["window"]["end"]):
        out.add(str(date.fromisoformat(d).day))
    return out | {"100"}


# ---------------------------------------------------------------------------- rules


def _rec(profile, windows, candidates, **upd):
    return rank(candidates, profile, Weights())[0].model_copy(update=upd)


def test_gate_prefers_fit_verdict(profile, windows, candidates):
    rec = _rec(profile, windows, candidates)
    concern = FitPoint(text="Carnival week crowds", dna=["q11"], evidence=[4])
    good = rec.model_copy(update={"fit": FitVerdict(label="good_fit", confidence=0.8,
                          summary="Food and history, calm month", concerns=[concern],
                          model="rules")})  # fmt: skip
    mixed = good.model_copy(update={"fit": good.fit.model_copy(update={"label": "mixed"})})
    low = rec.model_copy(update={"score": rec.score.model_copy(update={"total": 0.1})})
    assert gate(good.model_copy(update={"score": low.score}), 0.9)[0]  # fit wins over score
    assert not gate(mixed, 0.0)[0]
    assert not gate(low, 0.6)[0] and gate(rec, 0.0)[0]

    d, dec = draft_new_top(good, prev_top_id=None, prev_top_city=None)
    assert d is not None and dec.notify
    from tripai.notify.rules import to_notification

    n = to_notification(d, "u1", {}, None)
    assert n.fit_label == "good_fit" and n.fit_summary.startswith("Food")
    assert n.concerns[0].text == "Carnival week crowds"
    assert draft_new_top(mixed, None, None)[0] is None


def test_new_top_and_long_weekend_thresholds(profile, windows, candidates):
    rec = _rec(profile, windows, candidates)
    assert draft_new_top(rec, rec.id, rec.city)[1].reason == "#1 unchanged"
    bridge = long_weekends(date(2026, 11, 1), date(2026, 11, 30))[0]
    hi = rec.model_copy(update={"score": rec.score.model_copy(update={"total": 0.81})})
    lo = rec.model_copy(update={"score": rec.score.model_copy(update={"total": 0.79})})
    assert draft_long_weekend(bridge, hi)[0] is not None
    assert draft_long_weekend(bridge, lo)[0] is None
    assert draft_long_weekend(bridge, None)[1].notify is False


def test_price_drop_threshold(profile, windows, candidates):
    rec = _rec(profile, windows, candidates)
    base = rec.total_cost_pln
    assert draft_price_drop(rec, base / 0.86)[0] is None  # -14%
    d, dec = draft_price_drop(rec, base / 0.80)  # -20%
    assert d is not None and "-20%" in d.title and dec.notify
    assert f"{rec.total_cost_pln:.0f} PLN" in d.body and f"{base / 0.8:.0f} PLN" in d.body


def test_user_control(profile, windows, candidates):
    recs = rank(candidates, profile, Weights())
    drafts = [Draft("new_top", recs[0], "t", "b"), Draft("long_weekend", recs[1], "t", "b"),
              Draft("price_drop", recs[2], "t", "b")]  # fmt: skip
    now = datetime(2026, 10, 20, tzinfo=UTC)
    prefs = NotificationPrefs(user_id="u1", max_per_week=2)
    kept, dropped = apply_user_control(drafts, prefs, now=now, sent_last_week=0, already_sent=set())
    assert [d.kind for d in kept] == ["price_drop", "long_weekend"]  # priority order, limit 2
    assert "weekly limit" in dropped[0].reason

    muted = prefs.model_copy(update={"muted_cities": [recs[0].city.upper()], "max_per_week": 9})
    kept, dropped = apply_user_control(drafts, muted, now=now, sent_last_week=0, already_sent=set())
    assert recs[0].id not in {d.rec.id for d in kept} and "muted" in dropped[0].reason

    snoozed = prefs.model_copy(update={"snooze_until": now + timedelta(days=1)})
    kept, dropped = apply_user_control(drafts, snoozed, now=now, sent_last_week=0,
                                       already_sent=set())  # fmt: skip
    assert kept == [] and all("snoozed" in d.reason for d in dropped)

    kept, _ = apply_user_control(drafts, prefs, now=now, sent_last_week=2, already_sent=set())
    assert kept == []
    keys = {drafts[2].dedupe_key}
    kept, dropped = apply_user_control(drafts, prefs, now=now, sent_last_week=0, already_sent=keys)
    assert dropped[0].reason == "already notified" and len(kept) == 2


# ---------------------------------------------------------------------------- scan + inbox


def test_scan_notifies_new_top_with_real_numbers():
    c, _, _ = make()
    out = scan(c)
    run, notes = out["run"], out["notifications"]
    assert run["mode"] == "sync" and run["top_id"] and run["candidates"] > 0
    new_top = next(n for n in notes if n["kind"] == "new_top")
    rec = new_top["recommendation"]
    assert new_top["recommendation_id"] == rec["id"] == run["top_id"]
    assert new_top["inputs_hash"] == rec["inputs_hash"] and len(new_top["inputs_hash"]) == 64
    assert new_top["url"] == f"/trips/{rec['id']}"
    assert f"{rec['total_cost_pln']:.0f} PLN" in new_top["body"]
    assert new_top["why"] and new_top["evidence"]
    assert all(e["source"] and e["fetched_at"] for e in new_top["evidence"])
    for n in notes:  # never invented numbers
        assert (
            numbers(n["title"] + " " + n["body"]) - allowed_numbers(n) - _label_numbers(n) == set()
        )
    assert new_top["push_status"] == "not_opted_in"

    # same inputs -> #1 unchanged, nothing new; the decision says why
    again = scan(c)
    assert again["notifications"] == []
    assert any(d["reason"] == "#1 unchanged" for d in again["run"]["decisions"])

    inbox = c.get("/notifications", params={"user_id": "u1"}).json()
    assert inbox["unread"] == len(notes) == len(inbox["items"])
    nid = inbox["items"][0]["id"]
    assert c.post(f"/notifications/{nid}/read", params={"user_id": "u1"}).json()["read_at"]
    assert c.get("/notifications", params={"user_id": "u1"}).json()["unread"] == len(notes) - 1
    assert c.post(f"/notifications/{nid}/read", params={"user_id": "x"}).status_code == 404
    assert c.get("/scan/last", params={"user_id": "u1"}).json()["id"] == again["run"]["id"]


def _label_numbers(n: dict) -> set[str]:
    """Numbers in a długi-weekend label (dates, day counts) come from the holiday calendar."""
    if n["kind"] != "long_weekend":
        return set()
    return numbers(n["body"].split(". ")[0])


def test_long_weekend_within_21_days():
    c, _, _ = make()
    out = scan(c)
    lw = [n for n in out["notifications"] if n["kind"] == "long_weekend"]
    assert len(lw) == 1, "the Nov 11 bridge starts within 21 days of 2026-10-20"
    n = lw[0]
    assert n["score"]["total"] >= 0.8 and n["body"].startswith("Take 2 days off (Mon 9 Nov")
    assert n["recommendation"]["window"] == {"start": "2026-11-07", "end": "2026-11-11",
                                             "source": "manual"}  # fmt: skip
    # a later scan doesn't repeat it, and the decision log says so (once)
    again = [d for d in scan(c)["run"]["decisions"] if d["kind"] == "long_weekend"]
    assert [d["reason"] for d in again] == ["already notified"]
    # too far ahead: a scan on 2026-10-01 sees the bridge 37 days out -> no long_weekend rule
    c2, _, _ = make()
    early = scan(c2, today="2026-10-01")
    assert not [d for d in early["run"]["decisions"] if d["kind"] == "long_weekend"]


def test_price_drop_on_saved_pick_then_no_repeat():
    provider = ScaledProvider()
    c, _, _ = make(provider=provider)
    recs = c.post("/recommendations", json={"profile": PROFILE, "today": TODAY, "limit": 3}).json()
    pick = c.post("/picks", json={"user_id": "u1", "recommendation_id": recs[1]["id"]}).json()
    assert pick["baseline_pln"] == recs[1]["total_cost_pln"]
    assert c.post("/picks", json={"user_id": "u1", "recommendation_id": "nope"}).status_code == 404

    scan(c)  # prices unchanged -> no price_drop
    provider.factor = 0.8
    out = scan(c)
    drops = [n for n in out["notifications"] if n["kind"] == "price_drop"]
    assert len(drops) == 1
    d = drops[0]
    now = d["recommendation"]["total_cost_pln"]
    assert d["recommendation_id"] == pick["recommendation_id"]
    assert f"Now {now:.0f} PLN, was {pick['baseline_pln']:.0f} PLN" in d["body"]
    assert (pick["baseline_pln"] - now) / pick["baseline_pln"] >= 0.15
    # baseline moved to the price we just told them -> the next scan doesn't repeat it
    assert c.get("/picks", params={"user_id": "u1"}).json()[0]["baseline_pln"] == now
    again = scan(c)
    assert not [n for n in again["notifications"] if n["kind"] == "price_drop"]
    assert c.delete(f"/picks/{pick['recommendation_id']}", params={"user_id": "u1"}).json() == {
        "removed": True
    }


def test_prefs_respected_by_scan():
    c, _, _ = make()
    prefs = c.put("/notifications/prefs", json={"user_id": "u1", "max_per_week": 0}).json()
    assert prefs["max_per_week"] == 0 and prefs["push_opt_in"] is False
    out = scan(c)
    assert out["notifications"] == []
    assert any("weekly limit" in d["reason"] for d in out["run"]["decisions"])

    c.put("/notifications/prefs", json={"user_id": "u1", "max_per_week": 5,
                                        "snooze_until": "2099-01-01T00:00:00Z"})  # fmt: skip
    assert scan(c)["notifications"] == []
    p = c.put("/notifications/prefs", json={"user_id": "u1", "snooze_until": "",
                                            "muted_cities": [" Rome ", "Rome", ""]}).json()  # fmt: skip
    assert p["snooze_until"] is None and p["muted_cities"] == ["Rome"]
    assert c.get("/notifications/prefs", params={"user_id": "u1"}).json() == p
    assert (
        c.put("/notifications/prefs", json={"user_id": "u1", "max_per_week": 99}).status_code == 422
    )


def test_personalize_false_uses_neutral_weights():
    c, _, _ = make()
    profile = {**PROFILE, "personalize": False}
    skewed = {"price": 1, "weather": 0, "crowds": 0, "taste": 0}
    out = scan(c, profile=profile, weights=skewed)
    assert out["run"]["personalized"] is False and out["notifications"]
    expected = asyncio.run(_neutral_hash(TasteProfile.model_validate(profile)))
    assert out["run"]["inputs_hash"] == expected


async def _neutral_hash(profile: TasteProfile) -> str:
    deps = ScanDeps(FixtureProvider(), FixtureCalendar(), _Store(profile), MemoryNotifyStore(),
                    WebPusher(None))  # fmt: skip
    out = await scan_body(deps, profile.user_id, TODAY)
    return out["run"]["inputs_hash"]


class _Store:
    def __init__(self, profile):
        self.p = profile

    def get_profile(self, user_id):
        return self.p

    def get_weights(self, user_id):
        return Weights()

    def save_recommendations(self, user_id, recs):
        pass


def test_scan_body_runs_every_io_through_steps():
    """Under DBOS each run_step call is a checkpointed step; the body itself does no I/O."""
    seen = []

    async def recorder(name, fn, *args):
        seen.append(name)
        out = fn(*args)
        out = await out if asyncio.iscoroutine(out) else out
        json.dumps(out)  # step outputs must be checkpointable
        return out

    deps = ScanDeps(FixtureProvider(), FixtureCalendar(), _Store(TasteProfile(**PROFILE)),
                    MemoryNotifyStore(), WebPusher(None))  # fmt: skip
    out = asyncio.run(scan_body(deps, "u1", TODAY, run_step=recorder, mode="dbos",
                                workflow_id="wf-1"))  # fmt: skip
    assert seen[:5] == ["load_context", "find_windows", "rank_trips", "rank_long_weekends",
                        "price_picks"]  # fmt: skip
    assert seen[-1] == "save_run" and "save_notifications" in seen
    assert out["run"]["mode"] == "dbos" and out["run"]["workflow_id"] == "wf-1"


def test_scan_endpoint_uses_dbos_when_enabled(monkeypatch):
    c, _, _ = make()
    calls = []

    async def fake_run_scan(user_id, today_iso=None):
        calls.append((user_id, today_iso))
        run = {"id": "r", "user_id": user_id, "mode": "dbos", "workflow_id": "wf", "today": TODAY}
        return {"run": run, "notifications": []}

    monkeypatch.setattr(runtime, "_dbos_on", True)
    monkeypatch.setattr(runtime, "run_scan", fake_run_scan)
    out = scan(c)
    assert calls == [("u1", TODAY)] and out["run"]["workflow_id"] == "wf"


def test_enable_durable_scans_noop_without_database_url(monkeypatch):
    from tripai.api.notify import enable_durable_scans

    monkeypatch.delenv("DATABASE_URL", raising=False)
    c, _, _ = make()
    before = c.app.router.lifespan_context
    enable_durable_scans(c.app, c.app.state.scan_deps)
    assert c.app.router.lifespan_context is before


def test_launch_dbos_failure_falls_back_inline(monkeypatch):
    import dbos

    def boom(*a, **k):
        raise RuntimeError("no db")

    monkeypatch.setattr(dbos, "DBOS", boom)
    monkeypatch.setattr(runtime, "_wf_scan", object())
    assert runtime.launch_dbos("postgresql://nowhere") is False
    assert runtime.dbos_enabled() is False


# ---------------------------------------------------------------------------- push


def _sub(endpoint="https://push.example.com/abc123"):
    return {"user_id": "u1", "subscription": {"endpoint": endpoint,
            "keys": {"p256dh": "BPk", "auth": "xyz"}}}  # fmt: skip


def test_push_opt_in_subscribe_and_send():
    sender = FakeSender()
    c, notify, pusher = make(sender=sender)
    key = c.get("/push/vapid-public-key").json()
    assert key["enabled"] and key["public_key"] == pusher.vapid.public_key
    prefs = c.post("/push/subscribe", json=_sub()).json()
    assert prefs["push_opt_in"] is True

    out = scan(c)
    assert out["notifications"] and all(n["push_status"] == "sent:1" for n in out["notifications"])
    assert all(n["pushed_at"] for n in out["notifications"])
    call = sender.calls[0]
    payload = json.loads(call["data"])
    n0 = out["notifications"][0]
    assert payload == {"id": n0["id"], "title": n0["title"], "body": n0["body"], "url": n0["url"],
                       "recommendation_id": n0["recommendation_id"],
                       "inputs_hash": n0["inputs_hash"], "kind": n0["kind"]}  # fmt: skip
    assert call["vapid_claims"] == {"sub": "mailto:test@example.com"}
    assert call["subscription_info"]["endpoint"] == "https://push.example.com/abc123"

    off = c.request("DELETE", "/push/subscribe",
                    json={"user_id": "u1", "endpoint": "https://push.example.com/abc123"}).json()  # fmt: skip
    assert off["push_opt_in"] is False and notify.subscriptions("u1") == []


def test_expired_subscription_is_removed():
    c, notify, _ = make(sender=FakeSender(fail_status=410))
    c.post("/push/subscribe", json=_sub())
    out = scan(c)
    assert out["notifications"][0]["push_status"] == "sent:0"
    assert notify.subscriptions("u1") == []


def test_subscribe_without_vapid_is_503():
    c, _, _ = make(vapid_on=False)
    assert c.get("/push/vapid-public-key").json() == {"enabled": False, "public_key": None}
    assert c.post("/push/subscribe", json=_sub()).status_code == 503


def test_vapid_cli(capsys):
    vapid.main([])
    out = dict(line.split("=", 1) for line in capsys.readouterr().out.strip().splitlines())
    assert set(out) == {"VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"}
    assert len(out["VAPID_PUBLIC_KEY"]) == 87 and out["VAPID_SUBJECT"].startswith("mailto:")


# ---------------------------------------------------------------------------- supabase store


def test_supabase_store_writes_rows_and_falls_back(profile):
    sent: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(req)
        if req.method == "GET":
            return httpx.Response(500)
        return httpx.Response(201)

    store = SupabaseNotifyStore("https://x.supabase.co", "sb_secret_test",
                                client=httpx.Client(transport=httpx.MockTransport(handler)))  # fmt: skip
    store.save_prefs(NotificationPrefs(user_id="u1", max_per_week=1))
    assert store.get_prefs("u1").max_per_week == 1  # GET failed -> memory answers
    post = next(r for r in sent if r.method == "POST")
    assert post.url.path == "/rest/v1/notification_prefs"
    assert post.headers["authorization"] == "Bearer sb_secret_test"
    assert json.loads(post.content)[0]["user_id"] == "u1"


def test_supabase_store_reads_rows():
    row = {"user_id": "u1", "push_opt_in": True, "max_per_week": 4, "muted_cities": ["Rome"],
           "snooze_until": None, "updated_at": "2026-10-03T08:00:00+00:00"}  # fmt: skip

    def handler(req):
        return httpx.Response(200, json=[row]) if req.method == "GET" else httpx.Response(201)

    store = SupabaseNotifyStore("https://x.supabase.co", "k",
                                client=httpx.Client(transport=httpx.MockTransport(handler)))  # fmt: skip
    assert store.get_prefs("u1").muted_cities == ["Rome"]


@pytest.mark.parametrize("env,kind", [({}, MemoryNotifyStore),
                                      ({"SUPABASE_URL": "https://x", "SUPABASE_SECRET_KEY": "k"},
                                       SupabaseNotifyStore)])  # fmt: skip
def test_store_from_env(monkeypatch, env, kind):
    from tripai.notify.store import notify_store_from_env

    for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "TRIPAI_NOTIFY_STORE"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert type(notify_store_from_env()) is kind
