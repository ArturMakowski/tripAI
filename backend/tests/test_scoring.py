from datetime import date

import pytest

from tripai.models import FreeWindow, ScoreBreakdown, TasteProfile, Weights
from tripai.scoring import normalise_weights, rank, score_candidate
from tripai.scoring.engine import (
    crowd_score,
    inputs_hash,
    price_score,
    taste_score,
    weather_score,
)
from tripai.scoring.types import Candidate


def test_component_scores():
    assert price_score(1000, 2500, 1000) == 0.5 * 1 + 0.5 * 0.5
    assert price_score(4000, 2500, 1000) == 0.0
    assert weather_score(20, (15, 26), []) == 1.0
    assert weather_score(30, (15, 26), []) == pytest.approx(0.6)
    assert weather_score(30, (15, 26), ["heat"]) == pytest.approx(0.2)
    assert crowd_score(0.3) == 0.7
    assert taste_score(["food"], {"food": 1.0, "beach": 1.0}, []) == 0.5
    assert taste_score(["food", "nightlife"], {"food": 1.0}, ["nightlife"]) == 0.75
    assert taste_score([], {}, []) == 0.5


def test_weights_normalised():
    w = normalise_weights(Weights(price=2, weather=1, crowds=1, taste=0))
    assert (w.price, w.weather, w.crowds, w.taste) == (0.5, 0.25, 0.25, 0.0)
    assert normalise_weights(Weights(price=0, weather=0, crowds=0, taste=0)) == normalise_weights(
        Weights()
    )


def test_rank_is_deterministic_and_sorted(candidates, profile):
    a = rank(candidates, profile)
    b = rank(list(reversed(candidates)), profile)
    assert [r.model_dump() for r in a] == [r.model_dump() for r in b]
    totals = [r.score.total for r in a]
    assert totals == sorted(totals, reverse=True)
    assert [r.rank for r in a] == list(range(1, len(a) + 1))
    assert len({r.iata for r in a}) == len(a)  # best window per city
    assert all(isinstance(r.score, ScoreBreakdown) for r in a)


def test_inputs_hash(candidates, profile):
    h = inputs_hash(candidates, profile, Weights())
    assert len(h) == 64
    assert h == inputs_hash(list(reversed(candidates)), profile, Weights())
    assert h != inputs_hash(candidates, profile, Weights(price=0.9))
    assert h != inputs_hash(candidates, profile.model_copy(update={"budget_pln": 9999}), Weights())
    assert {r.inputs_hash for r in rank(candidates, profile)} == {h}


def test_counterfactuals(candidates, profile):
    top = rank(candidates, profile)[0]
    kinds = {c.kind for c in top.counterfactuals}
    assert kinds == {"peak_season", "next_window", "runner_up"}
    peak = next(c for c in top.counterfactuals if c.kind == "peak_season")
    assert peak.cost_delta_pln > 0  # off-season beats peak on price
    assert peak.score_delta > 0
    nxt = next(c for c in top.counterfactuals if c.kind == "next_window")
    assert nxt.window != top.window and nxt.city == top.city
    assert nxt.score_delta >= 0


def test_summer_window_loses_for_crowd_and_heat_haters(candidates):
    p = TasteProfile(user_id="u", interests={"food": 1}, dislikes=["heat", "crowds"])
    recs = rank(candidates, p, Weights(crowds=0.5, weather=0.3, price=0.1, taste=0.1))
    assert recs[0].window.start.month != 7


def test_flip_hint_actually_flips(candidates, profile):
    recs = rank(candidates, profile)
    top, second = recs[0], recs[1]
    flip = top.flip
    assert flip and flip.rival_id == second.id
    if flip.factor:
        w = normalise_weights(Weights()).model_dump()
        bump = flip.weight_to * 1.02
        w = {k: v * (1 - bump) / (1 - w[flip.factor]) for k, v in w.items()}
        w[flip.factor] = bump
        flipped = rank(candidates, profile, Weights(**w))
        assert flipped.index(next(r for r in flipped if r.id == second.id)) < next(
            i for i, r in enumerate(flipped) if r.iata == top.iata
        )
    assert recs[1].flip.rival_id == top.id  # #2 says what would lift it over #1


def test_price_flip_amount(profile):
    w = FreeWindow(start=date(2026, 11, 7), end=date(2026, 11, 11))

    def cand(iata, cost):
        return Candidate(city=iata, country="X", iata=iata, window=w, flight_cost_pln=cost,
                         hotel_cost_pln=0, temp_c=20, crowd=0.3, seasonal_median_cost_pln=1500)  # fmt: skip

    a, b = cand("AAA", 1000), cand("BBB", 1100)
    recs = rank([a, b], profile)
    assert recs[0].iata == "AAA"
    inc = recs[0].flip.price_increase_pln
    assert inc and 90 <= inc <= 110  # identical otherwise, so ~100 PLN flips it
    s_a = score_candidate(
        a.model_copy(update={"flight_cost_pln": 1000 + inc + 1}), profile, Weights()
    )
    assert s_a.total < score_candidate(b, profile, Weights()).total
