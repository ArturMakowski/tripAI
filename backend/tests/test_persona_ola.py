"""Demo persona "Ola" (the deck + video): Kraków, 7-11 Nov 2026, 1 person, 1 800 PLN, avoids
crowds. Prod-like data: SerpApi spent, so prices are estimates clustered around the budget."""

import asyncio
from datetime import date

import pytest
from fastapi.testclient import TestClient

from tripai.agents.fit import (
    clear_cache,
    fit,
    needs_a_minus,
    rules_verdict,
    style_profile,
    trip_facts,
)
from tripai.api import create_app
from tripai.models import FreeWindow, TasteProfile
from tripai.scoring import FixtureProvider, rank

NOV = FreeWindow(start=date(2026, 11, 7), end=date(2026, 11, 11))
OLA_DNA = {"answers": {"q5": 4, "q8": 4, "q11": 5}, "yes_no": {"y2": True}, "lang": "pl"}
# estimate prices like prod on a spent-SerpApi day (totals in PLN, one person)
EST = {"NAP": 1554, "ATH": 1808, "MLA": 1887, "AGP": 1991, "LIS": 2103, "FCO": 2248,
       "BCN": 2381, "EDI": 2583, "CDG": 2589, "CPH": 2983}  # fmt: skip


class EstimateProvider(FixtureProvider):
    """Sample cities with prod-like *estimate* prices for the window (no exact-date price)."""

    async def candidates(self, origin, windows, luxury="standard", **kw):
        out = []
        for c in await super().candidates(origin, windows, luxury):
            total = EST[c.iata]
            hotel = round(total * 0.6)
            out.append(c.model_copy(update={"flight_cost_pln": total - hotel,
                                            "hotel_cost_pln": hotel,
                                            "price_status": "estimate"}))  # fmt: skip
        return out


@pytest.fixture(autouse=True)
def _fresh():
    clear_cache()


def _ola(c: TestClient, budget: int | None = 1800) -> dict:
    profile = c.post("/profile/dna", json=OLA_DNA).json()["profile"]
    return profile | {"origin_airports": ["KRK"], "budget_pln": budget}


def _recs(c: TestClient, profile: dict, phase: str = "full") -> list[dict]:
    body = {"profile": profile, "windows": [NOV.model_dump(mode="json")], "limit": 10,
            "lang": "pl"}  # fmt: skip
    r = c.post(f"/recommendations?phase={phase}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("budget", [1800, None])
def test_ola_gets_a_ranked_list_with_main_cards(budget):
    """Demo blocker: a realistic budget + DNA must not collapse into 'Not your style'."""
    c = TestClient(create_app(provider=EstimateProvider()))
    recs = _recs(c, _ola(c, budget))
    fits = [r["fit"] for r in recs if r["fit"]]
    main = [r for r in recs if (r["fit"] or {}).get("label") != "poor_fit"]
    assert len(main) >= 3, [(r["city"], (r["fit"] or {}).get("label")) for r in recs]
    assert fits and all(f["label"] != "poor_fit" for f in fits)
    if budget:  # estimates over budget + 10% stay out; the ones that fit are all shown
        assert all(r["total_cost_pln"] <= 1980 for r in recs)


def test_fit_verdict_ignores_price_and_budget():
    """Price over budget is the budget's job (status / flags), never a 'not your style'."""
    ola = TasteProfile(user_id="ola", budget_pln=1800, dislikes=["crowds"],
                       traits={"q5": 4.0, "q8": 4.0, "q11": 5.0})  # fmt: skip
    cands = asyncio.run(EstimateProvider().candidates("KRK", [NOV]))
    for r in rank(cands, ola, limit=10):
        # 3x the price: the price factor drops to 0 and the total with it (default weights)
        total = round(r.score.total - 0.4 * r.score.price, 4)
        pricey = r.model_copy(update={"total_cost_pln": r.total_cost_pln * 3,
                                      "score": r.score.model_copy(update={"price": 0.0,
                                                                          "total": total})})  # fmt: skip
        assert rules_verdict(pricey, ola).label == rules_verdict(r, ola).label, r.city


def test_mixed_or_poor_always_names_a_minus():
    ola = TasteProfile(
        user_id="ola", dislikes=["crowds"], traits={"q5": 4.0, "q8": 4.0, "q11": 5.0}
    )
    for month in (1, 7, 11):
        w = FreeWindow(start=date(2027 if month < 11 else 2026, month, 7),
                       end=date(2027 if month < 11 else 2026, month, 11))  # fmt: skip
        for r in rank(asyncio.run(FixtureProvider().candidates("KRK", [w])), ola, limit=10):
            v = rules_verdict(r, ola)
            if v.label in ("mixed", "poor_fit"):
                assert v.concerns, (r.city, v.label, v.summary)
            else:
                assert v.label in ("good_fit", "great_fit")


def test_needs_a_minus_upgrades_an_all_positive_mixed():
    from tripai.agents.fit import FitDraft
    from tripai.models import FitPoint

    d = FitDraft(label="mixed", confidence=0.6, summary="Pasuje tylko częściowo: spokojnie.",
                 matches=[FitPoint(text="Quiet season", dna=["q11"])], concerns=[])  # fmt: skip
    up = needs_a_minus(d)
    assert up.label == "good_fit" and "częściowo" not in up.summary
    kept = needs_a_minus(d.model_copy(update={"concerns": [FitPoint(text="Hot", dna=["q6"])]}))
    assert kept.label == "mixed"


def test_same_verdict_on_every_reload_and_in_both_phases():
    c = TestClient(create_app(provider=EstimateProvider()))
    ola = _ola(c)
    runs = [_recs(c, ola, phase) for phase in ("fast", "full", "full", "full")]
    full = [{r["id"]: (r["fit"] or {}).get("label") for r in run} for run in runs[1:]]
    assert full[0] == full[1] == full[2]
    # a brand-new session with the same profile gets the same verdicts too
    c2 = TestClient(create_app(provider=EstimateProvider()))
    again = {r["id"]: (r["fit"] or {}).get("label") for r in _recs(c2, _ola(c2))}
    assert again == full[0]


async def test_cached_ai_verdict_is_keyed_per_profile_not_per_price(candidates):
    """The AI verdict for a trip is reused when only prices change (other phase, refresh), and
    is not shared with a different style profile."""
    import json

    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    calls = []

    def gpt(messages, info):
        calls.append(1)
        draft = {"label": "good_fit", "confidence": 0.8, "summary": "Spokojnie i smacznie.",
                 "matches": [{"text": "Spokojny sezon", "dna": ["q11"]}], "concerns": []}  # fmt: skip
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(draft))])

    m = FunctionModel(gpt, model_name="gpt-ola")
    ola = TasteProfile(user_id="ola-1", dislikes=["crowds"], traits={"q5": 4.0, "q11": 5.0})
    rec = rank(candidates, ola, limit=1)[0]
    a = await fit(rec, ola, model=m, engine="llm")
    repriced = rec.model_copy(update={"total_cost_pln": rec.total_cost_pln + 300,
                                      "flight_cost_pln": rec.flight_cost_pln + 300})  # fmt: skip
    same_style_other_user = ola.model_copy(update={"user_id": "ola-2", "budget_pln": 1800})
    b = await fit(repriced, same_style_other_user, model=m, engine="llm")
    assert len(calls) == 1 and a.label == b.label and a.summary == b.summary
    assert trip_facts(rec) == trip_facts(repriced)
    assert style_profile(ola) == style_profile(same_style_other_user)
    other_style = ola.model_copy(update={"traits": {"q5": 1.0, "q11": 1.0}})
    await fit(rec, other_style, model=m, engine="llm")
    assert len(calls) == 2
