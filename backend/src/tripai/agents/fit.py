"""Fit agent (docs/FIT_VERDICT.md): a grounded, qualitative second opinion on one recommendation
against the user's Travel DNA. The scorer ranks; this agent only labels and cites.

Grounding is enforced by an output validator (ModelRetry), with a deterministic rules fallback
(`model = "rules"`) when no LLM is configured or the agent keeps failing.
"""

import hashlib
import json
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models import Model

from tripai.agents.explain import _ALWAYS_OK, allowed_numbers, numbers_in, ungrounded_numbers
from tripai.agents.llm import llm_enabled, model_name
from tripai.models import FitPoint, FitVerdict, TasteProfile
from tripai.scoring.types import RankedRecommendation

log = logging.getLogger(__name__)

STATEMENTS = [f"q{i}" for i in range(1, 13)]
DNA_IDS = [*STATEMENTS, "y1", "y2"]
_CARD_ID = re.compile(r"\b[qQyY]\d{1,2}\b")  # "q11" is a citation, not a number


def _without_card_ids(text: str) -> str:
    return _CARD_ID.sub("", text)


LABELS = ["poor_fit", "mixed", "good_fit", "great_fit"]  # worst -> best
NEUTRAL_PREFIX = "Neutral check (personalisation off): "
DNA_EN = {
    "q1": "loves discovering new places",
    "q2": "likes every day planned",
    "q3": "likes changing plans spontaneously",
    "q4": "puts experiences above comfort",
    "q5": "keen on local food and culture",
    "q6": "looks above all for rest and relaxation",
    "q7": "likes being active (hiking, cycling, water)",
    "q8": "often picks less touristy places",
    "q9": "price strongly drives choices",
    "q10": "pays more for unique experiences",
    "q11": "likes travelling away from crowds",
    "q12": "happily returns to known places",
    "y1": "wants something new every day",
    "y2": "wants tailored recommendations",
}


# ---------------------------------------------------------------- context


def dna_answers(profile: TasteProfile) -> dict[str, int]:
    """q1..q12 -> 1..5 from `traits` (missing = 3); neutral (all 3) when personalize is off."""
    if not profile.personalize:
        return dict.fromkeys(STATEMENTS, 3)
    out = {}
    for q in STATEMENTS:
        try:
            out[q] = round(float(profile.traits.get(q, 3)))
        except (TypeError, ValueError):
            out[q] = 3
    return out


def effective_profile(profile: TasteProfile) -> TasteProfile:
    """personalize=False: judge against a neutral DNA (no personal dislikes or interests)."""
    if profile.personalize:
        return profile
    return profile.model_copy(
        update={"traits": dict.fromkeys(STATEMENTS, 3.0), "dislikes": [], "interests": {}}
    )


def profile_hash(profile: TasteProfile) -> str:
    canonical = json.dumps(profile.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _ev_index(rec: RankedRecommendation, kind: str) -> list[int]:
    return [i for i, e in enumerate(rec.evidence) if e.kind == kind]


def _ev_value(rec: RankedRecommendation, kind: str) -> float | None:
    for e in rec.evidence:
        if e.kind == kind and isinstance(e.value, (int, float)):
            return float(e.value)
    return None


def fit_payload(rec: RankedRecommendation, profile: TasteProfile) -> str:
    p = effective_profile(profile)
    a = dna_answers(profile)
    payload = {
        "dna": {q: {"answer_1_to_5": a[q], "statement": DNA_EN[q]} for q in STATEMENTS},
        "yes_no": {"y1": p.daily_discovery, "y2": p.personalize},
        "interests": p.interests,
        "dislikes": p.dislikes,
        "luxury": p.luxury.value,
        "preferred_temp_c": list(p.preferred_temp_c),
        "offer": {
            "city": rec.city,
            "country": rec.country,
            "dates": f"{rec.window.start.isoformat()} to {rec.window.end.isoformat()}",
            "tags": rec.tags,
            "highlights": rec.highlights,
            "score_0_to_1": rec.score.model_dump(),
            "counterfactuals": [c.text for c in rec.counterfactuals],
        },
        "evidence": [
            {"index": i, "kind": e.kind, "label": e.label, "value": e.value, "unit": e.unit}
            for i, e in enumerate(rec.evidence)
        ],
    }
    return json.dumps(payload, ensure_ascii=False, default=str)


# ---------------------------------------------------------------- grounding


def point_problems(pt: FitPoint, rec: RankedRecommendation, answers: dict[str, int]) -> list[str]:
    """Rule 1: cites >= 1 existing DNA id and/or evidence index. Rule 2: numbers only from the
    cited evidence (value + label) or the cited DNA answers."""
    problems = []
    if not pt.dna and not pt.evidence:
        problems.append(f"'{pt.text}' cites no DNA card and no evidence")
    bad_dna = [d for d in pt.dna if d not in DNA_IDS]
    if bad_dna:
        problems.append(f"'{pt.text}' cites unknown DNA ids {bad_dna}")
    bad_ev = [i for i in pt.evidence if not 0 <= i < len(rec.evidence)]
    if bad_ev:
        problems.append(f"'{pt.text}' cites evidence indexes that don't exist: {bad_ev}")
    allowed = set(_ALWAYS_OK) | {5.0}  # the 1-5 scale itself
    for i in pt.evidence:
        if 0 <= i < len(rec.evidence):
            e = rec.evidence[i]
            texts = [e.label] + ([e.value] if isinstance(e.value, str) else [])
            vals = [float(e.value)] if isinstance(e.value, (int, float)) else []
            vals += [float(x) for t in texts for x in numbers_in(t)]
            for v in vals:
                allowed |= {abs(v), abs(round(v)), abs(round(v, 1))}
    allowed |= {float(answers[d]) for d in pt.dna if d in answers}
    bad = ungrounded_numbers(_without_card_ids(pt.text), allowed)
    if bad:
        problems.append(f"'{pt.text}' uses numbers not in its cited evidence: {', '.join(bad)}")
    return problems


def verdict_problems(
    draft: "FitDraft", rec: RankedRecommendation, profile: TasteProfile
) -> list[str]:
    answers = dna_answers(profile)
    problems = []
    for pt in [*draft.matches, *draft.concerns]:
        problems += point_problems(pt, rec, answers)
    bad = ungrounded_numbers(_without_card_ids(draft.summary), allowed_numbers(rec))
    if bad:
        problems.append(f"summary uses numbers not in the evidence: {', '.join(bad)}")
    return problems


# ---------------------------------------------------------------- agent


class FitDraft(BaseModel):
    """What the LLM fills in; model/inputs_hash/created_at are added by us."""

    label: Literal["great_fit", "good_fit", "mixed", "poor_fit"]
    confidence: float = Field(ge=0, le=1)
    summary: str = Field(description="One user-facing sentence")
    matches: list[FitPoint] = Field(default_factory=list)
    concerns: list[FitPoint] = Field(default_factory=list)


@dataclass
class FitDeps:
    rec: RankedRecommendation
    profile: TasteProfile


INSTRUCTIONS = """\
You judge whether ONE travel offer fits ONE user's Travel DNA. The ranking is already done by a
deterministic scorer; you give a qualitative second opinion that a weighted sum can miss
(e.g. a relax-seeker sent to a nightlife city, a crowd-avoider in peak crowds, "cheap" only
because the weather is bad).
Output:
- label: great_fit | good_fit | mixed | poor_fit; confidence 0..1.
- summary: one short user-facing sentence (English unless the DNA statements are Polish).
- matches / concerns: 1-4 each. Every point MUST cite at least one DNA card id (q1..q12, y1, y2)
  in `dna` and/or at least one evidence `index` in `evidence`. Only cite ids/indexes that exist.
- Numbers: a point may only use numbers that appear in the evidence items it cites (or the
  1-5 answer of a DNA card it cites). Prefer words over numbers. Never invent prices or scores.
- DNA answers: 1 = not me, 3 = depends, 5 = very me. Answers of 3 carry little signal."""

fit_agent = Agent(
    None,
    output_type=FitDraft,
    instructions=INSTRUCTIONS,
    deps_type=FitDeps,
    retries=2,
    defer_model_check=True,
)


@fit_agent.output_validator
def _grounded(ctx: RunContext[FitDeps], draft: FitDraft) -> FitDraft:
    problems = verdict_problems(draft, ctx.deps.rec, ctx.deps.profile)
    if problems:
        raise ModelRetry("Fix these grounding problems: " + "; ".join(problems))
    return draft


# ---------------------------------------------------------------- rules fallback

SCORE_BANDS = [(0.80, "great_fit"), (0.65, "good_fit"), (0.50, "mixed"), (0.0, "poor_fit")]
NIGHTLIFE = {"nightlife", "festivals"}
RELAX = {"beach", "wellness", "nature", "sun"}
CULTURE = {"food", "history", "art", "museums", "culture", "architecture", "pizza"}
ACTIVE = {"hiking", "nature", "surf", "diving", "cycling"}


def label_from_score(total: float) -> str:
    return next(label for cut, label in SCORE_BANDS if total >= cut)


def rules_verdict(rec: RankedRecommendation, profile: TasteProfile) -> FitDraft:
    """Deterministic verdict: label from score bands, downgraded one step per hard concern."""
    p = effective_profile(profile)
    a = dna_answers(profile)
    tags = set(rec.tags)
    matches: list[FitPoint] = []
    concerns: list[FitPoint] = []
    hard_at: set[int] = set()  # indexes of hard concerns (each downgrades the label one step)
    crowd = rec.crowd if rec.crowd is not None else _ev_value(rec, "crowds")
    temp = rec.temp_c if rec.temp_c is not None else _ev_value(rec, "weather")
    ev_crowd, ev_weather = _ev_index(rec, "crowds"), _ev_index(rec, "weather")
    ev_price = _ev_index(rec, "flight") + _ev_index(rec, "price_baseline")
    ev_sights = _ev_index(rec, "attraction")

    crowd_cards = [q for q in ("q8", "q11") if a[q] >= 4]
    avoids_crowds = bool(crowd_cards) or "crowds" in p.dislikes
    if avoids_crowds and crowd is not None:
        if crowd > 0.7:
            hard_at.add(len(concerns))
            concerns.append(FitPoint(text="Peak tourist crowds, and you prefer to avoid them",
                                     dna=crowd_cards, evidence=ev_crowd))  # fmt: skip
        elif crowd <= 0.4:
            matches.append(FitPoint(text="Quiet season, away from the crowds you avoid",
                                    dna=crowd_cards, evidence=ev_crowd))  # fmt: skip

    if a["q6"] >= 4:
        if tags & NIGHTLIFE and not tags & RELAX:
            hard_at.add(len(concerns))
            party = ", ".join(sorted(tags & NIGHTLIFE))
            concerns.append(FitPoint(text=f"Known for {party}, but you travel to rest",
                                     dna=["q6"]))  # fmt: skip
        elif tags & RELAX:
            restful = ", ".join(sorted(tags & RELAX))  # only what the city's tags actually say
            matches.append(FitPoint(text=f"Good for rest: {restful}", dna=["q6"]))

    lo, hi = p.preferred_temp_c
    if temp is not None:
        if "heat" in p.dislikes and temp > hi:
            hard_at.add(len(concerns))
            concerns.append(FitPoint(text="Hotter than you like", evidence=ev_weather))
        elif temp < lo - 4 or temp > hi + 4:
            concerns.append(FitPoint(text="Weather well outside your comfort range",
                                     evidence=ev_weather))  # fmt: skip
        elif lo <= temp <= hi and ev_weather:
            matches.append(FitPoint(text="Weather in your comfort range", evidence=ev_weather))

    if rec.score.price >= 0.7 and rec.score.weather < 0.5:
        concerns.append(FitPoint(text="Cheap partly because the weather is poor then",
                                 evidence=ev_price + ev_weather))  # fmt: skip

    if a["q9"] >= 4:
        if rec.score.price < 0.4:
            hard_at.add(len(concerns))
            concerns.append(FitPoint(text="Expensive for someone price-driven", dna=["q9"],
                                     evidence=ev_price))  # fmt: skip
        elif rec.score.price >= 0.7:
            matches.append(FitPoint(text="A genuinely good price, which matters to you",
                                    dna=["q9"], evidence=ev_price))  # fmt: skip

    if a["q5"] >= 4:
        if tags & CULTURE:
            matches.append(FitPoint(text="Strong local food and culture", dna=["q5"],
                                    evidence=ev_sights))  # fmt: skip
        else:
            concerns.append(FitPoint(text="Not much of a food and culture destination",
                                     dna=["q5"]))  # fmt: skip
    if a["q7"] >= 4 and tags & ACTIVE:
        matches.append(FitPoint(text="Plenty to do actively outdoors", dna=["q7"]))
    if (a["q1"] >= 4 or p.daily_discovery) and len(rec.highlights) >= 3:
        cards = ["q1"] if a["q1"] >= 4 else []
        if p.daily_discovery:
            cards.append("y1")
        matches.append(FitPoint(text="Enough sights for something new each day", dna=cards,
                                evidence=ev_sights))  # fmt: skip

    # Rule 1 applies to the fallback too: drop any point that cites nothing (e.g. a live provider
    # without weather evidence) or fails the grounding checks; dropped hard concerns don't count.
    def grounded(pt: FitPoint) -> bool:
        return bool(pt.dna or pt.evidence) and not point_problems(pt, rec, a)

    matches = [m for m in matches if grounded(m)]
    kept = [(i, c) for i, c in enumerate(concerns) if grounded(c)]
    concerns = [c for _, c in kept]
    hard = sum(i in hard_at for i, _ in kept)

    label = label_from_score(rec.score.total)
    idx = max(0, LABELS.index(label) - hard)
    label = LABELS[idx]
    phrase = {"great_fit": "A great fit for you", "good_fit": "A good fit for you",
              "mixed": "A mixed fit for you", "poor_fit": "Probably not your style"}[label]  # fmt: skip
    summary = phrase
    if matches:
        summary += f": {matches[0].text[0].lower()}{matches[0].text[1:]}"
    if concerns:
        summary += f"; watch out: {concerns[0].text[0].lower()}{concerns[0].text[1:]}"
    summary += "."
    confidence = 0.5 if not (matches or concerns) else 0.6
    return FitDraft(label=label, confidence=confidence, summary=summary,
                    matches=matches, concerns=concerns)  # fmt: skip


# ---------------------------------------------------------------- entry point

_CACHE: "OrderedDict[tuple[str, str, str, str], FitVerdict]" = OrderedDict()
CACHE_SIZE = 1024


def _finish(draft: FitDraft, model: str, rec: RankedRecommendation, profile: TasteProfile):
    summary = draft.summary
    if not profile.personalize and not summary.startswith(NEUTRAL_PREFIX):
        summary = NEUTRAL_PREFIX + summary
    return FitVerdict(
        label=draft.label,
        confidence=round(draft.confidence, 2),
        summary=summary,
        matches=draft.matches,
        concerns=draft.concerns,
        model=model,
        inputs_hash=rec.inputs_hash,
        created_at=datetime.now(UTC),
    )


async def fit(
    rec: RankedRecommendation, profile: TasteProfile, model: Model | str | None = None
) -> FitVerdict:
    """Grounded fit verdict; cached by (model, inputs_hash, profile hash, recommendation id)."""
    use_llm = model is not None or llm_enabled()
    name = model if isinstance(model, str) else model.model_name if model else model_name()
    model_key = name if use_llm else "rules"
    key = (model_key, rec.inputs_hash, profile_hash(profile), rec.id)
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key].model_copy(deep=True)  # callers may mutate their copy

    verdict = None
    if use_llm:
        try:
            result = await fit_agent.run(
                "FIT INPUT:\n" + fit_payload(rec, profile),
                model=model or model_name(),
                deps=FitDeps(rec=rec, profile=profile),
            )
            verdict = _finish(result.output, name, rec, profile)
        except Exception as exc:  # noqa: BLE001 - fall back to rules, never break ranking
            log.warning("fit agent failed for %s, using rules: %s", rec.id, exc)
    if verdict is None:
        verdict = _finish(rules_verdict(rec, profile), "rules", rec, profile)
        if use_llm:
            return verdict  # don't cache a fallback under the LLM key: retry next request
    _CACHE[key] = verdict.model_copy(deep=True)
    while len(_CACHE) > CACHE_SIZE:
        _CACHE.popitem(last=False)
    return verdict


def clear_cache() -> None:
    _CACHE.clear()
