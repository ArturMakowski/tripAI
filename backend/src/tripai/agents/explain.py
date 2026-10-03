"""Explain agent: writes `Recommendation.why` from the evidence only. Any number in the text that is
not present in the evidence/receipt is rejected and the model is asked to retry."""

import json
import logging
import re

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models import Model

from tripai.agents.llm import llm_enabled, model_name
from tripai.models import Evidence
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
  write must appear verbatim in the evidence (prices, °C, crowds, dates, deltas, score points).
- Write numbers exactly as their `display` strings are given (e.g. "1–3 Jan", "33% of peak",
  "1014 PLN", "15 °C"). Never write ISO dates or raw 0-1 indexes.
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


def fmt_pln(v: float) -> str:
    return f"{round(v)} PLN"


def fmt_temp(v: float) -> str:
    return f"{round(v, 1):g} °C"


def fmt_dates(start, end) -> str:
    """'1–3 Jan', '30 Dec–2 Jan', '1 Jan'."""
    s_m, e_m = MONTHS[start.month - 1], MONTHS[end.month - 1]
    if start == end:
        return f"{start.day} {s_m}"
    if (start.year, start.month) == (end.year, end.month):
        return f"{start.day}–{end.day} {s_m}"
    return f"{start.day} {s_m}–{end.day} {e_m}"


def fmt_value(e: Evidence) -> str:
    """Display form of one evidence value (what the UI and the 'why' text should say)."""
    v = e.value
    if not isinstance(v, (int, float)):
        return str(v)
    if e.unit == "PLN":
        return fmt_pln(v)
    if e.unit == "°C":
        return fmt_temp(v)
    if e.unit == "0-1":
        pct = round(v * 100)
        if e.kind == "crowds":
            return f"{pct}% of peak"
        if "rain" in e.label.lower():
            return f"{pct}% of days"
        return f"{pct}%"
    return f"{v:g}" + (f" {e.unit}" if e.unit else "")


def display_numbers(rec: RankedRecommendation) -> set[float]:
    """Numbers that appear only in display forms (0-1 values shown as percentages)."""
    out: set[float] = set()
    for e in rec.evidence:
        if e.unit == "0-1" and isinstance(e.value, (int, float)):
            out.add(float(round(e.value * 100)))
    for c in rec.counterfactuals:
        if c.crowd is not None:
            out.add(float(round(c.crowd * 100)))
    return out


def evidence_payload(rec: RankedRecommendation, interests: dict[str, float] | None = None) -> str:
    matched = sorted(t for t in rec.tags if interests and t in interests)
    nights = (rec.window.end - rec.window.start).days
    payload = {
        "city": rec.city,
        "country": rec.country,
        "dates": fmt_dates(rec.window.start, rec.window.end),
        "nights": nights,
        "total_cost": fmt_pln(rec.total_cost_pln),
        "flight_cost": fmt_pln(rec.flight_cost_pln),
        "hotel_cost": fmt_pln(rec.hotel_cost_pln),
        "score_points_of_100": {
            f: round(getattr(rec.score, f) * 100)
            for f in ("price", "weather", "crowds", "taste", "total")
        },
        "matched_interests": matched,
        "highlights": rec.highlights,
        "evidence": [{"label": e.label, "display": fmt_value(e)} for e in rec.evidence],
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
    bad = ungrounded_numbers(output, allowed_numbers(ctx.deps) | display_numbers(ctx.deps))
    if bad:
        raise ModelRetry(
            f"These numbers are not in the evidence: {', '.join(bad)}. "
            "Rewrite using only numbers that appear in the evidence."
        )
    return output.strip()


def template_why(rec: RankedRecommendation, interests: dict[str, float] | None = None) -> str:
    """Deterministic explanation built only from evidence (used without an LLM and as fallback)."""
    ev: dict = {}
    for x in rec.evidence:
        ev.setdefault(x.kind, x)  # first fact per kind (e.g. avg temp before rainy-day share)
    parts = [
        (
            f"{rec.city}, {fmt_dates(rec.window.start, rec.window.end)}: about "
            f"{fmt_pln(rec.total_cost_pln)} in total (flight {fmt_pln(rec.flight_cost_pln)}, "
            f"hotel {fmt_pln(rec.hotel_cost_pln)})."
        )
    ]
    peak = next((c for c in rec.counterfactuals if c.kind == "peak_season"), None)
    if peak and peak.cost_delta_pln > 0:
        parts.append(
            f"That is {fmt_pln(peak.cost_delta_pln)} cheaper than the same trip in peak season."
        )
    bits = []
    if "weather" in ev:
        bits.append(f"around {fmt_value(ev['weather'])}")
    if "crowds" in ev:
        bits.append(f"crowds at {fmt_value(ev['crowds'])}")
    if bits:
        parts.append("Expect " + ", with ".join(bits) + ".")
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
