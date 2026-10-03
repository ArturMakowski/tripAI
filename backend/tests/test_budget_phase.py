"""Hard budget (TasteProfile.budget_pln) and two-phase /recommendations (fast, then full).
Offline: FixtureProvider + connector fixtures; SerpApi is never called live."""

import asyncio
import time
from datetime import date

import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.connectors.open_meteo import OpenMeteo
from tripai.live import LiveProvider
from tripai.models import FreeWindow, TasteProfile
from tripai.scoring import FixtureProvider, rank
from tripai.scoring.budget_fit import budget_status, rank_within_budget

WINDOWS = [
    {"start": "2026-11-07", "end": "2026-11-11"},
    {"start": "2027-01-14", "end": "2027-01-16"},
]
FIXTURE_CITIES = ["rome", "lisbon", "barcelona", "athens", "vienna", "prague", "budapest",
                  "naples", "valletta", "porto"]  # fmt: skip


@pytest.fixture(autouse=True)
def _offline(monkeypatch, tmp_path):
    for var in ("SERPAPI_API_KEY", "SERPER_API_KEY", "TRAVELPAYOUTS_TOKEN", "SUPABASE_URL",
                "SUPABASE_SECRET_KEY", "TRIPAI_FIXTURE_SOURCES", "TRIPAI_FAST_DEADLINE_S"):  # fmt: skip
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))


def post(budget, phase=None, **extra):
    c = TestClient(create_app())
    body = {"profile": {"user_id": "x", "budget_pln": budget, "interests": {"food": 0.9, "history": 0.7}},
            "windows": WINDOWS, **extra}  # fmt: skip
    r = c.post("/recommendations" + (f"?phase={phase}" if phase else ""), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_tester_case_1000_pln_never_tops_with_an_over_budget_trip():
    recs = post(1000)
    assert recs[0]["total_cost_pln"] <= 1000
    assert all(r["total_cost_pln"] <= 1100 for r in recs)  # +10% tolerance at most
    assert {r["budget"]["status"] for r in recs} <= {"within", "slightly_over"}
    slight = [r for r in recs if r["budget"]["status"] == "slightly_over"]
    assert slight and all(r["budget"]["overage_pln"] == r["total_cost_pln"] - 1000 for r in slight)
    assert all("Slightly over budget" in r["budget"]["label"] for r in slight)


def test_tester_case_default_windows_1000_pln():
    """The tester's flow: no explicit windows (calendar + long weekends), budget 1000."""
    c = TestClient(create_app())
    body = {"profile": {"user_id": "x", "budget_pln": 1000}, "today": "2026-10-03"}
    recs = c.post("/recommendations", json=body).json()
    fits = [r for r in recs if r["budget"]["status"] != "over"]
    over = [r for r in recs if r["budget"]["status"] == "over"]
    assert recs[0]["budget"]["status"] != "over" or not fits
    assert recs == fits + over  # over-budget only ever below every option that fits
    if len(fits) >= 3:
        assert not over


def test_nothing_fits_returns_three_closest_marked_over():
    recs = post(500)
    assert len(recs) == 3
    assert [r["budget"]["status"] for r in recs] == ["over"] * 3
    costs = [r["total_cost_pln"] for r in recs]
    assert costs == sorted(costs) and costs[0] == 678  # closest first (Naples 14-16 Jan)
    assert [r["budget"]["overage_pln"] for r in recs] == [c - 500 for c in costs]
    assert len({r["iata"] for r in recs}) == 3 and all(r["flip"] is None for r in recs)
    assert [r["rank"] for r in recs] == [1, 2, 3]


def test_in_budget_always_ranks_above_over_budget_fallbacks():
    recs = post(700, weights={"price": 0, "weather": 0, "crowds": 0, "taste": 1})
    assert [r["budget"]["status"] for r in recs] == ["within", "over", "over"]
    assert recs[0]["iata"] == "NAP"
    assert len({r["inputs_hash"] for r in recs}) == 1  # one hash for the whole answer


def test_no_budget_means_no_constraint():
    profile = TasteProfile(user_id="u", interests={"food": 0.9})
    ws = [FreeWindow.model_validate(w) for w in WINDOWS]
    cands = asyncio.run(FixtureProvider().candidates("KRK", ws))
    plain = rank(cands, profile, None, limit=10)
    fitted = rank_within_budget(cands, profile, None, limit=10)
    assert [r.id for r, _ in fitted] == [r.id for r in plain]
    assert all(s is None for _, s in fitted)
    assert post(None)[0]["budget"] is None


def test_budget_status_labels():
    assert budget_status(950, 1000).status == "within"
    s = budget_status(1080, 1000)
    assert (s.status, s.overage_pln, s.overage_pct) == ("slightly_over", 80, 8.0)
    assert budget_status(1629, 1000).label == "Over budget: +629 PLN (62.9%)"


# ---------------------------------------------------------------- two-phase


def test_fast_phase_skips_llm_and_marks_unrefined():
    fast = post(2500, "fast")
    full = post(2500)
    assert {r["phase"] for r in fast} == {"fast"} and {r["phase"] for r in full} == {"full"}
    assert not any(r["refined"] for r in fast)
    assert all(r["why"] and r["fit"] is None for r in fast)  # template why, no fit verdict
    assert all(r["fit"] is not None for r in full[:5])
    assert [r["id"] for r in fast] == [r["id"] for r in full]  # fixture data: same ranking


def live(**kw) -> LiveProvider:
    return LiveProvider(fixtures=True, today=date(2026, 10, 3), city_ids=FIXTURE_CITIES,
                        use_fallback=False, **kw)  # fmt: skip


JAN = [{"start": "2027-01-14", "end": "2027-01-19"}]
PROFILE = {"user_id": "x", "budget_pln": 4000, "interests": {"food": 0.9, "history": 0.7}}


def test_live_fast_vs_full():
    p = live(top_n=2, max_refine=2)
    c = TestClient(create_app(provider=p))
    fast = c.post("/recommendations?phase=fast", json={"profile": PROFILE, "windows": JAN}).json()
    assert p.last_stats["phase"] == "fast" and p.last_stats["refined"] == []
    assert not any(r["refined"] for r in fast)
    assert not any(e["source"].startswith("serpapi:google_flights")
                   for r in fast for e in r["evidence"])  # fmt: skip
    full = c.post("/recommendations", json={"profile": PROFILE, "windows": JAN}).json()
    assert p.last_stats["phase"] == "full" and len(p.last_stats["refined"]) == 2
    assert sum(r["refined"] for r in full) >= 1


def test_fast_phase_uses_seed_climate_and_a_per_call_deadline(monkeypatch):
    from tripai.connectors.travelpayouts import Travelpayouts
    from tripai.seed import load

    real = Travelpayouts.month_calendar

    async def slow_for_rome(self, origin, dest, month, **kw):
        if dest == "FCO":
            await asyncio.sleep(2.0)
        return await real(self, origin, dest, month, **kw)

    async def no_network(*a, **k):
        raise AssertionError("fast phase must not call Open-Meteo")

    monkeypatch.setattr(Travelpayouts, "month_calendar", slow_for_rome)
    monkeypatch.setattr(OpenMeteo, "climate_normals", no_network)
    monkeypatch.setenv("TRIPAI_FAST_DEADLINE_S", "0.3")
    p = live(top_n=0)
    ws = [FreeWindow.model_validate(w) for w in JAN]
    prof = TasteProfile(**PROFILE)
    t = time.monotonic()
    fast = asyncio.run(p.candidates("KRK", ws, profile=prof, fast=True))
    assert time.monotonic() - t < 1.0
    assert p.last_stats["late_calls"] == 1 and len(fast) == 10
    rome = next(c for c in fast if c.city == "Rome")
    flight = next(e for e in rome.evidence if e.kind == "flight")
    assert "Google Travel Explore" in flight.label  # Travelpayouts was too slow: next source
    snap = load.meta("climate.json")
    for c in fast:
        w = next(e for e in c.evidence if e.kind == "weather")
        assert w.source == "seed:climate (open-meteo:archive ERA5)"
        assert w.fetched_at == snap.fetched_at
        assert c.peak is None  # no peak-month fetches in the fast phase


def test_cheap_pass_needs_no_open_meteo(monkeypatch):
    """Month normals come from the committed snapshot: Open-Meteo down changes nothing."""
    from tripai.connectors.base import ConnectorError

    async def down(*a, **k):
        raise ConnectorError("open-meteo 429")

    monkeypatch.setattr(OpenMeteo, "climate_normals", down)
    p = live(top_n=0)
    cands = asyncio.run(
        p.candidates(
            "KRK", [FreeWindow.model_validate(w) for w in JAN], profile=TasteProfile(**PROFILE)
        )
    )
    assert len(cands) == 10 and all(c.temp_c for c in cands)
    assert p.last_stats["failures"] == []  # never even asked


def test_refinement_targets_respect_the_budget():
    ws = [FreeWindow.model_validate(w) for w in WINDOWS]
    cands = asyncio.run(FixtureProvider().candidates("KRK", ws))
    p = LiveProvider(top_n=3)
    cheap = TasteProfile(user_id="u", budget_pln=900, interests={"art": 1.0})
    targets = p._refine_targets(cands, cheap, None)
    by_id = {f"{c.iata}-{c.window.start:%Y%m%d}-{c.window.end:%Y%m%d}": c for c in cands}
    assert len(targets) == 3 and all(by_id[t].total_cost_pln <= 990 for t in targets)
    # without the budget the art-lovers' top 3 would include pricier trips
    free = p._refine_targets(cands, cheap.model_copy(update={"budget_pln": None}), None)
    assert any(by_id[t].total_cost_pln > 990 for t in free)


def test_slow_exact_window_weather_cannot_stall_full(monkeypatch):
    from tripai.live import provider as prov

    async def hang(*a, **k):
        await asyncio.sleep(30)

    monkeypatch.setattr(OpenMeteo, "weather", hang)
    monkeypatch.setattr(prov, "REFINE_WEATHER_TIMEOUT_S", 0.2)
    p = live(top_n=2, max_refine=2)
    t = time.monotonic()
    cands = asyncio.run(
        p.candidates(
            "KRK", [FreeWindow.model_validate(w) for w in JAN], profile=TasteProfile(**PROFILE)
        )
    )
    assert time.monotonic() - t < 2 and len(cands) == 10
    assert p.last_stats["late_calls"] == 2  # both refined cards keep their month normals


# ---------------------------------------------------------------- review fixes (#16)


class _ScanStore:
    def __init__(self, profile):
        self.p = profile

    async def get_profile(self, user_id):
        return self.p

    async def get_weights(self, user_id):
        return None

    async def save_recommendations(self, user_id, recs):
        pass


def test_proactive_scan_obeys_the_budget_and_never_pushes_fallbacks():
    from tripai.models import Weights
    from tripai.notify.push import WebPusher
    from tripai.notify.store import MemoryNotifyStore
    from tripai.scoring import FixtureCalendar
    from tripai.workflows.scan import Scan, ScanDeps

    def scan_recs(budget):
        prof = TasteProfile(user_id="u", budget_pln=budget, interests={"food": 0.9})
        deps = ScanDeps(FixtureProvider(), FixtureCalendar(), _ScanStore(prof),
                        MemoryNotifyStore(), WebPusher(None), fit=None, gate=None)  # fmt: skip
        scan = Scan(deps)
        p, w = prof.model_dump(mode="json"), Weights().model_dump(mode="json")
        found = asyncio.run(scan.find_windows("2026-10-03"))
        top = asyncio.run(scan.rank_trips(p, w, found["windows"]))["recs"]
        best = asyncio.run(scan.rank_long_weekends(p, w, found["bridges"][:3]))["best"]
        return top, [b for b in best if b]

    top, best = scan_recs(900)
    assert top and all(r["total_cost_pln"] <= 990 for r in top + best)  # Palma-style push: gone
    nothing_top, nothing_best = scan_recs(300)  # nothing fits: no "closest" fallbacks pushed
    assert nothing_top == [] and nothing_best == []
    unbounded, _ = scan_recs(None)
    assert any(r["total_cost_pln"] > 990 for r in unbounded)  # without a budget they'd show


def test_interest_filter_runs_once_before_the_budget_split():
    """Review repro: budget 900, personalize=False, interests whisky. Only whisky cities
    (Edinburgh) may appear: no non-matching over-budget fallbacks, one consistent receipt."""
    ws = [FreeWindow.model_validate(w) for w in WINDOWS]
    cands = asyncio.run(FixtureProvider().candidates("KRK", ws))
    prof = TasteProfile(user_id="u", budget_pln=900, personalize=False,
                        interests={"whisky": 0.9})  # fmt: skip
    out = rank_within_budget(cands, prof, None)
    assert [r.city for r, _ in out] == ["Edinburgh"]
    receipts = {r.interest_filter.text for r, _ in out}
    assert len(receipts) == 1 and "filtered out" in receipts.pop()
    # interests nobody matches -> filter keeps everything -> normal budget behaviour
    none = rank_within_budget(cands, prof.model_copy(update={"interests": {"opera": 1.0}}), None)
    assert len(none) >= 3 and {r.interest_filter.applied for r, _ in none} == {False}


def test_inputs_hash_matches_rank_even_with_duplicates():
    ws = [FreeWindow.model_validate(w) for w in WINDOWS]
    cands = asyncio.run(FixtureProvider().candidates("KRK", ws))
    prof = TasteProfile(user_id="u", budget_pln=5000, interests={"food": 0.9})
    dup = cands + cands[:3]
    assert {r.inputs_hash for r, _ in rank_within_budget(dup, prof, None)} == {
        rank(dup, prof, None)[0].inputs_hash
    }


def test_fast_phase_does_not_persist():
    from tripai.api.state import MemoryStore

    st = MemoryStore()
    c = TestClient(create_app(store=st))
    body = {"profile": {"user_id": "x", "budget_pln": 2500}, "windows": WINDOWS}
    assert c.post("/recommendations?phase=fast", json=body).status_code == 200
    assert st.recs == {} and st.profiles == {}
    assert c.post("/recommendations", json=body).status_code == 200
    assert st.recs and all(r.phase == "full" for r in st.recs.values())


def test_status_uses_exact_precision():
    assert budget_status(1000.4, 1000).status == "slightly_over"  # was labelled within
    assert budget_status(1000.0, 1000).status == "within"
