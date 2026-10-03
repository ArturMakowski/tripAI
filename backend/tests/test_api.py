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
    assert {"start": "2026-11-07", "end": "2026-11-08", "source": "calendar"} in ws
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


def test_feedback_unknown_user():
    r = client().post("/feedback", json={"trip_id": "FCO-x", "user_id": "nobody", "answers": {}})
    assert r.status_code == 404
