"""Every origin the user picked is searched (WAW + WMI), not just the first one."""

import asyncio
from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.models import FreeWindow, LuxuryLevel
from tripai.scoring import FixtureProvider
from tripai.scoring.engine import candidate_id
from tripai.scoring.origins import MAX_ORIGINS, candidates_for_origins, city_groups, origin_codes
from tripai.scoring.types import Candidate

WINDOWS = [FreeWindow(start="2027-01-14", end="2027-01-19")]


class Recording(FixtureProvider):
    """Fixture numbers; flying from Warszawa (WAW,WMI) is 100 zł cheaper to Barcelona only."""

    supports_fast = True

    def __init__(self, fail: set[str] = frozenset()) -> None:
        super().__init__()
        self.calls: list[tuple[str, dict]] = []
        self.fail = fail

    async def candidates(self, origin: str, windows: Sequence[FreeWindow], luxury=LuxuryLevel.standard,
                         *, profile=None, weights=None, typical_spend_pln=None, fast: bool = False,
                         fallback: bool = True) -> list[Candidate]:  # fmt: skip
        self.calls.append((origin, {"fast": fast, "fallback": fallback}))
        if origin in self.fail:
            raise RuntimeError(f"{origin} down")
        out = await super().candidates(origin, windows, luxury, profile=profile)
        if "WMI" in origin.split(","):
            out = [
                c.model_copy(update={"flight_cost_pln": c.flight_cost_pln - 100})
                for c in out
                if c.iata == "BCN"
            ]
        return out


def test_origin_codes():
    assert origin_codes(["waw", "WMI", "WAW", " "]) == ["WAW", "WMI"]
    assert origin_codes([]) == origin_codes(None) == ["KRK"]
    assert len(origin_codes(["KRK", "WAW", "WMI", "KTW", "GDN", "WRO"])) == MAX_ORIGINS


def test_city_groups():
    assert city_groups(["KRK", "WAW", "KTW", "WMI"]) == ["KRK", "WAW,WMI", "KTW"]
    assert city_groups(["XXX"]) == ["XXX"]  # unknown airport: its own group


def test_one_call_per_city_full_pipeline_for_the_first_city_only():
    p = Recording()
    got = asyncio.run(
        candidates_for_origins(p, ["WAW", "KRK", "WMI"], WINDOWS, LuxuryLevel.standard)
    )
    assert p.calls == [
        ("WAW,WMI", {"fast": False, "fallback": True}),  # Warszawa: ONE search, both airports
        ("KRK", {"fast": True, "fallback": False}),  # another city: no new SerpApi spend
    ]
    krk = {candidate_id(c): c for c in asyncio.run(FixtureProvider().candidates("KRK", WINDOWS))}
    assert {candidate_id(c) for c in got} == set(krk)  # one candidate per (destination, window)
    bcn = next(c for c in got if c.iata == "BCN")
    assert (
        bcn.flight_cost_pln
        == next(c for c in krk.values() if c.iata == "BCN").flight_cost_pln - 100
    )


def test_failing_secondary_city_is_skipped_but_primary_failure_raises():
    args = (["WAW", "KRK"], WINDOWS, LuxuryLevel.standard)
    assert asyncio.run(candidates_for_origins(Recording(fail={"KRK"}), *args))
    with pytest.raises(RuntimeError):
        asyncio.run(
            candidates_for_origins(
                Recording(fail={"WMI,WAW"}), ["WMI", "WAW"], WINDOWS, LuxuryLevel.standard
            )
        )


def test_recommendations_search_every_picked_airport():
    p = Recording()
    c = TestClient(create_app(provider=p))
    profile = {"user_id": "demo", "origin_airports": ["WAW", "WMI"], "interests": {"food": 0.9}}
    req = {
        "profile": profile,
        "windows": [{"start": "2027-01-14", "end": "2027-01-19"}],
        "limit": 20,
    }
    recs = c.post("/recommendations", json=req).json()
    assert [o for o, _ in p.calls] == ["WAW,WMI"]
    assert any(r["iata"] == "BCN" for r in recs)


def test_live_provider_secondary_origin_never_serves_sample_fixtures():
    from tripai.live.provider import LiveProvider

    lp = LiveProvider(use_fallback=True)

    async def nothing(*a, **k):
        return []

    lp._live = nothing  # no live data for this origin
    assert asyncio.run(lp.candidates("WMI", WINDOWS, fallback=False)) == []
    assert asyncio.run(lp.candidates("WMI", WINDOWS))  # primary keeps its labelled fallback


def test_live_provider_city_group_one_serpapi_search_travelpayouts_per_airport(
    monkeypatch, tmp_path
):
    """ "WAW,WMI" = one Google Flights search per refined trip (comma departure_id); Travelpayouts
    (one airport per call, free) is asked for both and the cheaper WMI fare is labelled WMI."""
    from datetime import date

    from tripai.connectors.serpapi import SerpApiFlights
    from tripai.connectors.travelpayouts import Travelpayouts
    from tripai.live.provider import LiveProvider

    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))
    tp_origins, serp_origins = [], []
    orig_month, orig_exact = Travelpayouts.month_calendar, Travelpayouts.prices_for_dates
    orig_flights = SerpApiFlights.price_insights

    def relabel(res, code):  # recorded KRK fares, re-issued as if from `code`
        delta = -50 if code == "WMI" else 0
        fares = [
            f.model_copy(update={"origin_airport": code, "price": f.price + delta})
            for f in res.fares
        ]
        return res.model_copy(update={"fares": fares})

    async def month_calendar(self, origin, destination, month, **kw):
        tp_origins.append(origin)
        return relabel(await orig_month(self, "KRK", destination, month, **kw), origin)

    async def prices_for_dates(self, origin, destination, *a, **kw):
        tp_origins.append(origin)
        return relabel(await orig_exact(self, "KRK", destination, *a, **kw), origin)

    async def price_insights(self, origin, destination, *a, **kw):
        serp_origins.append(origin)
        return await orig_flights(self, origin, destination, *a, **kw)  # no WAW,WMI recording

    monkeypatch.setattr(Travelpayouts, "month_calendar", month_calendar)
    monkeypatch.setattr(Travelpayouts, "prices_for_dates", prices_for_dates)
    monkeypatch.setattr(SerpApiFlights, "price_insights", price_insights)

    p = LiveProvider(
        fixtures=True,
        today=date(2026, 10, 3),
        city_ids=["rome", "lisbon"],
        top_n=1,
        use_fallback=False,
    )
    got = asyncio.run(p.candidates("WAW,WMI", WINDOWS))
    assert got
    assert {"WAW", "WMI"} <= set(tp_origins)  # Travelpayouts: per airport
    assert serp_origins and set(serp_origins) == {"WAW,WMI"}  # SerpApi: one search for the city
    assert len(serp_origins) <= p.max_refine
    flights = [e for c in got for e in c.evidence if e.kind == "flight"]
    assert flights and all("WMI-" in e.label for e in flights if e.label.startswith("Return"))
