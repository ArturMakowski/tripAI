"""Checks the committed data/*.json through the typed loader (offline)."""

from datetime import date

import pytest

from tripai.models import Evidence
from tripai.seed import load
from tripai.seed.cities import ORIGINS, TAGS


@pytest.mark.parametrize(
    "name", ["cities.json", "crowds.json", "holidays.json", "attractions.json"]
)
def test_every_file_has_provenance(name):
    m = load.meta(name)
    assert m.source and m.fetched_at and m.generator.startswith("uv run python -m tripai.seed.")


def test_cities_are_well_formed():
    cs = load.cities()
    assert len(cs) >= 30
    assert len({c.id for c in cs}) == len(cs) == len({c.iata for c in cs})
    for c in cs:
        assert set(c.tags) == set(TAGS) and all(0 <= w <= 1 for w in c.tags.values())
        assert set(c.direct_from) <= set(ORIGINS)
        assert -90 <= c.lat <= 90 and -180 <= c.lon <= 180
        assert c.iata in c.airports


def test_city_lookup_by_id_iata_and_secondary_airport():
    assert load.city("rome") is load.city("FCO") is load.city("cia")
    with pytest.raises(KeyError):
        load.city("XXX")


def test_every_city_has_a_normalised_crowd_profile():
    for c in load.cities():
        p = load.crowd(c.id)
        assert len(p.score) == 12 and all(0 <= s <= 1 for s in p.score)
        if p.geo_level != "proxy":
            assert min(p.score) == 0 and max(p.score) == 1
            assert p.nights and p.peak_ratio and max(p.peak_ratio) == 1


def test_summer_is_busier_than_winter_on_the_med():
    for key in ("barcelona", "split", "heraklion"):
        assert load.crowd_score(key, 8) > 0.9
        assert load.crowd_score(key, 1) < 0.2


def test_crowd_evidence_uses_shared_contract():
    ev = load.crowd_evidence("rome", 1)
    assert isinstance(ev, Evidence)
    assert ev.kind == "crowds" and ev.source.startswith("eurostat") and ev.unit == "0-1"
    with pytest.raises(ValueError):
        load.crowd_score("rome", 13)


def test_pl_public_holidays_and_long_weekends():
    names = {h.date: h.name for h in load.public_holidays("PL")}
    assert date(2027, 11, 11) in names and date(2026, 12, 25) in names
    assert any(w.bridge_days for w in load.long_weekends(date(2027, 1, 1), date(2027, 12, 31)))


def test_ferie_per_origin_airport():
    def ferie(airport):
        return [(b.start, b.end) for b in load.school_breaks(airport=airport) if b.kind == "ferie"]

    assert ferie("KRK") == [(date(2027, 2, 15), date(2027, 2, 28))]
    assert ferie("KTW") == [(date(2027, 1, 18), date(2027, 1, 31))]
    assert ferie("WAW") == ferie("GDN") == [(date(2027, 2, 1), date(2027, 2, 14))]


def test_crowd_flags_for_destination_holidays():
    flags = load.crowd_flags("rome", date(2027, 4, 24), date(2027, 4, 26))
    assert any("Liberation" in f for f in flags)


def test_crowd_flags_ignore_other_regions_holidays():
    window = (date(2027, 2, 27), date(2027, 3, 1))
    assert not any(
        "Andaluc" in f or "Balearic" in f for f in load.crowd_flags("barcelona", *window)
    )
    assert any("Balearic" in f for f in load.crowd_flags("palma", *window))
    assert any("Andaluc" in f for f in load.crowd_flags("malaga", *window))


def test_every_city_has_iso_subdivisions():
    for c in load.cities():
        assert c.subdivisions and all(s.startswith(f"{c.country}-") for s in c.subdivisions)


def test_unknown_origin_airport_raises_instead_of_returning_all_ferie():
    with pytest.raises(KeyError):
        load.school_breaks(airport="LCJ")  # not an origin we offer
    for airport in ORIGINS:  # every supported origin maps to a voivodeship
        assert load.voivodeship_for_airport(airport).startswith("PL-")


def test_crowd_evidence_url_matches_source_dataset():
    for c in load.cities():
        ev = load.crowd_evidence(c.id, 7)
        dataset = "tour_occ_nim/" if load.crowd(c.id).geo_level == "country" else "tour_occ_nin2m/"
        assert dataset in ev.url, c.id
    assert "estimated from comparable regions" in load.crowd_evidence("london", 1).label


def test_crowd_evidence_survives_degenerate_profile(monkeypatch):
    p = load.crowd("rome").model_copy(update={"peak_ratio": [0.0] * 12})
    monkeypatch.setitem(load.crowds(), "rome", p)
    assert load.crowd_evidence("rome", 3).value == p.score[2]


def test_attractions_ranked_by_taste():
    items = load.attractions("rome")
    assert 1 <= len(items) <= 8 and all(a.url.startswith("https://") for a in items)
    for c in load.cities():
        assert load.attractions(c.id), c.id
    nature_first = load.attractions("catania", tags={"nature": 1.0}, limit=1)
    assert "nature" in nature_first[0].tags
