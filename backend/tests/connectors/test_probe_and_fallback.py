import argparse
import sys
import types

import pytest

from tripai.connectors import fli_dates, probe
from tripai.connectors.base import ConnectorError


async def test_probe_skips_sources_without_credentials(capsys):
    args = argparse.Namespace(
        only="serpapi_explore,serpapi_flights,serpapi_hotels,travelpayouts,gcal",
        routes="FCO",
        outbound="2027-01-14",
        inbound="2027-01-19",
    )
    assert await probe.probe(args) == 0
    out = capsys.readouterr().out
    assert out.count("skipped") == 5


async def test_fli_missing_is_connector_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "fli", None)
    with pytest.raises(ConnectorError, match="fli"):
        await fli_dates.search_dates("KRK", "FCO", *_jan())


async def test_fli_results_are_mapped(monkeypatch):
    from datetime import datetime

    row = types.SimpleNamespace(
        date=(datetime(2027, 1, 14), datetime(2027, 1, 19)),  # noqa: DTZ001 (fli is naive)
        price=74.0,
        currency=None,
    )
    monkeypatch.setattr(fli_dates, "_search_sync", lambda *a: [row])
    res = await fli_dates.search_dates("KRK", "FCO", *_jan())
    assert res.cheapest().price == 74.0 and res.currency == "USD?"
    assert res.evidence()[0].source == "google_flights_via_fli"


def _jan():
    from datetime import date

    return date(2027, 1, 1), date(2027, 1, 31)
