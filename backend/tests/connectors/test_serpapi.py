import json
from datetime import date

import httpx
import pytest
import respx

from tripai.connectors.base import ConnectorError, MissingCredentials, fixture_path
from tripai.connectors.demo_routes import DESTINATIONS
from tripai.connectors.serpapi import SEARCH_URL, SerpApiExplore, SerpApiFlights, SerpApiHotels

OUT, BACK = date(2027, 1, 14), date(2027, 1, 19)


def _payload(source: str, name: str) -> dict:
    return json.loads(fixture_path(source, name).read_text())["payload"]


@respx.mock
async def test_flights_live_parses_price_insights_and_hides_key(disk_cache, monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "sk-test")
    route = respx.get(SEARCH_URL).mock(
        return_value=httpx.Response(200, json=_payload("serpapi:google_flights", "KRK-FCO"))
    )
    res = await SerpApiFlights(cache=disk_cache).price_insights("KRK", "FCO", OUT, BACK)
    q = route.calls.last.request.url.params
    assert q["engine"] == "google_flights" and q["currency"] == "PLN" and q["type"] == "1"
    assert q["api_key"] == "sk-test"
    assert res.lowest_price == res.options[0].price
    assert res.price_level in {"low", "typical", "high"}
    assert res.typical_price_range[0] < res.typical_price_range[1]
    assert res.price_history and res.evidence()[0].unit == "PLN"
    cached = next(disk_cache.root.rglob("*.json")).read_text()
    assert "sk-test" not in cached

    await SerpApiFlights(cache=disk_cache).price_insights("KRK", "FCO", OUT, BACK)
    assert route.call_count == 1


@respx.mock
async def test_error_payload_raises_and_is_not_cached(disk_cache, monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "sk-test")
    route = respx.get(SEARCH_URL).mock(
        return_value=httpx.Response(200, json={"error": "Your account has run out of searches."})
    )
    with pytest.raises(ConnectorError, match="run out"):
        await SerpApiExplore(cache=disk_cache).explore("KRK", month=1)
    with pytest.raises(ConnectorError):
        await SerpApiExplore(cache=disk_cache).explore("KRK", month=1)
    assert route.call_count == 2


@respx.mock
async def test_no_results_is_empty_not_error(disk_cache, monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "sk-test")
    respx.get(SEARCH_URL).mock(
        return_value=httpx.Response(
            200, json={"error": "Google Hotels hasn't returned any results for this query."}
        )
    )
    res = await SerpApiHotels(cache=disk_cache).search("Nowhere", OUT, BACK)
    assert res.offers == [] and res.median_nightly is None and res.evidence() == []


@respx.mock
async def test_retries_on_429(disk_cache, monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "sk-test")
    monkeypatch.setattr("tripai.connectors.base.asyncio.sleep", _no_sleep)
    route = respx.get(SEARCH_URL).mock(
        side_effect=[
            httpx.Response(429),
            httpx.Response(200, json=_payload("serpapi:google_travel_explore", "KRK")),
        ]
    )
    res = await SerpApiExplore(cache=disk_cache).explore("KRK", month=1, travel_duration=2)
    assert route.call_count == 2 and res.destinations


async def _no_sleep(_: float) -> None:
    return None


async def test_missing_key():
    with pytest.raises(MissingCredentials):
        await SerpApiExplore().explore("KRK")


async def test_fixture_mode_covers_all_demo_routes(fixtures_mode):
    explore = await SerpApiExplore().explore("KRK", month=1)
    found = {d.iata for d in explore.destinations}
    # live recording: Google Explore doesn't list every demo city every time (e.g. MLA)
    assert len({p.iata for p in DESTINATIONS} & found) >= 7
    priced = [d.flight_price for d in explore.destinations if d.flight_price is not None]
    assert explore.cheapest(1)[0].flight_price == min(priced)
    assert len(explore.cheapest()) == len(priced)  # ground-only places (no airport) are skipped
    for p in DESTINATIONS:
        fl = await SerpApiFlights().price_insights("KRK", p.iata, OUT, BACK)
        ho = await SerpApiHotels().search(p.city, OUT, BACK, iata=p.iata)
        assert fl.lowest_price and 150 < fl.lowest_price < 1500
        assert ho.median_nightly and ho.nights == 5
        for ev in fl.evidence() + ho.evidence() + explore.evidence():
            assert ev.source.startswith("serpapi:") and ev.fetched_at.tzinfo
