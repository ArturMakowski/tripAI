"""'What would flip it' in plain language (PL+EN), naming the concrete modelled trigger."""

import asyncio
import re
from datetime import date

import pytest

from tripai import i18n
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.scoring import FixtureProvider, rank
from tripai.scoring.types import Candidate

W = FreeWindow(start=date(2026, 11, 7), end=date(2026, 11, 11))
P = TasteProfile(user_id="f", interests={"food": 0.9, "history": 0.7})
FORECAST = re.compile(r"forecast|will be (warmer|sunnier|colder|less crowded)|prognoz|"
                      r"będzie (cieplej|słonecznie|zimniej|mniej tłoczno)", re.IGNORECASE)  # fmt: skip


def _cand(city, iata, cost, crowd=0.3, temp=20):
    return Candidate(city=city, country="X", iata=iata, window=W, flight_cost_pln=cost,
                     hotel_cost_pln=0, temp_c=temp, crowd=crowd,
                     seasonal_median_cost_pln=1500)  # fmt: skip


def test_price_route_names_the_flight_and_the_winner():
    recs_en = rank([_cand("Málaga", "AGP", 1000), _cand("Catania", "CTA", 1100)], P, lang="en")
    recs_pl = rank([_cand("Málaga", "AGP", 1000), _cand("Catania", "CTA", 1100)], P, lang="pl")
    f_en, f_pl = recs_en[0].flip, recs_pl[0].flip
    assert f_en.factor is None and f_en.price_increase_pln  # identical otherwise: price only
    n = f_en.price_increase_pln
    assert f_en.text == f"If the flight to Málaga gets {n:.0f} PLN pricier, Catania wins."
    assert f_pl.text == (
        f"Jeśli lot do Malagi podrożeje o {i18n.fmt_pln(n, 'pl')}, lepszą opcją będzie Katania."
    )


def test_weight_route_is_about_priorities_not_forecasts():
    # Catania is warmer-fit but pricier: only "weather matters more" (or a price change) flips it
    a = _cand("Málaga", "AGP", 800, temp=10)
    b = _cand("Catania", "CTA", 1400, temp=21)
    for lang in ("en", "pl"):
        f = rank([a, b], P, Weights(price=0.6, weather=0.2, crowds=0.1, taste=0.1), lang=lang)[
            0
        ].flip
        assert f.factor == "weather"
        if lang == "en":
            assert "weather matters more to you (weight 0.20 → " in f.text
            assert f.text.endswith("Catania wins.")
        else:
            assert "pogoda będzie dla Ciebie ważniejsza (waga 0,20 → " in f.text
            assert f.text.endswith("lepszą opcją będzie Katania.")
        assert not FORECAST.search(f.text), f.text


@pytest.mark.parametrize("lang", ["en", "pl"])
def test_every_flip_text_is_plain_and_verifiable(lang):
    windows = [W, FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 18))]
    cands = asyncio.run(FixtureProvider().candidates("KRK", windows))
    for p in (P, TasteProfile(user_id="b", interests={"beach": 1}, dislikes=["crowds"])):
        for r in rank(cands, p, lang=lang):
            t = r.flip.text if r.flip else None
            if t is None:
                continue
            start = ("If ", "No single") if lang == "en" else ("Jeśli ", "Żadna")
            assert t.startswith(start), t
            assert not FORECAST.search(t), t
            assert "->" not in t and "would overtake" not in t and "wyprzedziłoby" not in t
            if r.flip.weight_to is not None:
                assert i18n.fmt_fixed(r.flip.weight_to, 2, lang) in t
            if r.flip.price_increase_pln:
                assert i18n.fmt_pln(r.flip.price_increase_pln, lang) in t


def test_city_names_in_polish():
    assert i18n.city("Málaga", "pl", case="gen") == "Malagi"
    assert i18n.city("Athens", "pl") == "Ateny" and i18n.city("Athens", "pl", "gen") == "Aten"
    assert i18n.city("Lisbon", "en") == "Lisbon"
    assert i18n.city("Gdańsk", "pl", case="gen") == "miasta Gdańsk"  # unknown: safe fallback


def test_crowd_labels():
    cands = asyncio.run(FixtureProvider().candidates("KRK", [W]))
    for lang, prefix, tail in (("pl", "Tłum: ", "% szczytu sezonu"),
                               ("en", "Crowds: ", "% of peak season")):  # fmt: skip
        with i18n.using(lang):
            ev = next(e for e in asyncio.run(FixtureProvider().candidates("KRK", [W]))[0].evidence
                      if e.kind == "crowds")  # fmt: skip
        assert ev.label == f"{prefix}{round(ev.value * 100)}{tail}"
    # language never changes the receipt hash (labels are presentation)
    assert rank(cands, P, lang="en")[0].inputs_hash == rank(cands, P, lang="pl")[0].inputs_hash


def test_live_seed_crowd_label():
    from tripai.seed import load

    key = next(iter(load.crowds()))
    with i18n.using("pl"):
        ev = load.crowd_evidence(key, 8)
    prof = load.crowd(key)
    if prof.peak_ratio is not None:
        assert ev.label.startswith(f"Tłum: {round(prof.peak_ratio[7] * 100)}% szczytu sezonu (")
        assert "sierpień" in ev.label
    else:
        assert ev.label.startswith("Tłum: ") and "0 = najspokojniejszy" in ev.label


def test_plural_city_agreement():
    recs = rank([_cand("Athens", "ATH", 1000), _cand("Málaga", "AGP", 1100)], P, lang="pl")
    # #2 (Málaga): what would lift it over Athens -> Málaga wins, singular verb
    assert (
        recs[1].flip.text
        == "Jeśli lot do Aten podrożeje o "
        + i18n.fmt_pln(recs[1].flip.price_increase_pln, "pl")
        + ", lepszą opcją będzie Malaga."
    )
    recs = rank([_cand("Málaga", "AGP", 1000), _cand("Athens", "ATH", 1100)], P, lang="pl")
    assert recs[0].flip.text.endswith("lepszą opcją będą Ateny.")
