"""Explain agent: writes `Recommendation.why` from the evidence only. Any number in the text that is
not present in the evidence/receipt is rejected and the model is asked to retry."""

import json
import logging
import re

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models import Model

from tripai.agents.llm import llm_enabled, model_name
from tripai.scoring.engine import MONTHS
from tripai.scoring.types import RankedRecommendation

log = logging.getLogger(__name__)

_THOUSANDS = re.compile(r"(?<=\d)[   ,](?=\d{3}(?!\d))")
_DECIMAL_COMMA = re.compile(r"(?<=\d),(?=\d{1,2}(?!\d))")  # "18,5 °C" -> 18.5
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_ALWAYS_OK = {0.0, 1.0, 100.0}

INSTRUCTIONS = """\
You explain one travel recommendation to the user in 2-3 short, warm sentences (max 70 words).
Rules:
- Use ONLY facts from the EVIDENCE JSON. Never invent or compute new numbers: every number you
  write must appear verbatim in the evidence (prices, °C, crowd index, dates, deltas, score points).
- Mention why this place AND why these dates (e.g. cheaper than peak season, fewer crowds).
- Mention which of the user's interests it matches, using the tag/highlight words given.
- No markdown, no lists, no emojis. Prices in PLN."""


def numbers_in(text: str) -> list[str]:
    """Every number in `text` (thousand separators and decimal commas normalised)."""
    return _NUMBER.findall(_THOUSANDS.sub("", _DECIMAL_COMMA.sub(".", text)))


def allowed_numbers(rec: RankedRecommendation) -> set[float]:
    vals: list[float] = [
        rec.total_cost_pln,
        rec.flight_cost_pln,
        rec.hotel_cost_pln,
        rec.rank,
        rec.window.start.day,
        rec.window.end.day,
        rec.window.start.month,
        rec.window.end.month,
        rec.window.start.year,
        rec.window.end.year,
        (rec.window.end - rec.window.start).days,
        (rec.window.end - rec.window.start).days + 1,
    ]
    texts: list[str] = [rec.flip.text] if rec.flip else []
    for f in ("price", "weather", "crowds", "taste", "total"):
        v = getattr(rec.score, f)
        vals += [v, v * 100]
    for e in rec.evidence:
        if isinstance(e.value, (int, float)):
            vals.append(float(e.value))
        else:
            texts.append(e.value)
        texts.append(e.label)
    for c in rec.counterfactuals:
        vals += [c.total_cost_pln, c.cost_delta_pln, c.cost_delta_pct, c.score_total * 100]
        vals += [x for x in (c.crowd, c.temp_c) if x is not None]
        texts.append(c.text)
    for t in texts:
        vals += [float(n) for n in numbers_in(t)]
    out = set(_ALWAYS_OK)
    for v in vals:
        out |= {abs(v), abs(round(v)), abs(round(v, 1))}
    return out


def ungrounded_numbers(text: str, allowed: set[float]) -> list[str]:
    return [n for n in numbers_in(text) if not any(abs(float(n) - a) < 0.051 for a in allowed)]


def evidence_payload(rec: RankedRecommendation, interests: dict[str, float] | None = None) -> str:
    matched = sorted(t for t in rec.tags if interests and t in interests)
    payload = {
        "city": rec.city,
        "country": rec.country,
        "dates": f"{rec.window.start.isoformat()} to {rec.window.end.isoformat()}",
        "total_cost_pln": rec.total_cost_pln,
        "flight_cost_pln": rec.flight_cost_pln,
        "hotel_cost_pln": rec.hotel_cost_pln,
        "score_points": {
            f: round(getattr(rec.score, f) * 100)
            for f in ("price", "weather", "crowds", "taste", "total")
        },
        "matched_interests": matched,
        "highlights": rec.highlights,
        "evidence": [
            {"label": e.label, "value": e.value, "unit": e.unit, "source": e.source}
            for e in rec.evidence
        ],
        "counterfactuals": [c.text for c in rec.counterfactuals],
        "what_would_flip": rec.flip.text if rec.flip else None,
    }
    return json.dumps(payload, ensure_ascii=False)


explain_agent = Agent(
    None,
    output_type=str,
    instructions=INSTRUCTIONS,
    deps_type=RankedRecommendation,
    retries=2,
    defer_model_check=True,
)


@explain_agent.output_validator
def _grounded(ctx: RunContext[RankedRecommendation], output: str) -> str:
    bad = ungrounded_numbers(output, allowed_numbers(ctx.deps))
    if bad:
        raise ModelRetry(
            f"These numbers are not in the evidence: {', '.join(bad)}. "
            "Rewrite using only numbers that appear in the evidence."
        )
    return output.strip()


def _num(v: float | str) -> str:
    return f"{v:g}" if isinstance(v, (int, float)) else v


def template_why(rec: RankedRecommendation, interests: dict[str, float] | None = None) -> str:
    """Deterministic explanation built only from evidence (used without an LLM and as fallback)."""
    s, e = rec.window.start, rec.window.end
    when = f"{s.day} {MONTHS[s.month - 1]}" + (
        f"-{e.day} {MONTHS[e.month - 1]}" if (s.month, s.day) != (e.month, e.day) else ""
    )
    ev: dict = {}
    for x in rec.evidence:
        ev.setdefault(x.kind, x)  # first fact per kind (e.g. avg temp before rainy-day share)
    parts = [
        (
            f"{rec.city}, {when}: about {rec.total_cost_pln:.0f} PLN in total "
            f"(flight {rec.flight_cost_pln:.0f} PLN, hotel {rec.hotel_cost_pln:.0f} PLN)."
        )
    ]
    peak = next((c for c in rec.counterfactuals if c.kind == "peak_season"), None)
    if peak and peak.cost_delta_pln > 0:
        parts.append(
            f"That is {peak.cost_delta_pln:.0f} PLN cheaper than the same trip in peak season."
        )
    bits = []
    if "weather" in ev:
        bits.append(f"around {_num(ev['weather'].value)} °C")
    if "crowds" in ev:
        bits.append(f"crowd index {_num(ev['crowds'].value)} of 1")
    if bits:
        parts.append("Expect " + " and ".join(bits) + ".")
    matched = [t for t in rec.tags if interests and t in interests]
    if matched:
        parts.append(f"Matches your love of {', '.join(matched)}.")
    if rec.highlights:
        parts.append(f"Highlights: {', '.join(rec.highlights)}.")
    return " ".join(parts)


async def explain(
    rec: RankedRecommendation,
    interests: dict[str, float] | None = None,
    model: Model | str | None = None,
) -> str:
    """LLM explanation grounded in evidence; deterministic template if no model or it fails."""
    if model is None and not llm_enabled():
        return template_why(rec, interests)
    try:
        result = await explain_agent.run(
            "EVIDENCE:\n" + evidence_payload(rec, interests),
            model=model or model_name(),
            deps=rec,
        )
        return result.output
    except Exception as exc:  # noqa: BLE001 - never break ranking on LLM trouble
        log.warning("explain agent failed for %s: %s", rec.id, exc)
        return template_why(rec, interests)
