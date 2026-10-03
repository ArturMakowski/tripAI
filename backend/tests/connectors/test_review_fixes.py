"""Regressions for the PR #3 review: provenance, fixture date matching, gcal errors/privacy."""

import json
import logging
from datetime import date

import httpx
import pytest
import respx

from tripai.connectors.base import SYNTHETIC_TAG, ConnectorError, FixtureNotFound
from tripai.connectors.gcal_freebusy import (
    FREEBUSY_URL,
    GCalFreeBusy,
    parse_freebusy,
    token_path,
)
from tripai.connectors.open_meteo import OpenMeteo
from tripai.connectors.serpapi import SerpApiFlights, SerpApiHotels
from tripai.connectors.travelpayouts import Travelpayouts, _fare

JAN14, JAN19 = date(2027, 1, 14), date(2027, 1, 19)


# 1. synthetic fixtures are visibly tagged; real recordings are not
async def test_synthetic_fixture_evidence_is_tagged(fixtures_mode):
    cal = await Travelpayouts().month_calendar("KRK", "FCO", "2027-01")
    assert cal.synthetic
    assert all(e.source.endswith(SYNTHETIC_TAG) for e in cal.evidence())

    fb = await GCalFreeBusy().query(date(2027, 1, 1), date(2027, 1, 31))
    assert fb.synthetic and fb.evidence()[0].source.endswith(SYNTHETIC_TAG)

    real = await SerpApiFlights().price_insights("KRK", "FCO", JAN14, JAN19)
    assert not real.synthetic
    assert all(SYNTHETIC_TAG not in e.source for e in real.evidence())


# 2. a fixture recorded for other dates is never served under the requested label
@pytest.mark.parametrize(
    "call",
    [
        lambda: SerpApiFlights().price_insights("KRK", "FCO", date(2027, 3, 10), date(2027, 3, 12)),
        lambda: SerpApiHotels().search("Rome", date(2027, 3, 10), date(2027, 3, 12), iata="FCO"),
        lambda: Travelpayouts().month_calendar("KRK", "FCO", "2027-03"),
        lambda: Travelpayouts().prices_for_dates("KRK", "FCO", date(2027, 3, 10)),
        lambda: GCalFreeBusy().query(date(2026, 10, 5), date(2026, 10, 20)),
        lambda: OpenMeteo().weather(
            41.9, 12.5, date(2027, 3, 10), date(2027, 3, 12), today=date(2026, 10, 3)
        ),
    ],
)
async def test_fixture_for_other_dates_is_not_found(fixtures_mode, call):
    with pytest.raises(FixtureNotFound):
        await call()


async def test_gcal_fixture_is_clipped_to_requested_range(fixtures_mode):
    res = await GCalFreeBusy().query(date(2027, 1, 11), date(2027, 1, 24))
    days = res.free_days()
    assert min(days) >= date(2027, 1, 11) and max(days) <= date(2027, 1, 24)
    assert all(b.start.date() <= date(2027, 1, 25) for b in res.busy)
    assert [(w.start, w.end) for w in res.free_windows(min_days=3)] == [(JAN14, JAN19)]


# 3. an unreadable calendar is an error, never "all free"
def test_calendar_errors_raise():
    payload = {
        "timeMin": "2027-01-01T00:00:00Z",
        "timeMax": "2027-01-08T00:00:00Z",
        "calendars": {
            "primary": {"busy": [], "errors": [{"domain": "global", "reason": "notFound"}]}
        },
    }
    with pytest.raises(ConnectorError, match="notFound"):
        parse_freebusy(payload, payload["timeMin"], "Europe/Warsaw")


# 4. freebusy never touches the (shared) cache
@respx.mock
async def test_freebusy_is_never_cached(disk_cache):
    token_path().write_text(json.dumps({"access_token": "a", "expires_at": 9e12}))
    payload = {
        "timeMin": "2027-01-01T00:00:00Z",
        "timeMax": "2027-01-08T00:00:00Z",
        "calendars": {"primary": {"busy": []}},
    }
    route = respx.post(FREEBUSY_URL).mock(return_value=httpx.Response(200, json=payload))
    for _ in range(2):
        await GCalFreeBusy(cache=disk_cache).query(date(2027, 1, 1), date(2027, 1, 7))
    assert route.call_count == 2
    assert not list(disk_cache.root.rglob("*.json"))


# minors
def test_null_link_does_not_crash():
    item = {
        "origin": "KRK",
        "destination": "FCO",
        "price": 1,
        "departure_at": "2027-01-14T06:00:00+01:00",
        "link": None,
    }
    assert _fare(item).link is None


def test_httpx_request_logs_are_silenced():
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING


async def test_probe_does_not_record_gcal_by_default(monkeypatch, tmp_path):
    import argparse

    from tripai.connectors import probe

    monkeypatch.setenv("TRIPAI_RECORD_FIXTURES", "1")
    monkeypatch.setenv("TRIPAI_FIXTURES_DIR", str(tmp_path / "fx"))
    token_path().write_text(json.dumps({"access_token": "a", "expires_at": 9e12}))
    payload = {
        "timeMin": "2027-01-01T00:00:00Z",
        "timeMax": "2027-01-29T00:00:00Z",
        "calendars": {"primary": {"busy": []}},
    }
    with respx.mock:
        respx.post(FREEBUSY_URL).mock(return_value=httpx.Response(200, json=payload))
        args = argparse.Namespace(
            only="gcal", routes="FCO", outbound="2027-01-14", inbound="2027-01-19"
        )
        assert await probe.probe(args) == 0
    assert not (tmp_path / "fx").exists()
