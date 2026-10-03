"""T1d: weather curve no longer saturates, sample data is labelled honestly, explain reads naturally."""

import asyncio
import json
import statistics
from datetime import date

import pytest
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from tripai.agents.explain import (
    evidence_payload,
    explain,
    fmt_dates,
    fmt_value,
    template_why,
)
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.scoring import FixtureProvider, normalise_weights, rank
from tripai.scoring.engine import weather_score
from tripai.scoring.provider import SAMPLE_SOURCE

DEMO = TasteProfile(user_id="demo", budget_pln=1800, preferred_temp_c=(12, 24),
                    interests={"food": 0.9, "history": 0.8})  # fmt: skip
JAN = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 18))]


def _recs(profile=DEMO, windows=JAN):
    cands = asyncio.run(FixtureProvider().candidates("KRK", windows))
    return rank(cands, profile, Weights(), limit=50)


# ---------------------------------------------------------------- (1) weather


def test_twelve_degrees_outside_range_is_not_good():
    assert weather_score(12, (15, 26), []) < 0.8
    assert weather_score(12, (15, 26), []) == pytest.approx(0.75 - 3 * 0.08)


def test_edge_of_wide_range_is_not_perfect():
    """The demo-profile bug: Rome 12 °C in Jan with range (12, 24) scored 100/100."""
    assert weather_score(12, (12, 24), []) == pytest.approx(0.75)
    assert weather_score(18, (12, 24), []) == 1.0
    assert weather_score(15, (12, 24), []) == pytest.approx(1 - 0.25 * 0.25)


def test_weather_is_monotonic_away_from_the_middle():
    temps = [18, 16, 14, 12, 10, 6, 2]
    scores = [weather_score(t, (12, 24), []) for t in temps]
    assert scores == sorted(scores, reverse=True) and len(set(scores)) == len(scores)


def test_weather_spreads_across_cities_for_demo_profile():
    w = {r.city: r.score.weather for r in _recs()}
    assert len(set(w.values())) >= 8
    assert statistics.pstdev(w.values()) > 0.1
    assert sum(v >= 0.95 for v in w.values()) <= 2
    assert w["Rome"] < 0.9 and w["Copenhagen"] < 0.3 < w["Málaga"]


def test_rain_and_sunshine_cost_when_known():
    base = weather_score(20, (15, 26), [])
    assert weather_score(20, (15, 26), [], rainy_day_share=0.5) == pytest.approx(base * 0.8)
    assert weather_score(20, (15, 26), [], sunshine_h=0) == pytest.approx(base * 0.85)
    assert weather_score(20, (15, 26), [], sunshine_h=10) == pytest.approx(base)
    assert weather_score(20, (15, 26), [], None, None) == base


def test_candidate_rain_feeds_the_score():
    cands = asyncio.run(FixtureProvider().candidates("KRK", JAN))
    dry = rank(cands, DEMO, limit=50)
    wet = rank([c.model_copy(update={"rainy_day_share": 1.0}) for c in cands], DEMO, limit=50)
    by_city = {r.city: r.score.weather for r in dry}
    assert all(r.score.weather < by_city[r.city] for r in wet if by_city[r.city] > 0)


@pytest.mark.parametrize(
    "w", [Weights(), Weights(price=1, weather=1, crowds=1, taste=0),
          Weights(price=0.3, weather=0.3, crowds=0.3, taste=0.3), Weights(taste=0.7, crowds=0.05)],
)  # fmt: skip
def test_normalise_weights_is_idempotent(w):
    n = normalise_weights(w)
    assert normalise_weights(n) == n
    assert round(sum(n.model_dump().values()), 4) == 1.0


# ---------------------------------------------------------------- (2) honest labels


def test_fixture_evidence_is_labelled_sample_data():
    cands = asyncio.run(FixtureProvider().candidates("KRK", JAN))
    sources = {e.source for c in cands for e in c.evidence}
    assert sources == {SAMPLE_SOURCE} == {"fixture:sample"}
    labels = " ".join(e.label for c in cands for e in c.evidence).lower()
    assert "recorded" not in labels and "liteapi" not in labels and "aviasales" not in labels


# ---------------------------------------------------------------- (3) explain display strings


def test_fmt_dates():
    assert fmt_dates(date(2027, 1, 1), date(2027, 1, 3)) == "1–3 Jan"
    assert fmt_dates(date(2026, 12, 30), date(2027, 1, 2)) == "30 Dec–2 Jan"
    assert fmt_dates(date(2027, 1, 1), date(2027, 1, 1)) == "1 Jan"


def test_payload_uses_display_strings():
    rec = _recs()[0]
    payload = json.loads(evidence_payload(rec, DEMO.interests))
    text = json.dumps(payload, ensure_ascii=False)
    assert payload["dates"] == "14–18 Jan" and payload["nights"] == 4
    assert payload["total_cost"].endswith(" PLN") and ".0 PLN" not in text
    assert "2027-01-14" not in text
    crowd = next(e for e in payload["evidence"] if "crowd" in e["label"].lower())
    assert crowd["display"].endswith("% of peak season")
    assert all("value" not in e for e in payload["evidence"])


def test_fmt_value_forms():
    rec = _recs()[0]
    by_kind = {e.kind: e for e in rec.evidence}
    assert fmt_value(by_kind["flight"]) == f"{round(by_kind['flight'].value)} PLN"
    assert fmt_value(by_kind["crowds"]) == f"{round(by_kind['crowds'].value * 100)}% of peak season"
    assert fmt_value(by_kind["weather"]).endswith(" °C")


async def test_validator_accepts_display_forms_and_rejects_inventions():
    cands = await FixtureProvider().candidates("KRK", JAN)
    rec = rank(cands, DEMO, Weights())[0]
    crowd = fmt_value(next(e for e in rec.evidence if e.kind == "crowds"))
    good = (f"{rec.city}, 14–18 Jan: {round(rec.total_cost_pln)} PLN in total, "
            f"with crowds at {crowd}.")  # fmt: skip
    calls = []

    def model_fn(messages, info: AgentInfo) -> ModelResponse:
        calls.append(1)
        return ModelResponse(parts=[TextPart(good if len(calls) > 1 else "Only 77% of peak!")])

    why = await explain(rec, DEMO.interests, model=FunctionModel(model_fn))
    assert why == good and len(calls) == 2


def test_template_reads_naturally():
    for rec in _recs():
        why = template_why(rec, DEMO.interests)
        assert "–" in why and "% of peak" in why
        assert ".0 PLN" not in why and "crowd index" not in why and "2027-" not in why


def test_peak_counterfactual_ignores_window_rain_and_sun():
    """The peak trip must not be scored with the off-season window's rain/sunshine."""
    cands = asyncio.run(FixtureProvider().candidates("KRK", JAN))
    dry = [c.model_copy(update={"rainy_day_share": 0.0, "sunshine_h": 10.0}) for c in cands]
    wet = [c.model_copy(update={"rainy_day_share": 0.9, "sunshine_h": 1.0}) for c in cands]

    def peak_scores(cs):
        return {r.city: next(c.score_total for c in r.counterfactuals if c.kind == "peak_season")
                for r in rank(cs, DEMO, Weights(), limit=50)}  # fmt: skip

    assert peak_scores(dry) == peak_scores(wet)
    # ...but peak-month rain/sun on the PeakQuote itself is used
    rainy_peak = [c.model_copy(update={"peak": c.peak.model_copy(update={"rainy_day_share": 1.0})})
                  for c in cands]  # fmt: skip
    assert all(peak_scores(rainy_peak)[k] < v for k, v in peak_scores(cands).items() if v > 0)


def test_percent_only_numbers_need_a_percent_sign():
    from tripai.agents.explain import allowed_numbers, display_numbers, ungrounded_numbers_display

    rec = _recs()[0]
    # the crowd label now states the percentage itself; strip it to test the display-only path
    rec = rec.model_copy(update={"evidence": [
        e.model_copy(update={"label": "Crowds"}) if e.kind == "crowds" else e for e in rec.evidence
    ]})  # fmt: skip
    crowd = round(next(e.value for e in rec.evidence if e.kind == "crowds") * 100)
    allowed, pct = allowed_numbers(rec), display_numbers(rec)
    assert crowd in pct and crowd not in allowed
    assert ungrounded_numbers_display(f"crowds at {crowd}% of peak", allowed, pct) == []
    assert ungrounded_numbers_display(f"crowds at {crowd} % of peak", allowed, pct) == []
    assert ungrounded_numbers_display(f"only {crowd} PLN cheaper", allowed, pct) == [str(crowd)]
    assert ungrounded_numbers_display("a 77% discount", allowed, pct) == ["77"]
