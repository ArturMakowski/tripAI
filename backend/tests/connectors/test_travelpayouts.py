import json
from datetime import date

import httpx
import pytest
import respx

from tripai.connectors.base import ConnectorError, fixture_path
from tripai.connectors.demo_routes import DESTINATIONS
from tripai.connectors.travelpayouts import BASE, Travelpayouts


def _payload(source: str, name: str) -> dict:
    return json.loads(fixture_path(source, name).read_text())["payload"]


@respx.mock
async def test_month_calendar_live(disk_cache, monkeypatch):
    monkeypatch.setenv("TRAVELPAYOUTS_TOKEN", "tp-test")
    route = respx.get(f"{BASE}/grouped_prices").mock(
        return_value=httpx.Response(200, json=_payload("travelpayouts:grouped_prices", "KRK-LIS"))
    )
    cal = await Travelpayouts(cache=disk_cache).month_calendar("KRK", "LIS", "2027-01")
    req = route.calls.last.request
    assert req.headers["X-Access-Token"] == "tp-test"
    assert req.url.params["currency"] == "pln" and req.url.params["group_by"] == "departure_at"
    assert req.url.params["min_trip_duration"] == "3"
    assert cal.currency == "PLN" and cal.fares
    cheapest = cal.cheapest()
    assert cheapest.price == min(f.price for f in cal.fares)
    assert cheapest.link.startswith("https://www.aviasales.com/search/")
    assert 3 <= cheapest.nights <= 7
    assert list(cal.by_departure_day()) == sorted(cal.by_departure_day())
    ev = cal.evidence()[0]
    assert ev.source == "travelpayouts:grouped_prices" and "not bookable" in ev.label


@respx.mock
async def test_prices_for_dates_and_error(disk_cache, monkeypatch):
    monkeypatch.setenv("TRAVELPAYOUTS_TOKEN", "tp-test")
    route = respx.get(f"{BASE}/prices_for_dates").mock(
        side_effect=[
            httpx.Response(200, json=_payload("travelpayouts:prices_for_dates", "KRK-ATH")),
            httpx.Response(200, json={"success": False, "data": {}, "error": "bad origin"}),
        ]
    )
    res = await Travelpayouts(cache=disk_cache).prices_for_dates(
        "KRK", "ATH", date(2027, 1, 14), date(2027, 1, 19)
    )
    assert route.calls.last.request.url.params["one_way"] == "false"
    assert all(f.departure_at.date() == date(2027, 1, 14) for f in res.fares)
    with pytest.raises(ConnectorError, match="bad origin"):
        await Travelpayouts(cache=disk_cache).prices_for_dates("XXX", "ATH", "2027-01")


@respx.mock
async def test_unauthorized_plain_text(disk_cache, monkeypatch):
    monkeypatch.setenv("TRAVELPAYOUTS_TOKEN", "bad")
    respx.get(f"{BASE}/grouped_prices").mock(return_value=httpx.Response(401, text="Unauthorized"))
    with pytest.raises(ConnectorError, match="401"):
        await Travelpayouts(cache=disk_cache).month_calendar("KRK", "FCO", "2027-01")


async def test_fixture_mode_all_routes(fixtures_mode):
    for p in DESTINATIONS:
        cal = await Travelpayouts().month_calendar("KRK", p.iata, "2027-01")
        assert cal.cheapest().departure_at.month == 1
        dated = await Travelpayouts().prices_for_dates("KRK", p.iata, date(2027, 1, 14))
        assert dated.fares
