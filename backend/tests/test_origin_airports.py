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
    assert load.airport_label("WMI", "en") == "Warsaw-Modlin (WMI)"
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
