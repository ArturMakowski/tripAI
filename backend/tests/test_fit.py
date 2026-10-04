import json

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse, RetryPromptPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from tripai.agents.explain import allowed_numbers, ungrounded_numbers
from tripai.agents.fit import (
    LABELS,
    NEUTRAL_PREFIX,
    FitDraft,
    clear_cache,
    dna_answers,
    fit,
    label_from_score,
    point_problems,
    rules_verdict,
)
from tripai.agents.fit_eval import (
    DEFAULT_CASES,
    case_profile,
    case_recommendation,
    evaluate,
    format_report,
    load_cases,
)
from tripai.api import create_app
from tripai.models import FitPoint, TasteProfile
from tripai.scoring import rank


@pytest.fixture(autouse=True)
def _fresh_cache():
    clear_cache()


@pytest.fixture
def crowd_avoider() -> TasteProfile:
    return TasteProfile(user_id="c", dislikes=["crowds"], traits={"q11": 5, "q8": 5, "q5": 4})


def _rec(candidates, profile, month, min_crowd=0.0):
    return next(r for r in rank(candidates, profile, limit=50, one_per_city=False)
                if r.window.start.month == month and (r.crowd or 0) >= min_crowd)  # fmt: skip


def _draft(**kw) -> dict:
    base = {"label": "good_fit", "confidence": 0.8, "summary": "Nice match.",
            "matches": [], "concerns": []}  # fmt: skip
    return base | kw


def _tool(info: AgentInfo, args: dict) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(args))])


# ---------------------------------------------------------------- grounding


def test_point_problems(candidates, crowd_avoider):
    rec = _rec(candidates, crowd_avoider, 7)
    a = dna_answers(crowd_avoider)
    crowd_idx = next(i for i, e in enumerate(rec.evidence) if e.kind == "crowds")
    crowd = rec.evidence[crowd_idx].value
    ok = FitPoint(text=f"Crowd index {crowd} in July", dna=["q11"], evidence=[crowd_idx])
    assert point_problems(ok, rec, a) == []
    assert point_problems(FitPoint(text="You rated it 5/5", dna=["q11"]), rec, a) == []
    assert point_problems(FitPoint(text="uncited"), rec, a)
    assert point_problems(FitPoint(text="x", dna=["q99"]), rec, a)
    assert point_problems(FitPoint(text="x", evidence=[len(rec.evidence)]), rec, a)
    # a number from evidence that is NOT cited is rejected
    flight = next(e for e in rec.evidence if e.kind == "flight").value
    assert point_problems(FitPoint(text=f"{flight:.0f} PLN flight", dna=["q9"]), rec, a)


async def test_fit_agent_retries_then_succeeds(candidates, crowd_avoider):
    rec = _rec(candidates, crowd_avoider, 7)
    calls = []

    def model_fn(messages, info: AgentInfo) -> ModelResponse:
        calls.append(1)
        if len(calls) == 1:  # invented number + nonexistent evidence index
            bad = FitPoint(text="Only 12345 people", dna=[], evidence=[99])
            return _tool(info, _draft(label="poor_fit", concerns=[bad.model_dump()]))
        retry = [p for m in messages for p in getattr(m, "parts", [])
                 if isinstance(p, RetryPromptPart)]  # fmt: skip
        assert retry and "12345" in str(retry[-1].content) and "99" in str(retry[-1].content)
        good = FitPoint(text="Peak crowds, which you avoid", dna=["q11"], evidence=[4])
        return _tool(info, _draft(label="poor_fit", summary="Crowded in July.",
                                  concerns=[good.model_dump()]))  # fmt: skip

    v = await fit(rec, crowd_avoider, model=FunctionModel(model_fn))
    assert len(calls) == 2
    assert v.label == "poor_fit"
    assert v.model != "rules" and v.inputs_hash == rec.inputs_hash and v.created_at
    assert v.concerns[0].dna == ["q11"]


async def test_fit_agent_falls_back_to_rules(candidates, crowd_avoider):
    rec = _rec(candidates, crowd_avoider, 7)

    def model_fn(messages, info):
        return _tool(info, _draft(summary="Costs 99999 PLN"))

    v = await fit(rec, crowd_avoider, model=FunctionModel(model_fn))
    assert v.model == "rules"
    assert v.label == rules_verdict(rec, crowd_avoider).label


async def test_fit_cache(candidates, crowd_avoider):
    rec = _rec(candidates, crowd_avoider, 11)
    calls = []

    def model_fn(messages, info):
        calls.append(1)
        return _tool(info, _draft())

    m = FunctionModel(model_fn)
    a = await fit(rec, crowd_avoider, model=m)
    b = await fit(rec, crowd_avoider, model=m)
    assert a == b and len(calls) == 1
    b.concerns.append(FitPoint(text="mutated", dna=["q1"]))  # callers get their own copy
    assert (await fit(rec, crowd_avoider, model=m)) == a
    other = crowd_avoider.model_copy(update={"traits": {"q11": 1}})
    await fit(rec, other, model=m)  # different profile hash -> new call
    assert len(calls) == 2


async def test_no_llm_uses_rules(candidates, crowd_avoider):
    rec = _rec(candidates, crowd_avoider, 7)
    v = await fit(rec, crowd_avoider)
    assert v.model == "rules"


# ---------------------------------------------------------------- rules


def test_score_bands():
    assert [label_from_score(x) for x in (0.9, 0.8, 0.7, 0.65, 0.55, 0.2)] == [
        "great_fit", "great_fit", "good_fit", "good_fit", "mixed", "poor_fit"]  # fmt: skip


def test_rules_crowd_concern_downgrades(candidates, crowd_avoider):
    jul = _rec(candidates, crowd_avoider, 7, min_crowd=0.71)
    v = rules_verdict(jul, crowd_avoider)
    crowd = next(c for c in v.concerns if "crowds" in c.text)
    assert crowd.dna == ["q8", "q11"] and jul.evidence[crowd.evidence[0]].kind == "crowds"
    assert v.label != label_from_score(jul.score.total) or v.label == "poor_fit"
    nov = _rec(candidates, crowd_avoider, 11)
    assert any("crowds" in m.text for m in rules_verdict(nov, crowd_avoider).matches)


def test_rules_points_are_grounded(candidates):
    for case in load_cases():
        profile = case_profile(case)
        import asyncio

        rec = asyncio.run(case_recommendation(case, profile))
        v = rules_verdict(rec, profile)
        for pt in [*v.matches, *v.concerns]:
            assert point_problems(pt, rec, dna_answers(profile)) == [], (case.id, pt)
        assert ungrounded_numbers(v.summary, allowed_numbers(rec)) == []


async def test_personalize_off_is_neutral_and_labelled(candidates, crowd_avoider):
    off = crowd_avoider.model_copy(update={"personalize": False})
    rec = _rec(candidates, off, 7)
    v = await fit(rec, off)
    assert v.summary.startswith(NEUTRAL_PREFIX)
    assert not any("q11" in pt.dna for pt in [*v.matches, *v.concerns])
    assert set(dna_answers(off).values()) == {3}


def test_fitdraft_rejects_unknown_label():
    with pytest.raises(ValueError):
        FitDraft(**_draft(label="meh"))


# ---------------------------------------------------------------- eval + API


def test_eval_cases_load():
    cases = load_cases(DEFAULT_CASES)
    assert len(cases) == 20 and len({c.id for c in cases}) == 20
    assert {c.label for c in cases} == {"great_fit", "good_fit", "mixed", "poor_fit"}


async def test_eval_counts_agreement():
    cases = load_cases()

    def always_mixed(messages, info):
        concern = {"text": "Not ideal.", "dna": ["q5"]}
        return _tool(info, _draft(label="mixed", concerns=[concern]))

    report = await evaluate(cases, model=FunctionModel(always_mixed))
    n_mixed = sum(c.label == "mixed" for c in cases)
    assert report.llm_exact == n_mixed
    assert 0 <= report.rules_exact <= report.rules_within_one <= 20
    out = format_report(report)
    assert "rules vs labels" in out and "AI (" in out


def test_api_recommendations_have_fit_on_top_n():
    c = TestClient(create_app())
    prof = {"user_id": "f", "dislikes": ["crowds"], "traits": {"q11": 5}}
    recs = c.post("/recommendations", json={"profile": prof, "today": "2026-10-03",
                                            "limit": 7, "fit_top": 5}).json()  # fmt: skip
    assert all(r["fit"] for r in recs[:5]) and all(r["fit"] is None for r in recs[5:])
    f = recs[0]["fit"]
    assert f["model"] == "rules" and f["inputs_hash"] == recs[0]["inputs_hash"]
    assert f["label"] in {"great_fit", "good_fit", "mixed", "poor_fit"}
    assert c.post("/recommendations", json={"profile": prof, "fit_top": 11}).status_code == 422


def test_card_ids_in_text_are_citations_not_numbers(candidates, crowd_avoider):
    rec = _rec(candidates, crowd_avoider, 7)
    a = dna_answers(crowd_avoider)
    pt = FitPoint(text="Away from the crowds you avoid (q11, q8)", dna=["q11", "q8"])
    assert point_problems(pt, rec, a) == []
    assert point_problems(FitPoint(text="q11 says 42 things", dna=["q11"]), rec, a)
    draft = FitDraft(**_draft(summary="Matches your q5 and Y1 answers.", matches=[pt.model_dump()]))
    from tripai.agents.fit import verdict_problems

    assert verdict_problems(draft, rec, crowd_avoider) == []


def test_rules_rest_match_names_only_real_tags(candidates):
    relax = TasteProfile(user_id="r", traits={"q6": 5})
    nap = next(r for r in rank(candidates, relax, limit=50, one_per_city=False) if r.iata == "NAP")
    assert "beach" not in nap.tags
    texts = [m.text for m in rules_verdict(nap, relax).matches]
    assert "Good for rest: nature" in texts and not any("beach" in t for t in texts)


def test_rules_drop_uncited_points(candidates):
    heat = TasteProfile(user_id="h", dislikes=["heat"], preferred_temp_c=(10, 15))
    rec = _rec(candidates, heat, 7)
    no_weather = rec.model_copy(update={"evidence": [e for e in rec.evidence
                                                     if e.kind != "weather"]})  # fmt: skip
    with_ev = rules_verdict(rec, heat)
    without = rules_verdict(no_weather, heat)
    assert any(c.text == "Hotter than you like" for c in with_ev.concerns)
    assert not any(c.text == "Hotter than you like" for c in without.concerns)
    for pt in [*without.matches, *without.concerns]:
        assert pt.dna or pt.evidence
    # the dropped hard concern no longer downgrades the label
    assert LABELS.index(without.label) >= LABELS.index(with_ev.label)


def test_rules_poor_fit_summary_wording(candidates, crowd_avoider):
    # a real style misfit (peak crowds for a crowd-avoider, poor weather/taste), not price
    rec = _rec(candidates, crowd_avoider, 7, min_crowd=0.71)
    rec = rec.model_copy(update={"score": rec.score.model_copy(
        update={"weather": 0.3, "crowds": 0.1, "taste": 0.4})})  # fmt: skip
    v = rules_verdict(rec, crowd_avoider)
    assert v.label == "poor_fit" and v.summary.startswith("Probably not your style")
    assert "style for you" not in v.summary
