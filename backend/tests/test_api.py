import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app


def client() -> TestClient:
    return TestClient(create_app())


PROFILE = {"user_id": "demo", "budget_pln": 2500, "interests": {"food": 0.9, "history": 0.7}}


def test_health_and_cities():
    c = client()
    assert c.get("/health").json()["llm"] is None
    assert len(c.get("/cities").json()) == 10


def test_windows_endpoints():
    c = client()
    ws = c.get("/windows", params={"from": "2026-11-01", "to": "2026-11-15"}).json()
    assert {"start": "2026-11-07", "end": "2026-11-08", "source": "gcal"} in ws
    radar = c.get("/windows/long-weekends", params={"from": "2026-11-01", "to": "2026-11-30"})
    assert radar.json()[0]["label"].startswith("Take 2 days off")
    body = {"from": "2026-11-01", "to": "2026-11-03",
            "busy": [{"start": "2026-11-02T09:00:00", "end": "2026-11-02T17:00:00"}]}  # fmt: skip
    assert c.post("/windows", json=body).json() == []  # 1-day gaps < min_days
    assert c.get("/windows", params={"from": "2026-11-05", "to": "2026-11-01"}).status_code == 422


def test_interview_flow():
    c = client()
    r = c.post("/interview", json={"messages": []}).json()
    assert r["profile"] is None and "?" in r["reply"]


def test_recommendations_and_feedback_loop():
    c = client()
    req = {"profile": PROFILE, "today": "2026-10-03", "limit": 5}
    recs = c.post("/recommendations", json=req).json()
    assert len(recs) == 5
    top = recs[0]
    assert top["why"] and top["inputs_hash"] and top["counterfactuals"]
    assert all(e["source"] and e["fetched_at"] for e in top["evidence"])
    assert c.post("/recommendations", json=req).json() == recs  # reproducible

    fb = c.post("/feedback", json={"trip_id": top["id"], "answers": {"crowds": 1}}).json()
    assert fb["weights"]["crowds"] > 0.15
    assert any(d["field"] == "weights.crowds" for d in fb["diff"])
    assert "crowds" in fb["profile"]["dislikes"]
    # stored weights are used on the next call -> ranking input changes
    again = c.post("/recommendations", json={**req, "profile": fb["profile"]}).json()
    assert again[0]["inputs_hash"] != top["inputs_hash"]


def test_recommendations_explicit_windows():
    c = client()
    req = {"profile": PROFILE, "windows": [{"start": "2027-01-14", "end": "2027-01-19"}],
           "weights": {"price": 1, "weather": 0, "crowds": 0, "taste": 0}}  # fmt: skip
    recs = c.post("/recommendations", json=req).json()
    assert all(r["window"]["start"] == "2027-01-14" for r in recs)
    prices = [r["score"]["price"] for r in recs]
    assert prices == sorted(prices, reverse=True)


def test_feedback_spec_shape_without_stored_profile():
    """ARCHITECTURE.md: POST /feedback {trip_id, answers} -> updated TasteProfile (top-level)."""
    r = client().post("/feedback", json={"trip_id": "FCO-20261107-20261111",
                                         "answers": {"crowds": 1, "food": 5}})  # fmt: skip
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"].startswith("s_") and "crowds" in body["dislikes"]  # server session
    assert body["interests"] == body["profile"]["interests"]
    assert body["interests"]["food"] == 0.75  # Rome has a food tag: 0.5 -> halfway to 1.0
    assert body["diff"] and body["weights"]["crowds"] > 0.15


def test_window_sources_follow_contract():
    c = client()
    req = {"profile": PROFILE, "today": "2026-10-03", "limit": 10}
    assert {r["window"]["source"] for r in c.post("/recommendations", json=req).json()} <= {
        "gcal",
        "manual",
    }


@pytest.mark.parametrize(
    "extra",
    [{"horizon_days": 200000}, {"limit": -1}, {"limit": 0}, {"max_leave_days": 9},
     {"explain_top": -1}, {"windows": [{"start": "2027-01-01", "end": "2027-01-03"}] * 61}],
)  # fmt: skip
def test_recommendations_inputs_bounded(extra):
    r = client().post("/recommendations", json={"profile": PROFILE, **extra})
    assert r.status_code == 422


def test_long_weekends_max_leave_bounded():
    r = client().get("/windows/long-weekends", params={"from": "2026-11-01", "to": "2026-11-30",
                                                      "max_leave": 50})  # fmt: skip
    assert r.status_code == 422
