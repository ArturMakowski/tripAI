"""Fit agent (docs/FIT_VERDICT.md): a grounded, qualitative second opinion on one recommendation
against the user's Travel DNA. The scorer ranks; this agent only labels and cites.

Engines (`TRIPAI_FIT_ENGINE=jev|llm|rules`, default jev when a TypeSafe key is set, else llm when
an LLM key is set, else rules):
- jev (cascade): Jev (`tripai.agents.jev`) decides the label + one bool per DNA check with
  calibrated confidence; the LLM (or a template) only phrases those decisions + their cited
  evidence. If Jev's label confidence is below TRIPAI_JEV_ESCALATE_BELOW (0.5), the decision is
  escalated to the LLM agent (System 1 -> System 2), then to rules if that fails.
- llm: the LLM labels and writes grounded points itself.
- rules: deterministic score bands + DNA rules.
Fallback chain: jev -> llm -> rules. Grounding is enforced by output validators (ModelRetry).
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models import Model

from tripai import i18n
from tripai.agents import llm_cache
from tripai.agents.explain import _ALWAYS_OK, allowed_numbers, numbers_in, ungrounded_numbers
from tripai.agents.jev import (
    FIT_CHECKS,
    LOW_CONFIDENCE,
    Decision,
    FitDecision,
    decide,
    escalate_below,
    fit_decision_agent,
    jev_enabled,
    jev_model_name,
)
from tripai.agents.llm import llm_enabled, model_name
from tripai.agents.llm_cache import llm_timeout_s
from tripai.models import FitPoint, FitVerdict, TasteProfile
from tripai.scoring.types import RankedRecommendation

log = logging.getLogger(__name__)

STATEMENTS = [f"q{i}" for i in range(1, 13)]
DNA_IDS = [*STATEMENTS, "y1", "y2"]
_CARD_ID = re.compile(r"\b[qQyY]\d{1,2}\b")  # "q11" is a citation, not a number


def _without_card_ids(text: str) -> str:
    return _CARD_ID.sub("", text)


LABELS = ["poor_fit", "mixed", "good_fit", "great_fit"]  # worst -> best
NEUTRAL_PREFIX = i18n.MESSAGES["fit.neutral_prefix"]["en"]  # en form; see i18n for pl
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


STYLE_FACTORS = ("weather", "crowds", "taste")
PRICE_KINDS = {"flight", "hotel", "price_baseline", "peak"}


def style_score(rec: RankedRecommendation) -> float:
    """How well the trip matches the person (weather, crowds, taste), price left out: the fit
    verdict answers "is this your kind of trip?"; whether it's affordable is the budget's job."""
    return sum(getattr(rec.score, f) for f in STYLE_FACTORS) / len(STYLE_FACTORS)


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
            # style factors only: price vs budget is judged separately (budget status, value
            # badge), so it can never turn into a "not your style" verdict
            "style_scores_0_to_1": {f: getattr(rec.score, f) for f in STYLE_FACTORS},
        },
        # price rows stay out (the verdict judges style); indexes are the card's real ones
        "evidence": [
            {"index": i, "kind": e.kind, "label": e.label, "value": e.value, "unit": e.unit}
            for i, e in enumerate(rec.evidence)
            if e.kind not in PRICE_KINDS
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
- DNA answers: 1 = not me, 3 = depends, 5 = very me. Answers of 3 carry little signal.
- Judge the person's style only. Price and budget are shown to the user separately: a trip that
  is pricier than their budget is NOT a poor fit for that reason.
- mixed or poor_fit needs at least one concrete concern; with no concern the label is good_fit."""

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
    """Deterministic verdict: label from the style score bands (weather, crowds, taste; never
    price), downgraded one step per hard concern."""
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
            concerns.append(FitPoint(text=i18n.t("fit.r.crowds_bad"),
                                     dna=crowd_cards, evidence=ev_crowd))  # fmt: skip
        elif crowd <= 0.4:
            matches.append(FitPoint(text=i18n.t("fit.r.crowds_good"),
                                    dna=crowd_cards, evidence=ev_crowd))  # fmt: skip

    if a["q6"] >= 4:
        if tags & NIGHTLIFE and not tags & RELAX:
            hard_at.add(len(concerns))
            party = i18n.tags(sorted(tags & NIGHTLIFE))
            concerns.append(FitPoint(text=i18n.t("fit.r.party", tags=party),
                                     dna=["q6"]))  # fmt: skip
        elif tags & RELAX:
            restful = i18n.tags(sorted(tags & RELAX))  # only what the city's tags actually say
            matches.append(FitPoint(text=i18n.t("fit.r.rest", tags=restful), dna=["q6"]))

    lo, hi = p.preferred_temp_c
    if temp is not None:
        if "heat" in p.dislikes and temp > hi:
            hard_at.add(len(concerns))
            concerns.append(FitPoint(text=i18n.t("fit.r.hot"), evidence=ev_weather))
        elif temp < lo - 4 or temp > hi + 4:
            concerns.append(FitPoint(text=i18n.t("fit.r.weather_far"),
                                     evidence=ev_weather))  # fmt: skip
        elif lo <= temp <= hi and ev_weather:
            matches.append(FitPoint(text=i18n.t("fit.r.weather_ok"), evidence=ev_weather))

    if rec.score.price >= 0.7 and rec.score.weather < 0.5:
        concerns.append(FitPoint(text=i18n.t("fit.r.cheap_bad_weather"),
                                 evidence=ev_price + ev_weather))  # fmt: skip

    if a["q9"] >= 4:
        if rec.score.price < 0.4:  # a plain concern: price never downgrades the style label
            concerns.append(FitPoint(text=i18n.t("fit.r.expensive"), dna=["q9"],
                                     evidence=ev_price))  # fmt: skip
        elif rec.score.price >= 0.7:
            matches.append(FitPoint(text=i18n.t("fit.r.good_price"),
                                    dna=["q9"], evidence=ev_price))  # fmt: skip

    if a["q5"] >= 4:
        if tags & CULTURE:
            matches.append(FitPoint(text=i18n.t("fit.r.culture"), dna=["q5"],
                                    evidence=ev_sights))  # fmt: skip
        else:
            concerns.append(FitPoint(text=i18n.t("fit.r.no_culture"),
                                     dna=["q5"]))  # fmt: skip
    if a["q7"] >= 4 and tags & ACTIVE:
        matches.append(FitPoint(text=i18n.t("fit.r.active"), dna=["q7"]))
    if (a["q1"] >= 4 or p.daily_discovery) and len(rec.highlights) >= 3:
        cards = ["q1"] if a["q1"] >= 4 else []
        if p.daily_discovery:
            cards.append("y1")
        matches.append(FitPoint(text=i18n.t("fit.r.novelty"), dna=cards,
                                evidence=ev_sights))  # fmt: skip

    # Rule 1 applies to the fallback too: drop any point that cites nothing (e.g. a live provider
    # without weather evidence) or fails the grounding checks; dropped hard concerns don't count.
    def grounded(pt: FitPoint) -> bool:
        return bool(pt.dna or pt.evidence) and not point_problems(pt, rec, a)

    matches = [m for m in matches if grounded(m)]
    kept = [(i, c) for i, c in enumerate(concerns) if grounded(c)]
    concerns = [c for _, c in kept]
    hard = sum(i in hard_at for i, _ in kept)

    label = label_from_score(style_score(rec))
    idx = max(0, LABELS.index(label) - hard)
    label = LABELS[idx]
    summary = template_summary(label, matches, concerns)
    confidence = 0.5 if not (matches or concerns) else 0.6
    return needs_a_minus(FitDraft(label=label, confidence=confidence, summary=summary,
                                  matches=matches, concerns=concerns))  # fmt: skip


# ---------------------------------------------------------------- jev engine

POINT_MIN_CONFIDENCE = 0.4  # a Jev yes/no below this (P(yes) < 0.7) is too unsure to show
UNSURE_PREFIX = i18n.MESSAGES["fit.unsure_prefix"]["en"]  # en form; see i18n for pl


def _lower_first(text: str) -> str:
    return text[:1].lower() + text[1:]


def template_summary(label: str, matches: list[FitPoint], concerns: list[FitPoint]) -> str:
    """'A good fit for you: …; watch out: ….' in the current language."""
    summary = i18n.t(f"fit.label.{label}")
    if matches:
        summary += f": {_lower_first(matches[0].text)}"
    if concerns:
        summary += f"; {i18n.t('fit.watch_out')}: {_lower_first(concerns[0].text)}"
    return summary + "."


@dataclass
class JevFit:
    """Jev's decisions turned into cited points (template wording); `checks` keeps what Jev said."""

    draft: FitDraft
    checks: dict[str, tuple[bool, float]]  # check -> (answer, confidence)
    point_checks: list[str] = field(default_factory=list)  # check behind each match, then concern


def jev_fit(d: Decision[FitDecision], rec: RankedRecommendation, profile: TasteProfile) -> JevFit:
    """Deterministic: cite the DNA cards (only strong answers) and evidence behind each yes."""
    a = dna_answers(profile)
    p = effective_profile(profile)
    checks = {name: (bool(getattr(d.output, name)), d.conf(name)) for name in FIT_CHECKS}
    matches: list[FitPoint] = []
    concerns: list[FitPoint] = []
    m_checks: list[str] = []
    c_checks: list[str] = []
    for name, (kind, cards, kinds) in FIT_CHECKS.items():
        yes, conf = checks[name]
        if not yes or conf < POINT_MIN_CONFIDENCE:
            continue
        dna = [c for c in cards if (c in a and a[c] >= 4) or (c == "y1" and p.daily_discovery)]
        evidence = [i for k in kinds for i in _ev_index(rec, k)]
        pt = FitPoint(text=i18n.t(f"fit.c.{name}"), dna=dna, evidence=evidence)
        if not (pt.dna or pt.evidence) or point_problems(pt, rec, a):
            continue  # rule 1: a point that can't cite anything is not shown
        (matches if kind == "match" else concerns).append(pt)
        (m_checks if kind == "match" else c_checks).append(name)
    label, conf = d.output.label_name, d.conf("label")
    summary = template_summary(label, matches, concerns)
    draft = FitDraft(label=label, confidence=conf, summary=summary,
                     matches=matches, concerns=concerns)  # fmt: skip
    return JevFit(draft=draft, checks=checks, point_checks=m_checks + c_checks)


class Phrasing(BaseModel):
    """The LLM's only job on the jev engine: words for decisions already made."""

    summary: str = Field(description="One user-facing sentence")
    matches: list[str] = Field(default_factory=list, description="One text per given match")
    concerns: list[str] = Field(default_factory=list, description="One text per given concern")


@dataclass
class PhraseDeps:
    jf: JevFit
    rec: RankedRecommendation
    profile: TasteProfile


PHRASE_INSTRUCTIONS = """A decision engine has already judged whether a travel offer fits a traveller. You only write the
words: a one-sentence summary and one short text per match and per concern, in the same order.
Do NOT change the verdict, add or drop points, or add facts. Each text may only use the DNA
statements and evidence given for that point; prefer words over numbers and never invent prices,
scores or percentages."""

phrase_agent = Agent(
    None,
    output_type=Phrasing,
    instructions=PHRASE_INSTRUCTIONS,
    deps_type=PhraseDeps,
    retries=2,
    defer_model_check=True,
)


def phrase_payload(jf: JevFit, rec: RankedRecommendation, profile: TasteProfile) -> str:
    a = dna_answers(profile)

    def point(pt: FitPoint) -> dict:
        return {
            "draft_text": pt.text,
            "dna": [{"id": c, "statement": DNA_EN[c], "answer_1_to_5": a.get(c)} for c in pt.dna],
            "evidence": [
                {
                    "label": rec.evidence[i].label,
                    "value": rec.evidence[i].value,
                    "unit": rec.evidence[i].unit,
                }
                for i in pt.evidence
            ],
        }

    return json.dumps(
        {
            "offer": f"{rec.city}, {rec.country}, {rec.window.start} to {rec.window.end}",
            "verdict": jf.draft.label,
            "matches": [point(m) for m in jf.draft.matches],
            "concerns": [point(c) for c in jf.draft.concerns],
        },
        ensure_ascii=False,
        default=str,
    )


def _phrased(jf: JevFit, ph: Phrasing) -> FitDraft:
    d = jf.draft
    return d.model_copy(
        update={
            "summary": ph.summary,
            "matches": [m.model_copy(update={"text": t}) for m, t in zip(d.matches, ph.matches)],
            "concerns": [c.model_copy(update={"text": t}) for c, t in zip(d.concerns, ph.concerns)],
        }
    )


@phrase_agent.output_validator
def _phrase_ok(ctx: RunContext[PhraseDeps], ph: Phrasing) -> Phrasing:
    jf = ctx.deps.jf
    problems = []
    if len(ph.matches) != len(jf.draft.matches) or len(ph.concerns) != len(jf.draft.concerns):
        problems.append(
            f"give exactly {len(jf.draft.matches)} matches and {len(jf.draft.concerns)} concerns"
        )
    else:
        problems += verdict_problems(_phrased(jf, ph), ctx.deps.rec, ctx.deps.profile)
    if problems:
        raise ModelRetry("Fix: " + "; ".join(problems))
    return ph


# ---------------------------------------------------------------- entry point

Engine = Literal["jev", "llm", "rules"]
ENGINES: tuple[Engine, ...] = ("jev", "llm", "rules")


def fit_engine() -> Engine:
    """TRIPAI_FIT_ENGINE if set, else the best engine that has a key (jev > llm > rules)."""
    env = os.getenv("TRIPAI_FIT_ENGINE", "").strip().lower()
    if env in ENGINES:
        return env  # type: ignore[return-value]
    if jev_enabled():
        return "jev"
    return "llm" if llm_enabled() else "rules"


@dataclass
class FitRun:
    verdict: FitVerdict
    engine: Engine  # the engine that produced the label (after fallbacks)
    latency_ms: float
    cost_usd: float | None = None
    jev: Decision[FitDecision] | None = None  # Jev's raw decision, when the jev engine ran
    escalated: bool = False  # Jev was unsure and handed the decision on
    degraded: bool = False  # e.g. GPT phrasing failed and the template wording was used


def _add(a: float | None, b: float | None) -> float | None:
    return None if a is None and b is None else (a or 0.0) + (b or 0.0)


def _cost(result) -> float | None:
    cost = getattr(result.usage, "cost", None)
    return float(cost) if cost is not None else None


def _llm_name(model: Model | str | None) -> str:
    return model if isinstance(model, str) else model.model_name if model else model_name()


async def _run_llm(rec, profile, model) -> tuple[FitDraft, float | None]:
    result = await fit_agent.run(
        "FIT INPUT:\n" + fit_payload(rec, profile) + "\n\n" + i18n.llm_language_rule(),
        model=model or model_name(),
        deps=FitDeps(rec=rec, profile=profile),
    )
    return result.output, _cost(result)


async def _phrase(jf: JevFit, rec, profile, model) -> tuple[FitDraft, str, float | None]:
    """GPT words Jev's decisions; on failure the template wording stays."""
    try:
        result = await phrase_agent.run(
            "DECISIONS:\n" + phrase_payload(jf, rec, profile) + "\n\n" + i18n.llm_language_rule(),
            model=model or model_name(),
            deps=PhraseDeps(jf=jf, rec=rec, profile=profile),
        )
        return _phrased(jf, result.output), _llm_name(model), _cost(result)
    except Exception as exc:  # noqa: BLE001 - Jev's decisions stand; template wording
        log.warning("fit phrasing failed for %s, using template: %s", rec.id, exc)
        return jf.draft, "template", None


class EscalationFailed(Exception):
    """Jev was unsure and the LLM couldn't take over: the caller falls back to rules."""


class _Deadline:
    """One time budget for a whole verdict (llm_cache.llm_timeout_s): every model call waits
    at most for what is left of it."""

    def __init__(self, seconds: float) -> None:
        self._loop = asyncio.get_running_loop()
        self._end = self._loop.time() + seconds

    def left(self) -> float:
        return max(0.0, self._end - self._loop.time())

    async def wait(self, aw):
        return await asyncio.wait_for(aw, timeout=self.left())


def speculate_after_s() -> float:
    """Start the LLM's own decision only if Jev hasn't answered by then (TRIPAI_SPECULATE_AFTER_S,
    default 1 s): a quick, sure Jev costs no LLM call at all, a slow Jev overlaps with it."""
    try:
        return max(0.0, float(os.getenv("TRIPAI_SPECULATE_AFTER_S") or 1.0))
    except ValueError:
        return 1.0


async def _run_cascade(rec, profile, model, jev, use_llm: bool, phrase: bool, spec, deadline):
    """Jev decides when sure; else the LLM decides. `spec["task"]` is the LLM's own decision,
    started speculatively when Jev is slow (so an escalation costs ~max(Jev, LLM), not the sum),
    cancelled when Jev turns out sure, and started now when a quick Jev is unsure.

    -> (verdict, cost, Jev decision, escalated, degraded)."""
    jev_task = asyncio.ensure_future(
        decide(fit_decision_agent, "FIT INPUT:\n" + fit_payload(rec, profile), model=jev)
    )
    try:
        wait = min(speculate_after_s(), deadline.left())
        d = await asyncio.wait_for(asyncio.shield(jev_task), timeout=wait)
    except TimeoutError:
        if use_llm and spec["task"] is None:
            spec["task"] = asyncio.ensure_future(_run_llm(rec, profile, model))
        d = await deadline.wait(jev_task)
    except BaseException:
        jev_task.cancel()
        raise
    p = d.conf("label")
    if p >= escalate_below():
        if spec["task"] is not None:
            spec["task"].cancel()  # Jev is sure: the speculative LLM decision isn't needed
        jf = jev_fit(d, rec, profile)
        draft, phraser, cost = jf.draft, "template", d.cost_usd
        if phrase:
            try:
                draft, phraser, phrase_cost = await deadline.wait(_phrase(jf, rec, profile, model))
                cost = _add(cost, phrase_cost)
            except TimeoutError:
                log.warning("fit phrasing timed out for %s; template wording", rec.id)
        name = d.model if phraser == "template" else f"{d.model}+{phraser}"
        run_degraded = phrase and phraser == "template"  # GPT wording failed: don't cache
        return _finish(draft, name, rec, profile), cost, d, False, run_degraded

    # System 2: the LLM makes the decision itself, under the same grounding validator
    if not use_llm:
        raise EscalationFailed(f"jev unsure (p={p:.2f}) and no LLM configured")
    if spec["task"] is None:  # a quick, unsure Jev: no speculation happened, ask the LLM now
        spec["task"] = asyncio.ensure_future(_run_llm(rec, profile, model))
    try:
        draft, llm_cost = await deadline.wait(spec["task"])
    except Exception as exc:
        raise EscalationFailed(f"jev unsure (p={p:.2f}) and the LLM failed: {exc!r}") from exc
    if draft.confidence < LOW_CONFIDENCE:  # GPT is the final engine and unsure itself
        draft = draft.model_copy(
            update={
                "label": "mixed",
                "summary": i18n.t("fit.unsure_prefix") + _lower_first(draft.summary),
            }
        )
    name = f"{d.model}\u2192{_llm_name(model)} (escalated, jev p={p:.2f}; confidence self-rated)"
    if draft.label == "mixed" and not draft.concerns:
        # unsure and naming no minus: borrow the rules' grounded concerns, else show the rules
        rules = rules_verdict(rec, profile)
        if not rules.concerns:
            return _finish(rules, "rules", rec, profile), _add(d.cost_usd, llm_cost), d, True, False
        draft = draft.model_copy(update={"concerns": rules.concerns})
    return (
        _finish(draft, name, rec, profile),
        _add(d.cost_usd, llm_cost),
        d,
        True,
        False,
    )


async def fit_run(
    rec: RankedRecommendation,
    profile: TasteProfile,
    model: Model | str | None = None,
    *,
    engine: Engine | None = None,
    jev: Model | None = None,
    phrase: bool | None = None,
    lang: str | None = None,
    deadline_s: float | None = None,
) -> FitRun:
    with i18n.using(i18n.pick(lang)):
        return await _fit_run(
            rec, profile, model, engine=engine, jev=jev, phrase=phrase, deadline_s=deadline_s
        )


async def _fit_run(
    rec: RankedRecommendation,
    profile: TasteProfile,
    model: Model | str | None,
    *,
    engine: Engine | None,
    jev: Model | None,
    phrase: bool | None,
    deadline_s: float | None = None,
) -> FitRun:
    """One uncached verdict through the fallback chain jev -> llm -> rules.

    `model` overrides the LLM, `jev` the Jev model (tests pass FunctionModels for both).
    `phrase=False` keeps Jev's template wording even when an LLM is available.
    """
    if engine is None:
        engine = "jev" if jev is not None else "llm" if model is not None else fit_engine()
    use_jev = engine == "jev" and (jev is not None or jev_enabled())
    use_llm = engine in ("jev", "llm") and (model is not None or llm_enabled())
    t0 = time.perf_counter()
    cost: float | None = None

    def done(verdict: FitVerdict, used: Engine) -> FitRun:
        return FitRun(verdict, used, (time.perf_counter() - t0) * 1000, cost)

    deadline = _Deadline(llm_timeout_s() if deadline_s is None else deadline_s)
    # the LLM's own decision, started by the cascade when Jev is slow (see speculate_after_s)
    spec: dict = {"task": None}
    try:
        if use_jev:
            try:
                phrase = use_llm if phrase is None else phrase
                verdict, cost, d, escalated, degraded = await _run_cascade(
                    rec, profile, model, jev, use_llm, phrase, spec, deadline
                )
                run = done(verdict, "jev")
                run.jev, run.escalated, run.degraded = d, escalated, degraded
                return run
            except EscalationFailed as exc:
                log.warning("fit for %s: %s; using rules", rec.id, exc)
                return done(_finish(rules_verdict(rec, profile), "rules", rec, profile), "rules")
            except Exception as exc:  # noqa: BLE001 - Jev failed or timed out: next engine
                log.warning("jev fit failed for %s, falling back: %r", rec.id, exc)
        if use_llm:
            try:
                task = spec["task"] if spec["task"] is not None else _run_llm(rec, profile, model)
                draft, cost = await deadline.wait(task)
                return done(_finish(draft, _llm_name(model), rec, profile), "llm")
            except Exception as exc:  # noqa: BLE001 - fall back to rules, never break ranking
                log.warning("fit agent failed for %s, using rules: %r", rec.id, exc)
        return done(_finish(rules_verdict(rec, profile), "rules", rec, profile), "rules")
    finally:
        if spec["task"] is not None and not spec["task"].done():
            spec["task"].cancel()


_CACHE: "OrderedDict[str, dict]" = OrderedDict()  # in-process layer over llm_cache (entries)
FIT_KEY_VERSION = "2"


def trip_facts(rec: RankedRecommendation) -> list:
    """What a fit verdict is about (not prices: those are the budget's job)."""
    crowd = None if rec.crowd is None else round(rec.crowd, 2)
    temp = None if rec.temp_c is None else round(rec.temp_c)
    return [rec.id, sorted(rec.tags), list(rec.highlights), temp, crowd]


def style_profile(profile: TasteProfile) -> dict:
    """The parts of a profile a fit verdict depends on (no user id, budget, airports, party)."""
    p = effective_profile(profile)
    return {
        "traits": {k: p.traits[k] for k in sorted(p.traits)},
        "interests": {k: p.interests[k] for k in sorted(p.interests)},
        "dislikes": sorted(p.dislikes),
        "luxury": p.luxury.value,
        "preferred_temp_c": list(p.preferred_temp_c),
        "daily_discovery": p.daily_discovery,
        "personalize": p.personalize,
    }


def _entry(verdict: FitVerdict, rec: RankedRecommendation) -> dict:
    """Cache entry: the verdict + the *kind* of each cited evidence item, so a reuse on a card
    whose evidence list differs (other phase, refreshed prices) can re-point the citations."""

    def kinds(points: list[FitPoint]) -> list[list[str]]:
        return [[rec.evidence[i].kind for i in pt.evidence if 0 <= i < len(rec.evidence)]
                for pt in points]  # fmt: skip

    return {"verdict": verdict.model_dump(mode="json"),
            "kinds": {"matches": kinds(verdict.matches), "concerns": kinds(verdict.concerns)}}  # fmt: skip


def _rebind(entry: dict, rec: RankedRecommendation, profile: TasteProfile) -> FitVerdict | None:
    """The cached verdict with citations pointing at this card's evidence; None (a miss) if any
    point can't be re-cited or re-grounded here."""
    try:
        v = FitVerdict.model_validate(entry["verdict"])
        kinds = entry.get("kinds") or {}
    except (ValueError, KeyError, TypeError):
        return None
    first = {}
    for i, e in enumerate(rec.evidence):
        first.setdefault(e.kind, i)
    answers = dna_answers(profile)
    out = {}
    for side in ("matches", "concerns"):
        points = []
        for pt, ks in zip(getattr(v, side), kinds.get(side) or [[] for _ in getattr(v, side)]):
            if any(k not in first for k in ks):
                return None
            moved = pt.model_copy(update={"evidence": [first[k] for k in ks]})
            if point_problems(moved, rec, answers):
                return None
            points.append(moved)
        out[side] = points
    if ungrounded_numbers(_without_card_ids(v.summary), allowed_numbers(rec)):
        return None
    return v.model_copy(update=out)


CACHE_SIZE = 1024


def needs_a_minus(draft: FitDraft) -> FitDraft:
    """Rules engine only (it computed every concern it could): a "mixed" / "not your style"
    verdict with no minus at all is a good fit (template wording, so the text agrees)."""
    if draft.label in ("mixed", "poor_fit") and not draft.concerns:
        return draft.model_copy(update={
            "label": "good_fit",
            "summary": template_summary("good_fit", draft.matches, draft.concerns),
        })  # fmt: skip
    return draft


def with_a_minus(
    draft: FitDraft, rec: RankedRecommendation, profile: TasteProfile
) -> tuple[FitDraft, bool]:
    """An engine's mixed / poor_fit verdict whose concerns didn't survive grounding: name the
    deterministic minus (the rules' grounded concerns) under the engine's label. With no minus
    on the deterministic side either, show the rules verdict. Never promoted on its own.
    -> (draft, True when the result is the rules' own verdict)."""
    if draft.label not in ("mixed", "poor_fit") or draft.concerns:
        return draft, False
    rules = rules_verdict(rec, profile)
    if rules.concerns:
        return draft.model_copy(update={"concerns": rules.concerns}), False
    return rules, True


def _finish(
    draft: FitDraft,
    model: str,
    rec: RankedRecommendation,
    profile: TasteProfile,
    unsure: bool = False,
):
    if model != "rules":
        draft, from_rules = with_a_minus(draft, rec, profile)
        if from_rules:
            model = "rules"  # the engine named no minus and neither do the rules: rules' verdict
    summary = draft.summary
    neutral = i18n.t("fit.neutral_prefix")
    if not profile.personalize and not summary.startswith(neutral):
        summary = neutral + summary
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


def _engine_key(engine: Engine, model: Model | str | None, jev: Model | None) -> str:
    llm = model if isinstance(model, str) else model.model_name if model else model_name()
    if engine == "jev":
        return f"jev:{jev.model_name if jev else jev_model_name()}+{llm}"
    return llm if engine == "llm" else "rules"


def _resolve_engine(engine, model, jev) -> Engine:
    if engine is None:
        engine = "jev" if jev is not None else "llm" if model is not None else fit_engine()
    if engine == "jev" and jev is None and not jev_enabled():
        engine = "llm"
    if engine == "llm" and model is None and not llm_enabled():
        engine = "rules"
    return engine


def _fit_key(rec, profile, engine, model, jev, lg) -> str:
    # Stable key: the trip (city, dates, tags, highlights, weather, crowd level) x the person's
    # style profile x language x engine/prompts. Not prices, not the rest of the list, not the
    # user id: the same profile + trip gets the same verdict on every reload (and in both phases).
    return llm_cache.digest("fit", FIT_KEY_VERSION, _engine_key(engine, model, jev), lg,
                            trip_facts(rec), style_profile(profile),
                            INSTRUCTIONS, PHRASE_INSTRUCTIONS)  # fmt: skip


async def _cached(key: str, engine: Engine, rec, profile) -> FitVerdict | None:
    entry = _CACHE.get(key)
    if entry is None and engine != "rules":
        stored = await llm_cache.get(llm_cache.FIT, key)
        if isinstance(stored, dict) and "verdict" in stored:
            entry = stored
            _remember(key, entry)
    if entry is None:
        return None
    _CACHE.move_to_end(key)
    hit = _rebind(entry, rec, profile)  # citations re-pointed at this card's evidence
    return None if hit is None else hit.model_copy(update={"inputs_hash": rec.inputs_hash})


async def _compute(key, rec, profile, model, engine, jev, lg) -> FitVerdict:
    run = await fit_run(rec, profile, model, engine=engine, jev=jev, lang=lg,
                        deadline_s=llm_cache.background_limit_s())  # fmt: skip
    if run.engine != engine or run.degraded:
        # a fallback (engine failed in time) was shown: pin it as provisional like a late one,
        # so the label can't flip on reload; an agreeing AI verdict may replace it later
        if _CACHE.get(key) is None:
            entry = _entry(run.verdict, rec) | {"provisional": True}
            _remember(key, entry)
            if engine != "rules":
                await llm_cache.put(llm_cache.FIT, key, entry)
        return run.verdict
    shown = _CACHE.get(key)
    if shown is None and engine != "rules":
        shown = await llm_cache.get(llm_cache.FIT, key)
    if (
        isinstance(shown, dict)
        and shown.get("provisional")
        and shown["verdict"].get("label") != run.verdict.label
    ):
        # the user already saw another label for this trip: it stays (same verdict on every
        # reload); the AI verdict only replaces it when it agrees
        return run.verdict
    entry = _entry(run.verdict, rec)
    _remember(key, entry)
    if engine != "rules":
        await llm_cache.put(llm_cache.FIT, key, entry)
    return run.verdict


async def fit(
    rec: RankedRecommendation,
    profile: TasteProfile,
    model: Model | str | None = None,
    *,
    engine: Engine | None = None,
    jev: Model | None = None,
    lang: str | None = None,
) -> FitVerdict:
    """Grounded fit verdict in `lang` (default: the request's). Cached in process and in
    `api_cache` (llm_cache) under a stable key (trip x style profile x language x engine);
    fallbacks are never cached."""
    lg = i18n.pick(lang)
    engine = _resolve_engine(engine, model, jev)
    key = _fit_key(rec, profile, engine, model, jev, lg)
    hit = await _cached(key, engine, rec, profile)
    if hit is not None:
        return hit

    def late() -> FitVerdict:
        # past the deadline: the rules verdict now. It is remembered as this trip's (provisional)
        # verdict, so a reload shows the same label; the engines finish in the background and
        # replace it only if they agree on the label (docs: stable verdicts)
        with i18n.using(lg):
            v = _finish(rules_verdict(rec, profile), "rules", rec, profile)
        entry = _entry(v, rec) | {"provisional": True}
        _remember(key, entry)
        if engine != "rules":
            llm_cache.put_later(llm_cache.FIT, key, entry)
        return v

    return await llm_cache.within(
        key, lambda: _compute(key, rec, profile, model, engine, jev, lg), late
    )


def prefetch_fit(
    rec: RankedRecommendation,
    profile: TasteProfile,
    model: Model | str | None = None,
    *,
    engine: Engine | None = None,
    jev: Model | None = None,
    lang: str | None = None,
) -> None:
    """Start this card's AI verdict in the background (fast phase), so the full phase that
    follows finds it ready or running: one verdict per profile + trip, no rules-then-AI flip."""
    lg = i18n.pick(lang)
    engine = _resolve_engine(engine, model, jev)
    if engine == "rules":
        return  # deterministic and instant: nothing to prefetch
    key = _fit_key(rec, profile, engine, model, jev, lg)
    if key in _CACHE:
        return

    async def run() -> FitVerdict:
        hit = await _cached(key, engine, rec, profile)
        if hit is not None:
            return hit  # another instance already has it
        with i18n.using(lg):
            return await _compute(key, rec, profile, model, engine, jev, lg)

    llm_cache.prefetch(key, run)


def _remember(key: str, entry: dict) -> None:
    _CACHE[key] = entry
    _CACHE.move_to_end(key)
    while len(_CACHE) > CACHE_SIZE:
        _CACHE.popitem(last=False)


def clear_cache() -> None:
    _CACHE.clear()
