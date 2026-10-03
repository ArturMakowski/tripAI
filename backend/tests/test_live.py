"""LiveProvider + env wiring + Supabase store, fully offline (connector fixtures, mock HTTP)."""

import asyncio
import json
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.api.state import MemoryStore
from tripai.api.supabase_store import SupabaseStore
from tripai.connectors.base import SYNTHETIC_TAG, ConnectorError
from tripai.connectors.serpapi import SerpApiFlights
from tripai.live import LiveProvider, provider_from_env, store_from_env
from tripai.models import FreeWindow, LuxuryLevel, TasteProfile, Weights
from tripai.scoring import FixtureProvider, rank

# The connector fixtures cover these cities for 14-19 Jan 2027; Paris has none (degrades).
FIXTURE_CITIES = ["rome", "lisbon", "barcelona", "athens", "vienna", "prague", "budapest",
                  "naples", "valletta", "porto", "paris"]  # fmt: skip
JAN = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
TODAY = date(2026, 10, 3)


@pytest.fixture(autouse=True)
def _no_live_env(monkeypatch, tmp_path):
    for var in ("SERPAPI_API_KEY", "SERPER_API_KEY", "TRAVELPAYOUTS_TOKEN", "SUPABASE_URL",
                "SUPABASE_SECRET_KEY", "TRIPAI_PROVIDER", "TRIPAI_USE_FIXTURES", "TRIPAI_STORE",
                "TRIPAI_LIVE_TOP_N", "TRIPAI_LIVE_MAX_REFINE", "TRIPAI_LIVE_MAX_CITIES"):  # fmt: skip
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))


def live(**kw) -> LiveProvider:
    kw.setdefault("use_fallback", False)
    return LiveProvider(fixtures=True, today=TODAY, city_ids=FIXTURE_CITIES, **kw)


@pytest.fixture
def prof() -> TasteProfile:
    return TasteProfile(user_id="u1", budget_pln=2500, interests={"food": 0.9, "history": 0.7})


def run(provider: LiveProvider, prof: TasteProfile, windows=JAN, **kw):
    return asyncio.run(provider.candidates("KRK", windows, profile=prof, **kw))


def test_live_candidates_from_seed_and_connectors(prof):
    p = live()
    cands = run(p, prof)
    cities = {c.city for c in cands}
    assert len(cands) == 10 and "Paris" not in cities  # no Paris fixtures -> dropped, no error
    assert any("open-meteo paris" in f for f in p.last_stats["failures"])
    for c in cands:
        assert c.crowd == pytest.approx(c.crowd) and 0 <= c.crowd <= 1
        assert c.highlights and c.tags
        kinds = [e.kind for e in c.evidence]
        assert {"flight", "hotel", "weather", "crowds", "attraction", "confidence"} <= set(kinds)
        assert kinds[0] == "flight" and kinds[-1] == "confidence"
        for e in c.evidence:
            assert e.source and e.fetched_at
            if e.source.startswith("travelpayouts"):  # recorded=false fixture stays labelled
                assert e.source.endswith(SYNTHETIC_TAG)


def test_top_n_get_exact_date_serpapi_prices(prof):
    p = live(top_n=3, max_refine=6)
    cands = run(p, prof)
    assert 3 <= len(p.last_stats["refined"]) <= 6
    assert p.last_stats["serpapi_calls"] == 1 + 2 * len(p.last_stats["refined"])
    by_id = {f"{c.iata}-{c.window.start:%Y%m%d}-{c.window.end:%Y%m%d}": c for c in cands}
    for cid in p.last_stats["refined"]:
        c = by_id[cid]
        srcs = {e.source for e in c.evidence}
        assert "serpapi:google_flights" in srcs and "serpapi:google_hotels" in srcs
        assert any(e.kind == "photo" and e.source == "serper:images" for e in c.evidence)
        conf = next(e for e in c.evidence if e.kind == "confidence")
        assert conf.value >= 0.9
    unrefined = [c for cid, c in by_id.items() if cid not in p.last_stats["refined"]]
    assert all(next(e for e in c.evidence if e.kind == "confidence").value < 0.9
               for c in unrefined)  # fmt: skip
    top = rank(cands, prof, limit=3)
    assert all(r.id in p.last_stats["refined"] for r in top)


def test_refinement_disabled_spends_one_serpapi_call(prof):
    p = live(top_n=0)
    run(p, prof)
    assert p.last_stats["serpapi_calls"] == 1 and p.last_stats["refined"] == []


def test_failing_flights_connector_degrades(prof, monkeypatch):
    async def boom(*a, **k):
        raise ConnectorError("quota exhausted")

    monkeypatch.setattr(SerpApiFlights, "price_insights", boom)
    p = live(top_n=2)
    cands = run(p, prof)
    assert len(cands) == 10
    assert not any(e.source == "serpapi:google_flights" for c in cands for e in c.evidence)
    assert any("google_flights" in f for f in p.last_stats["failures"])
    refined = [c for c in cands if any(e.source == "serpapi:google_hotels" for e in c.evidence)]
    assert refined
    for c in refined:  # hotel verified, flight still the estimate -> confidence below 1
        conf = next(e for e in c.evidence if e.kind == "confidence")
        assert 0 < conf.value < 1 and "flight: Aviasales" in conf.label


def test_nothing_available_falls_back_to_labelled_fixtures(prof):
    windows = [FreeWindow(start=date(2027, 5, 1), end=date(2027, 5, 4))]  # no fixtures for May
    assert run(live(), prof, windows) == []
    p = live(use_fallback=True)
    cands = run(p, prof, windows)
    assert cands and p.last_stats["fallback"] == "FixtureProvider"
    assert all(e.source.startswith("fixture:") for c in cands for e in c.evidence)


def test_luxury_changes_hotel_cost(prof):
    std = {c.iata: c.hotel_cost_pln for c in run(live(top_n=0), prof)}
    lux = {c.iata: c.hotel_cost_pln
           for c in run(live(top_n=0), prof, luxury=LuxuryLevel.luxury)}  # fmt: skip
    assert all(lux[k] > std[k] for k in std)


def test_cities_from_seed():
    infos = asyncio.run(LiveProvider().cities("KRK"))
    assert len(infos) >= 30 and all(i.iata != "KRK" for i in infos)
    rome = next(i for i in infos if i.iata == "FCO")
    assert "history" in rome.tags and rome.highlights


def test_api_with_live_provider(prof):
    app = create_app(provider=live(top_n=2, max_refine=2), store=MemoryStore())
    c = TestClient(app)
    req = {"profile": prof.model_dump(mode="json"), "limit": 5,
           "windows": [w.model_dump(mode="json") for w in JAN]}  # fmt: skip
    r = c.post("/recommendations", json=req)
    assert r.status_code == 200
    recs = r.json()
    assert len(recs) == 5 and recs[0]["why"]
    assert all(any(e["kind"] == "confidence" for e in rec["evidence"]) for rec in recs)
    assert c.get("/cities").json()


# ---------------------------------------------------------------- env selection


def test_provider_selection(monkeypatch):
    assert isinstance(provider_from_env(), LiveProvider)
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "1")
    assert isinstance(provider_from_env(), FixtureProvider)
    monkeypatch.setenv("TRIPAI_PROVIDER", "live")
    assert isinstance(provider_from_env(), LiveProvider)
    monkeypatch.setenv("TRIPAI_PROVIDER", "fixture")
    monkeypatch.delenv("TRIPAI_USE_FIXTURES")
    assert isinstance(provider_from_env(), FixtureProvider)


def test_store_selection(monkeypatch):
    assert type(store_from_env()) is MemoryStore
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    assert isinstance(store_from_env(), SupabaseStore)
    monkeypatch.setenv("TRIPAI_STORE", "memory")
    assert type(store_from_env()) is MemoryStore


# ---------------------------------------------------------------- Supabase store


class FakePostgrest:
    def __init__(self, fail: bool = False):
        self.requests: list[httpx.Request] = []
        self.fail = fail
        self.rows: dict[str, list[dict]] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["apikey"] == "sb_secret_test"
        if self.fail:
            return httpx.Response(500, json={"message": "down"})
        table = request.url.path.rsplit("/", 1)[-1]
        if request.method == "GET":
            return httpx.Response(200, json=self.rows.get(table, []))
        return httpx.Response(201)

    def bodies(self, table: str) -> list:
        return [json.loads(r.content) for r in self.requests
                if r.method in {"POST", "PATCH"} and r.url.path.endswith(table)]  # fmt: skip


def store(fake: FakePostgrest) -> SupabaseStore:
    client = httpx.Client(transport=httpx.MockTransport(fake))
    return SupabaseStore("https://x.supabase.co", "sb_secret_test", client=client)


def test_supabase_store_persists_profile_recs_feedback(prof, candidates):
    fake = FakePostgrest()
    s = store(fake)
    recs = rank(candidates, prof, limit=3)
    s.save_profile(prof)
    s.save_weights(prof.user_id, Weights(price=0.7))
    s.save_recommendations(prof.user_id, recs)
    s.save_feedback(prof.user_id, recs[0].id, {"crowds": 1}, [{"field": "weights.crowds"}])
    s.flush()
    order = [r.url.path.rsplit("/", 1)[-1] for r in fake.requests]
    assert order == ["profiles", "profiles", "recommendations", "feedback"]  # FK-safe order
    assert fake.bodies("profiles")[1][0]["weights"]["price"] == 0.7
    rows = fake.bodies("recommendations")[0]
    assert [r["rank"] for r in rows] == [1, 2, 3]
    assert {r["inputs_hash"] for r in rows} == {recs[0].inputs_hash}
    assert fake.requests[2].url.params["on_conflict"] == "user_id,inputs_hash,id"
    assert fake.bodies("feedback")[0]["diff"] == [{"field": "weights.crowds"}]
    assert s.get_profile(prof.user_id) == prof  # memory first, no read request
    assert all(r.method != "GET" for r in fake.requests)


def test_supabase_store_reads_through(prof, candidates):
    fake = FakePostgrest()
    rec = rank(candidates, prof, limit=1)[0]
    fake.rows = {
        "profiles": [
            {
                "profile": prof.model_dump(mode="json"),
                "weights": {"price": 1, "weather": 0, "crowds": 0, "taste": 0},
            }
        ],
        "recommendations": [{"payload": rec.model_dump(mode="json")}],
    }
    s = store(fake)
    assert s.get_profile("u1") == prof
    assert s.get_weights("u1").price == 1
    assert s.get_recommendation(rec.id) == rec


def test_supabase_errors_never_raise(prof):
    s = store(FakePostgrest(fail=True))
    s.save_profile(prof)
    s.save_feedback("u1", "x", {}, [])
    s.flush()
    assert s.get_profile("u1") == prof  # memory copy still serves
    assert s.get_profile("nobody") is None and s.get_recommendation("nope") is None


def test_feedback_endpoint_persists_diff(prof):
    st = MemoryStore()
    c = TestClient(create_app(store=st))
    r = c.post("/feedback", json={"trip_id": "FCO-20261107-20261111", "answers": {"crowds": 1}})
    assert r.status_code == 200
    assert st.feedback[0]["trip_id"] == "FCO-20261107-20261111" and st.feedback[0]["diff"]
