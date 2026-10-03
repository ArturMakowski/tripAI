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
from tripai.live import (
    LiveProvider,
    calendar_from_env,
    provider_from_env,
    sources,
    store_from_env,
)
from tripai.live.calendar import GCalCalendar
from tripai.live.sources import RECORDED_TAG
from tripai.models import FreeWindow, LuxuryLevel, TasteProfile, Weights
from tripai.scoring import FixtureCalendar, FixtureProvider, rank

# The connector fixtures cover these cities for 14-19 Jan 2027; Paris has none (degrades).
FIXTURE_CITIES = ["rome", "lisbon", "barcelona", "athens", "vienna", "prague", "budapest",
                  "naples", "valletta", "porto", "paris"]  # fmt: skip
JAN = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
TODAY = date(2026, 10, 3)


@pytest.fixture(autouse=True)
def _no_live_env(monkeypatch, tmp_path):
    for var in ("SERPAPI_API_KEY", "SERPER_API_KEY", "TRAVELPAYOUTS_TOKEN", "SUPABASE_URL",
                "SUPABASE_SECRET_KEY", "TRIPAI_PROVIDER", "TRIPAI_USE_FIXTURES", "TRIPAI_STORE",
                "TRIPAI_LIVE_TOP_N", "TRIPAI_LIVE_MAX_REFINE", "TRIPAI_LIVE_MAX_CITIES",
                "TRIPAI_FIXTURE_SOURCES", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"):  # fmt: skip
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TRIPAI_GCAL_TOKEN", str(tmp_path / "no-token.json"))


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


def conf(c):
    return next(e for e in c.evidence if e.kind == "confidence")


def test_top_n_get_exact_date_serpapi_prices(prof):
    p = live(top_n=3, max_refine=6)
    cands = run(p, prof)
    assert 3 <= len(p.last_stats["refined"]) <= 6
    assert p.last_stats["serpapi_calls"] == 0  # fixtures only: no live SerpApi lookups
    by_id = {f"{c.iata}-{c.window.start:%Y%m%d}-{c.window.end:%Y%m%d}": c for c in cands}
    for cid in p.last_stats["refined"]:
        c = by_id[cid]
        srcs = {e.source for e in c.evidence}
        assert {
            "serpapi:google_flights" + RECORDED_TAG,
            "serpapi:google_hotels" + RECORDED_TAG,
        } <= srcs
        assert any(e.kind == "photo" and e.source.startswith("serper:images") for e in c.evidence)
        assert "Google Flights, exact dates (fixture)" in conf(c).label
    unrefined = [c for cid, c in by_id.items() if cid not in p.last_stats["refined"]]
    lowest_refined = min(conf(by_id[cid]).value for cid in p.last_stats["refined"])
    assert all(conf(c).value < lowest_refined for c in unrefined)
    top = rank(cands, prof, limit=3)
    assert all(r.id in p.last_stats["refined"] for r in top)


def test_refinement_disabled_spends_one_serpapi_call(prof):
    p = live(top_n=0)
    run(p, prof)
    assert p.last_stats["refined"] == []
    assert not any("google_flights" in f for f in p.last_stats["failures"])


def test_failing_flights_connector_degrades(prof, monkeypatch):
    async def boom(*a, **k):
        raise ConnectorError("quota exhausted")

    monkeypatch.setattr(SerpApiFlights, "price_insights", boom)
    p = live(top_n=2)
    cands = run(p, prof)
    assert len(cands) == 10
    assert not any(e.source.startswith("serpapi:google_flights") for c in cands for e in c.evidence)
    assert any("google_flights" in f for f in p.last_stats["failures"])
    refined = [
        c for c in cands if any(e.source.startswith("serpapi:google_hotels") for e in c.evidence)
    ]
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


# ---------------------------------------------------------------- per-source modes


def test_source_modes_from_env(monkeypatch):
    # open_meteo needs no key -> live; keyed sources without keys -> fixture (never a crash)
    assert sources.modes() == {"travelpayouts": "fixture", "serpapi": "fixture",
                               "serper": "fixture", "open_meteo": "live", "gcal": "fixture"}  # fmt: skip
    assert sources.reasons()["serpapi"] == "missing SERPAPI_API_KEY"
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    monkeypatch.setenv("TRAVELPAYOUTS_TOKEN", "t")
    assert sources.mode("serpapi") == sources.mode("travelpayouts") == "live"
    monkeypatch.setenv("TRIPAI_FIXTURE_SOURCES", " Travelpayouts , open-meteo,bogus")
    assert sources.mode("travelpayouts") == sources.mode("open_meteo") == "fixture"
    assert sources.mode("serpapi") == "live"
    assert sources.reasons()["travelpayouts"] == "TRIPAI_FIXTURE_SOURCES"
    monkeypatch.setenv("TRIPAI_FIXTURE_SOURCES", "all")
    assert set(sources.modes().values()) == {"fixture"}
    monkeypatch.delenv("TRIPAI_FIXTURE_SOURCES")
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "1")
    assert set(sources.modes().values()) == {"fixture"}


def test_env_driven_provider_runs_offline_without_keys(prof, monkeypatch):
    """TRIPAI_PROVIDER=live with no keys: every keyed source falls back to fixtures."""
    monkeypatch.setenv("TRIPAI_FIXTURE_SOURCES", "open_meteo")  # the only keyless source
    p = LiveProvider(today=TODAY, city_ids=FIXTURE_CITIES, use_fallback=False)
    assert set(p.source_modes().values()) == {"fixture"}
    cands = run(p, prof)
    assert len(cands) == 10 and p.last_stats["serpapi_calls"] == 0
    for c in cands:
        for e in c.evidence:
            if sources.source_of_evidence(e.source):
                assert e.source.endswith((RECORDED_TAG, SYNTHETIC_TAG))


def test_mixed_live_and_fixture_sources(prof, monkeypatch):
    """Travelpayouts live (mocked HTTP), everything else on fixtures."""
    import respx

    monkeypatch.setenv("TRAVELPAYOUTS_TOKEN", "t")
    monkeypatch.setenv("TRIPAI_NO_CACHE", "1")
    monkeypatch.setenv("TRIPAI_FIXTURE_SOURCES", "serpapi,serper,open_meteo")
    rome = json.loads(
        (sources.config.fixtures_dir() / "travelpayouts/grouped_prices/KRK-FCO.json").read_text()
    )["payload"]
    p = LiveProvider(today=TODAY, city_ids=["rome"], use_fallback=False, top_n=0)
    assert p.source_modes()["travelpayouts"] == "live"
    with respx.mock(assert_all_called=False) as mock:
        route = mock.get(url__startswith="https://api.travelpayouts.com/").respond(json=rome)
        cands = run(p, prof)
    assert route.called and len(cands) == 1
    flight = next(e for e in cands[0].evidence if e.kind == "flight")
    assert flight.source == "travelpayouts:grouped_prices"  # live: no fixture tag
    weather = next(e for e in cands[0].evidence if e.kind == "weather")
    assert weather.source == "open-meteo:archive" + RECORDED_TAG
    assert (
        "(fixture)" in conf(cands[0]).label
        and "flight: Aviasales cached fare;" in conf(cands[0]).label
    )


def test_health_lists_source_modes(monkeypatch):
    h = TestClient(create_app(provider=live())).get("/health").json()
    assert h["sources"]["serpapi"] == "fixture" and h["sources"]["gcal"] == "fixture"
    h = TestClient(create_app()).get("/health").json()
    assert h["sources"] == {"provider": "fixture", "gcal": "fixture"}


def test_calendar_selection(monkeypatch, tmp_path):
    assert isinstance(calendar_from_env(), FixtureCalendar)
    token = tmp_path / "tok.json"
    token.write_text("{}")
    monkeypatch.setenv("TRIPAI_GCAL_TOKEN", str(token))
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    cal = calendar_from_env()
    assert isinstance(cal, GCalCalendar) and cal.mode == "live"
    # an unusable token never crashes: the demo calendar answers instead
    busy = asyncio.run(cal.busy(date(2026, 11, 2), date(2026, 11, 3)))
    assert busy == asyncio.run(FixtureCalendar().busy(date(2026, 11, 2), date(2026, 11, 3)))
    monkeypatch.setenv("TRIPAI_FIXTURE_SOURCES", "gcal")
    assert isinstance(calendar_from_env(), FixtureCalendar)


def test_warm_cli_offline(monkeypatch, capsys):
    from tripai import warm

    monkeypatch.setenv("TRIPAI_FIXTURE_SOURCES", "all")
    monkeypatch.setattr(warm.config, "load_dotenv_files", lambda: None)
    assert warm.main(["--today", "2026-10-03", "--skip-calendar"]) == 0
    out = capsys.readouterr().out
    assert "long weekends:" in out and "HTTP 200" in out and '"serpapi": "fixture"' in out
