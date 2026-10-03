"""Origin airports: every one the app offers has coordinates, a school-break region and a label that
names the city it serves (secondary airports never pass for the city: Warszawa-Modlin, not Modlin)."""

import pytest

from tripai.seed import load
from tripai.seed.airports import ORIGIN_LABELS, ORIGINS


def test_every_origin_is_seeded_with_city_and_label():
    seeded = {a.iata: a for a in load.origin_airports()}
    assert set(seeded) == set(ORIGINS) == {"KRK", "WAW", "WMI", "KTW", "GDN", "WRO", "POZ", "RZE"}
    for code, ap in seeded.items():
        assert ap.country == "PL" and ap.lat and ap.lon
        assert ap.city == ORIGIN_LABELS[code]["city"] and ap.label == ORIGIN_LABELS[code]["label"]
        for lang in ("pl", "en"):  # the label always starts with the city it serves
            assert ap.label[lang].startswith(ap.city[lang])


def test_modlin_is_grouped_and_named_under_warsaw():
    waw, wmi = load.airport("WAW"), load.airport("WMI")
    assert wmi.city == waw.city == {"pl": "Warszawa", "en": "Warsaw"}
    assert load.airport_label("WMI", "pl") == "Warszawa-Modlin (WMI)"
    assert load.airport_label("WMI", "en") == "Warsaw Modlin (WMI)"
    assert load.airport_label("WAW", "pl") == "Warszawa-Chopin (WAW)"
    assert load.airport_label("KTW", "pl") == "Katowice-Pyrzowice (KTW)"
    assert load.airport_label("KRK", "pl") == "Kraków (KRK)"
    assert load.airport_label("FCO", "pl") == "FCO"  # destinations keep their code


@pytest.mark.parametrize("code", ORIGINS)
def test_every_origin_has_school_breaks(code):
    """Regression: WMI/WRO/POZ/RZE had no voivodeship, so school_breaks(airport=...) raised."""
    assert load.voivodeship_for_airport(code).startswith("PL-")
    breaks = load.school_breaks(airport=code)
    assert any(b.kind == "ferie" for b in breaks)  # winter break of that voivodeship
    assert load.voivodeship_for_airport("WMI") == load.voivodeship_for_airport("WAW")


def test_one_origin_list_and_a_route_prior_for_every_origin():
    from tripai.seed import cities

    assert cities.ORIGINS is ORIGINS  # single source: tripai.seed.airports
    assert set(cities.MAIN_ORIGINS) | set(cities.OTHER_ORIGIN_PRIORS) == set(ORIGINS)
    seeded = load.cities()
    for code in ORIGINS:  # every origin has at least one direct-route prior in data/cities.json
        assert any(code in c.direct_from for c in seeded), code
    assert {c.id for c in seeded if "WMI" in c.direct_from} == set(
        cities.OTHER_ORIGIN_PRIORS["WMI"]
    )


@pytest.mark.parametrize("code", ORIGINS)
def test_every_origin_produces_candidates_in_fixture_mode(code, monkeypatch):
    """No origin the picker offers dead-ends: recorded data for KRK, labelled sample data else."""
    import asyncio
    from datetime import date

    from tripai.live.provider import LiveProvider
    from tripai.models import FreeWindow

    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "1")
    w = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
    got = asyncio.run(LiveProvider(use_fallback=True, today=date(2026, 10, 3)).candidates(code, w))
    assert got
    for c in got:
        assert all(
            e.source.startswith("fixture:") or "fixture]" in e.source
            for e in c.evidence
            if e.kind == "flight"
        )
