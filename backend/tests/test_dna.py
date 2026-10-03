import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from tripai.api import create_app
from tripai.models import LuxuryLevel, Weights
from tripai.profile.dna import STATEMENTS, DnaRequest, map_dna, n
from tripai.scoring import apply_feedback, normalise_weights, rank
from tripai.scoring.engine import interest_filter, score_candidate


def dna(answers=None, **yes_no):
    return map_dna(DnaRequest(user_id="u", answers=answers or {}, yes_no=yes_no))


def all_(v):
    return {q: v for q in STATEMENTS}


def reason(res, field):
    return next(r for r in res.reasons if r.field == field)


def test_n():
    assert [n(a) for a in range(1, 6)] == [0, 0.25, 0.5, 0.75, 1]


def test_missing_answers_count_as_3():
    assert dna().model_dump() == dna(all_(3)).model_dump() | {
        "reasons": dna().model_dump()["reasons"]
    }
    res = dna()
    # raw: price .35, crowds .2, taste .325, weather .225 (sum 1.1)
    assert res.weights == Weights(price=0.3182, crowds=0.1818, taste=0.2955, weather=0.2045)
    assert res.profile.interests == {
        "food": 0.5, "culture": 0.5, "history": 0.4, "beach": 0.5, "wellness": 0.5,
        "hiking": 0.5, "nature": 0.5, "offbeat": 0.5, "discovery": 0.5,
    }  # fmt: skip
    assert res.profile.dislikes == [] and res.profile.luxury == LuxuryLevel.standard
    assert res.profile.traits == all_(3.0) | {"pace": 0.0, "novelty": 0.5}
    assert res.profile.personalize is True and res.profile.daily_discovery is None
    assert "no answer on q8 (counted as Depends)" in reason(res, "weights.crowds").text


def test_all_ones():
    res = dna(all_(1))
    # raw: price .25, crowds .1, taste .2, weather .2 (sum .75)
    assert res.weights == Weights(price=0.3333, crowds=0.1333, taste=0.2667, weather=0.2667)
    assert res.profile.interests == {t: 0.0 for t in res.profile.interests} | {"discovery": 0.5}
    assert res.profile.dislikes == []
    assert res.profile.luxury == LuxuryLevel.comfort  # q4 <= 2
    assert res.profile.traits["pace"] == 0.0
    assert "Not me on q9" in reason(res, "weights.price").text


def test_all_fives():
    res = dna(all_(5))
    # raw: price .45, crowds .3, taste .45, weather .25 (sum 1.45)
    expected = {"price": 0.3103, "crowds": 0.2069, "taste": 0.3103, "weather": 0.1724}
    assert res.weights.model_dump() == pytest.approx(expected, abs=1e-4)  # 4-dp rounding
    i = res.profile.interests
    assert i["history"] == 0.8 and i["discovery"] == 0.5 and i["nature"] == 1.0
    assert all(i[t] == 1.0 for t in ("food", "culture", "beach", "wellness", "hiking", "offbeat"))
    assert res.profile.dislikes == ["crowds"]
    assert reason(res, "dislikes").because == ["q8", "q11"]
    assert res.profile.luxury == LuxuryLevel.standard
    assert "So me on q8; So me on q11" in reason(res, "weights.crowds").text


@pytest.mark.parametrize(
    ("answers", "weights_raw"),
    [
        ({"q9": 5, "q10": 1}, {"price": 0.6}),
        ({"q9": 1, "q10": 5}, {"price": 0.1, "taste": 0.375}),
        ({"q8": 5, "q11": 1}, {"crowds": 0.2}),
        ({"q4": 5, "q6": 1}, {"taste": 0.4, "weather": 0.2}),
    ],
)
def test_weight_formulas(answers, weights_raw):
    from tripai.profile.dna import raw_weights

    a = all_(3) | answers
    raw = raw_weights(a)
    for f, v in weights_raw.items():
        assert getattr(raw, f) == pytest.approx(v)
    assert dna(answers).weights == normalise_weights(raw)


def test_interest_formulas():
    i = dna({"q5": 4, "q6": 5, "q7": 1, "q8": 2, "q11": 4, "q1": 5, "q12": 5}).profile.interests
    assert (i["food"], i["culture"], i["history"]) == (0.75, 0.75, 0.6)
    assert (i["beach"], i["wellness"], i["hiking"]) == (1.0, 1.0, 0.0)
    assert i["nature"] == 0.6  # max(n(q7)=0, 0.6*n(q6)=0.6)
    assert i["offbeat"] == 0.5  # avg(.25, .75)
    assert i["discovery"] == 0.5  # avg(1, 1-1)


@pytest.mark.parametrize(
    ("answers", "level", "because"),
    [
        ({"q9": 4, "q10": 2}, LuxuryLevel.budget, ["q9", "q10"]),
        ({"q9": 5, "q10": 2, "q4": 1}, LuxuryLevel.budget, ["q9", "q10"]),  # budget wins
        ({"q10": 4, "q4": 2}, LuxuryLevel.luxury, ["q10", "q4"]),
        ({"q10": 3, "q4": 2}, LuxuryLevel.comfort, ["q4"]),
        ({"q9": 4, "q10": 3, "q4": 3}, LuxuryLevel.standard, ["q9", "q10", "q4"]),
    ],
)
def test_luxury_rules(answers, level, because):
    res = dna(answers)
    assert res.profile.luxury == level
    assert reason(res, "luxury").because == because


@pytest.mark.parametrize(
    ("q2", "q3", "pace", "label"),
    [(5, 1, 1.0, "structured"), (1, 5, -1.0, "spontaneous"), (4, 3, 0.25, "balanced"),
     (3, 4, -0.25, "balanced"), (5, 3, 0.5, "structured")],
)  # fmt: skip
def test_pace(q2, q3, pace, label):
    res = dna({"q2": q2, "q3": q3})
    assert res.profile.traits["pace"] == pace
    assert reason(res, "traits.pace").text.startswith(label)


def test_crowd_dislike_from_either_card():
    res = dna({"q8": 3, "q11": 4})
    assert res.profile.dislikes == ["crowds"] and reason(res, "dislikes").because == ["q11"]
    assert dna({"q8": 3, "q11": 3}).profile.dislikes == []


def test_yes_no_and_traits():
    res = dna({"q1": 5, "q12": 1}, y1=True, y2=True)
    assert res.profile.daily_discovery is True and res.profile.personalize is True
    assert res.profile.traits["novelty"] == 1.0 == res.profile.interests["discovery"]
    assert reason(res, "daily_discovery").because == ["y1"]
    assert dna(y1=False).profile.daily_discovery is False


def test_every_reason_names_its_cards():
    res = dna(all_(4), y1=True, y2=True)
    fields = {r.field for r in res.reasons}
    assert {f"weights.{f}" for f in ("price", "weather", "crowds", "taste")} <= fields
    assert {f"interests.{t}" for t in res.profile.interests} <= fields
    assert {"dislikes", "luxury", "traits.pace", "traits.novelty", "daily_discovery",
            "personalize"} <= fields  # fmt: skip
    valid = set(STATEMENTS) | {"y1", "y2"}
    for r in res.reasons:
        assert r.because and set(r.because) <= valid, r.field
        assert r.text


def test_deterministic():
    a = {"q1": 2, "q5": 5, "q9": 4}
    assert dna(a, y1=True).model_dump() == dna(dict(reversed(a.items())), y1=True).model_dump()


@pytest.mark.parametrize(
    "body",
    [{"answers": {"q13": 3}}, {"answers": {"q1": 6}}, {"answers": {"q1": 0}},
     {"yes_no": {"y3": True}}],
)  # fmt: skip
def test_validation(body):
    with pytest.raises(ValidationError):
        DnaRequest(**body)


# ---------------------------------------------------------------- personalize = False


def test_personalize_off_gives_neutral_weights():
    res = dna(all_(5), y2=False)
    assert res.weights == normalise_weights(Weights())
    assert res.profile.personalize is False
    assert all(reason(res, f"weights.{f}").because == ["y2"] for f in ("price", "crowds"))
    assert res.profile.interests["food"] == 1.0  # kept (as a filter)
    assert "only as a filter" in reason(res, "interests.food").text


def test_personalize_off_feedback_changes_nothing():
    p = dna(all_(5), y2=False).profile
    res = apply_feedback(p, Weights(), {"crowds": 1, "food": 1, "loved": ["art"],
                                        "disliked": ["heat"]}, trip_tags=["food"])  # fmt: skip
    assert res.diff == [] and res.profile == p and res.weights == normalise_weights(Weights())
    assert res.note and "Personalisation is off" in res.note


def test_personalize_off_interests_filter_not_rank(candidates):
    p = dna({"q6": 5, "q5": 1, "q7": 1, "q8": 1, "q11": 1, "q1": 1, "q12": 5}, y2=False).profile
    assert {t for t, w in p.interests.items() if w >= 0.5} == {"beach", "wellness", "nature"}
    kept, receipt = interest_filter(candidates, p)
    assert receipt.applied and receipt.liked == ["beach", "nature", "wellness"]
    assert receipt.dropped_cities and all(c.city not in receipt.dropped_cities for c in kept)
    assert kept and all({"beach", "nature"} & set(c.tags) for c in kept)
    assert all(score_candidate(c, p, Weights()).taste == 0.5 for c in kept)  # no dislikes
    recs = rank(candidates, p)
    assert {r.iata for r in recs} == {c.iata for c in kept}
    assert all(r.interest_filter == receipt for r in recs)
    # nothing matches -> no filtering rather than an empty list
    p2 = p.model_copy(update={"interests": {"skiing": 1.0}})
    kept2, receipt2 = interest_filter(candidates, p2)
    assert len(kept2) == len(candidates) and not receipt2.applied
    assert "no city matches" in receipt2.text
    assert interest_filter(candidates, p.model_copy(update={"personalize": True}))[1] is None


def test_api_profile_dna_and_personalize_flow():
    c = TestClient(create_app())
    body = {"user_id": "dna", "answers": all_(5), "yes_no": {"y1": True, "y2": True}}
    r = c.post("/profile/dna", json=body)
    assert r.status_code == 200
    out = r.json()
    assert set(out) == {"profile", "weights", "reasons"}
    assert out["weights"]["crowds"] == 0.2069
    assert all(x["because"] for x in out["reasons"])
    assert c.post("/profile/dna", json={"answers": {"q1": 9}}).status_code == 422

    # personalised: feedback changes stored weights
    fb = c.post("/feedback", json={"trip_id": "FCO-20261107-20261111", "user_id": "dna",
                                   "answers": {"crowds": 1}}).json()  # fmt: skip
    assert fb["diff"] and fb["note"] is None

    # personalisation off: neutral weights, feedback is a no-op with a reason
    off = {"user_id": "dna", "answers": all_(5), "yes_no": {"y2": False}}
    out = c.post("/profile/dna", json=off).json()
    assert out["weights"] == normalise_weights(Weights()).model_dump()
    fb = c.post("/feedback", json={"trip_id": "FCO-20261107-20261111", "user_id": "dna",
                                   "answers": {"crowds": 1, "food": 1}}).json()  # fmt: skip
    assert fb["diff"] == [] and "Personalisation is off" in fb["note"]
    assert fb["weights"] == normalise_weights(Weights()).model_dump()
    assert fb["interests"] == out["profile"]["interests"]


def test_api_recommendations_ignore_stored_weights_when_personalize_off():
    c = TestClient(create_app())
    prof = {"user_id": "x", "interests": {"food": 1.0}}
    c.post("/recommendations", json={"profile": prof, "today": "2026-10-03",
                                     "weights": {"price": 1, "weather": 0, "crowds": 0,
                                                 "taste": 0}})  # fmt: skip
    req = {"profile": prof | {"personalize": False}, "today": "2026-10-03", "limit": 3}
    neutral = c.post("/recommendations", json={**req, "weights": Weights().model_dump()}).json()
    implicit = c.post("/recommendations", json=req).json()
    assert [r["id"] for r in implicit] == [r["id"] for r in neutral]
    assert implicit[0]["inputs_hash"] == neutral[0]["inputs_hash"]


def test_personalize_off_keeps_dislike_penalty(candidates):
    p = dna({"q8": 5, "q11": 5}, y2=False).profile
    assert p.dislikes == ["crowds"]
    nightlife = p.model_copy(update={"dislikes": ["nightlife"]})
    bcn = next(c for c in candidates if c.iata == "BCN")
    assert score_candidate(bcn, nightlife, Weights()).taste == 0.25  # 0.5 - 0.25


def test_inputs_hash_covers_unfiltered_inputs(candidates):
    from tripai.scoring.engine import inputs_hash

    p = dna({"q6": 5}, y2=False).profile
    rec = rank(candidates, p)[0]
    assert rec.inputs_hash == inputs_hash(candidates, p, Weights())


@pytest.mark.parametrize("bad", [{"q1": True}, {"q1": "4"}, {"q1": 4.0}])
def test_answers_strict_ints(bad):
    with pytest.raises(ValidationError):
        DnaRequest(answers=bad)
    with pytest.raises(ValidationError):
        DnaRequest(yes_no={"y1": "yes"})


def test_map_dna_keeps_non_dna_fields_of_base():
    from tripai.models import TasteProfile

    base = TasteProfile(user_id="u", budget_pln=1500, origin_airports=["WAW"],
                        preferred_temp_c=(20, 30), trip_length_days=(2, 4),
                        interests={"art": 0.9, "food": 0.1}, dislikes=["heat", "crowds"],
                        daily_discovery=True)  # fmt: skip
    res = map_dna(DnaRequest(user_id="u", answers={"q5": 5}), base=base)
    p = res.profile
    assert (p.budget_pln, p.origin_airports, p.preferred_temp_c, p.trip_length_days) == (
        1500, ["WAW"], (20, 30), (2, 4))  # fmt: skip
    assert p.interests["art"] == 0.9 and p.interests["food"] == 1.0  # learned kept, DNA wins
    assert p.dislikes == ["heat"]  # crowds is DNA-owned: q8/q11 = 3 now -> removed
    assert p.daily_discovery is True  # y1 unanswered -> keep


def test_api_retaking_dna_keeps_budget_and_airport():
    c = TestClient(create_app())
    c.post("/feedback", json={"user_id": "u", "trip_id": "FCO-x", "answers": {"food": 5},
                              "profile": {"user_id": "u", "budget_pln": 1500,
                                          "origin_airports": ["WAW"],
                                          "preferred_temp_c": [20, 30]}})  # fmt: skip
    c.post("/profile/dna", json={"user_id": "u", "answers": {"q5": 5}})
    fb = c.post("/feedback", json={"user_id": "u", "trip_id": "FCO-x", "answers": {}}).json()
    assert fb["budget_pln"] == 1500 and fb["origin_airports"] == ["WAW"]
    assert fb["preferred_temp_c"] == [20, 30] and fb["interests"]["food"] == 1.0


def test_api_recommendations_carry_filter_receipt():
    c = TestClient(create_app())
    prof = dna({"q6": 5, "q5": 1, "q7": 1}, y2=False).profile.model_dump(mode="json")
    recs = c.post("/recommendations", json={"profile": prof, "today": "2026-10-03"}).json()
    f = recs[0]["interest_filter"]
    assert f["applied"] and f["dropped_cities"] and "filtered out" in f["text"]
