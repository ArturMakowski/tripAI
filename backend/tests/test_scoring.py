from datetime import date

import pytest

from tripai.models import FreeWindow, ScoreBreakdown, TasteProfile, Weights
from tripai.scoring import normalise_weights, rank, score_candidate
from tripai.scoring.engine import (
    candidate_id,
    crowd_score,
    inputs_hash,
    price_score,
    taste_score,
    weather_score,
    with_extra_cost,
    with_weight,
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


FLIP_SCENARIOS = [
    (
        TasteProfile(user_id="a", budget_pln=2500, interests={"food": 0.9, "history": 0.7}),
        Weights(),
    ),
    (
        TasteProfile(
            user_id="reviewer",
            interests={"food": 0.9, "beach": 0.6, "history": 0.4},
            dislikes=["crowds"],
        ),
        Weights(),
    ),
    (TasteProfile(user_id="b", interests={"beach": 1}, dislikes=["heat"]), Weights(price=0.1)),
    (TasteProfile(user_id="c", luxury="luxury"), Weights(taste=0.7, crowds=0.05)),
]
FLIP_WINDOWS = [
    FreeWindow(start=date(2026, 11, 7), end=date(2026, 11, 11)),
    FreeWindow(start=date(2026, 7, 10), end=date(2026, 7, 14)),
    FreeWindow(start=date(2027, 5, 27), end=date(2027, 5, 30)),
    FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19)),
]


@pytest.mark.parametrize(("profile", "weights"), FLIP_SCENARIOS)
def test_every_flip_hint_actually_flips(profile, weights):
    """Apply each hint exactly as displayed (weight slider / price) and the pair must swap."""
    import asyncio

    from tripai.scoring import FixtureProvider

    cands = asyncio.run(FixtureProvider().candidates("KRK", FLIP_WINDOWS, profile.luxury))
    by_id = {candidate_id(c): c for c in cands}
    recs = rank(cands, profile, weights)
    checked = 0
    for i, r in enumerate(recs):
        if r.flip is None:
            continue
        this, rival = by_id[r.id], by_id[r.flip.rival_id]
        lo, hi = (this, rival) if i > 0 else (rival, this)  # lo should overtake hi
        assert r.flip.factor or r.flip.price_increase_pln, r.flip.text
        if r.flip.factor:
            assert r.flip.weight_to != r.flip.weight_from  # no no-op hints
            assert f"{r.flip.weight_to:.2f}" in r.flip.text
            w2 = with_weight(weights, r.flip.factor, r.flip.weight_to)
            assert score_candidate(lo, profile, w2).total > score_candidate(hi, profile, w2).total
            order = [x.iata for x in rank([lo, hi], profile, w2)]
            assert order == [lo.iata, hi.iata], r.flip.text
            checked += 1
        if r.flip.price_increase_pln:
            hi2 = with_extra_cost(hi, r.flip.price_increase_pln)
            assert (
                score_candidate(lo, profile, weights).total
                > score_candidate(hi2, profile, weights).total
            )
            assert [x.iata for x in rank([lo, hi2], profile, weights)] == [lo.iata, hi.iata]
            checked += 1
    assert checked >= len(recs) - 1


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


def test_no_peak_counterfactual_inside_peak_month(profile):
    import asyncio

    from tripai.scoring import FixtureProvider

    jul = [FreeWindow(start=date(2026, 7, 10), end=date(2026, 7, 14))]
    cands = asyncio.run(FixtureProvider().candidates("KRK", jul))
    for r in rank(cands, profile):
        peak = [c for c in r.counterfactuals if c.kind == "peak_season"]
        assert not peak or (r.window.start.month, r.window.end.month) != (7, 7), r.city


def test_same_dates_different_source_deduped(candidates, profile):
    dup = [c.model_copy(update={"window": c.window.model_copy(update={"source": "gcal"})})
           for c in candidates]  # fmt: skip
    recs = rank(candidates + dup, profile)
    for r in recs:
        nxt = [c for c in r.counterfactuals if c.kind == "next_window"]
        assert all((c.window.start, c.window.end) != (r.window.start, r.window.end) for c in nxt)
