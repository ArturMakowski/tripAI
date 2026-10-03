"""Explain agent: writes `Recommendation.why` from the evidence only. Any number in the text that is
not present in the evidence/receipt is rejected and the model is asked to retry."""

import json
import logging
import re

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models import Model

from tripai import i18n
from tripai.agents.llm import llm_enabled, model_name
from tripai.models import Evidence
from tripai.scoring.types import RankedRecommendation

log = logging.getLogger(__name__)

_THOUSANDS = re.compile(r"(?<=\d)[   ,](?=\d{3}(?!\d))")
_DECIMAL_COMMA = re.compile(r"(?<=\d),(?=\d{1,2}(?!\d))")  # "18,5 °C" -> 18.5
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_PCT_IN_LABEL = re.compile(r"\d+(?:[.,]\d+)?\s*%")
_ALWAYS_OK = {0.0, 1.0, 100.0}

INSTRUCTIONS = """\
You explain one travel recommendation to the user in 2-3 short, warm sentences (max 70 words).
Rules:
- Use ONLY facts from the EVIDENCE JSON. Never invent or compute new numbers: every number you
  write must appear verbatim in the evidence (prices, °C, crowds, dates, deltas, score points).
- Write numbers exactly as their `display` strings are given (dates, prices with their currency
  word, °C, "% of peak season"). Never write ISO dates or raw 0-1 indexes.
- Mention why this place AND why these dates (e.g. cheaper than peak season, fewer crowds).
- Mention which of the user's interests it matches, using the tag/highlight words given.
- No markdown, no lists, no emojis. Prices as in the display strings."""


def numbers_in(text: str) -> list[str]:
    """Every number in `text` (thousand separators and decimal commas normalised)."""
    return _NUMBER.findall(_THOUSANDS.sub("", _DECIMAL_COMMA.sub(".", text)))


def allowed_numbers(rec: RankedRecommendation) -> set[float]:
    vals: list[float] = [
        rec.total_cost_pln,
        rec.flight_cost_pln,
        rec.hotel_cost_pln,
        rec.travelers,
        rec.party_total_pln or 0,
        rec.per_person_pln or 0,
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
        # a "N%" in a label (e.g. "Crowds: 28% of peak season") is a percentage of a 0-1 value:
        # it stays on the percent-only path (`display_numbers`), never a free-floating number
        texts.append(_PCT_IN_LABEL.sub("", e.label))
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


def fmt_pln(v: float, lang: str | None = None) -> str:
    return i18n.fmt_pln(v, lang)


def fmt_temp(v: float, lang: str | None = None) -> str:
    return i18n.fmt_temp(v, lang)


def fmt_dates(start, end, lang: str | None = None) -> str:
    """'1–3 Jan', '30 Dec–2 Jan', '1 Jan' (pl: '1–3 sty')."""
    return i18n.fmt_dates(start, end, lang)


def fmt_value(e: Evidence, lang: str | None = None) -> str:
    """Display form of one evidence value (what the UI and the 'why' text should say)."""
    v = e.value
    if not isinstance(v, (int, float)):
        return str(v)
    if e.unit == "PLN":
        return fmt_pln(v, lang)
    if e.unit == "°C":
        return fmt_temp(v, lang)
    if e.unit == "0-1 rel":  # a relative 0..1 scale, not a share of anything
        return i18n.t("disp.crowd_rel", lang, pct=round(v * 100))
    if e.unit == "0-1":
        pct = round(v * 100)
        if e.kind in ("crowds", "peak"):
            return i18n.t("disp.crowd", lang, pct=pct)
        if "rain" in e.label.lower():
            return i18n.t("disp.rain", lang, pct=pct)
        return f"{pct}%"
    return i18n.fmt_dec(v, lang, 2) + (f" {e.unit}" if e.unit else "")


def display_numbers(rec: RankedRecommendation) -> set[float]:
    """Numbers that appear only in display forms: 0-1 values shown as percentages. They are
    accepted only right before a '%' (see `ungrounded_numbers_display`)."""
    out: set[float] = set()
    for e in rec.evidence:
        if e.unit in ("0-1", "0-1 rel") and isinstance(e.value, (int, float)):
            out.add(float(round(e.value * 100)))
    for c in rec.counterfactuals:
        if c.crowd is not None:
            out.add(float(round(c.crowd * 100)))
    return out


def ungrounded_numbers_display(text: str, allowed: set[float], percents: set[float]) -> list[str]:
    """Like `ungrounded_numbers`, but a number from `percents` is also fine when a '%' follows it
    ("33% of peak"), and only then: "33 PLN" from a 0.33 crowd index is still rejected."""
    norm = _THOUSANDS.sub("", _DECIMAL_COMMA.sub(".", text))
    bad = []
    for m in _NUMBER.finditer(norm):
        x = float(m.group())
        if any(abs(x - a) < 0.051 for a in allowed):
            continue
        if norm[m.end() :].lstrip().startswith("%") and any(abs(x - p) < 0.051 for p in percents):
            continue
        bad.append(m.group())
    return bad


def evidence_payload(
    rec: RankedRecommendation, interests: dict[str, float] | None = None, lang: str | None = None
) -> str:
    lg = i18n.pick(lang)
    matched = sorted(t for t in rec.tags if interests and t in interests)
    nights = (rec.window.end - rec.window.start).days
    payload = {
        "city": rec.city,
        "country": rec.country,
        "dates": fmt_dates(rec.window.start, rec.window.end, lg),
        "nights": nights,
        "total_cost": fmt_pln(rec.total_cost_pln, lg),
        "flight_cost": fmt_pln(rec.flight_cost_pln, lg),
        "hotel_cost": fmt_pln(rec.hotel_cost_pln, lg),
        # docs/BUDGET.md party pricing: total = per person, flight = per traveller,
        # hotel = the room(s) for the whole stay, group_total = flights x travellers + hotel
        "travellers": rec.travelers,
        "group_total": fmt_pln(rec.party_total_pln or rec.total_cost_pln, lg),
        "money_basis": "total_cost is per person; flight_cost per traveller; hotel_cost is the "
        "whole stay for all rooms; group_total = flight_cost x travellers + hotel_cost"
        if rec.travelers > 1
        else "total_cost = flight_cost + hotel_cost",
        "score_points_of_100": {
            f: round(getattr(rec.score, f) * 100)
            for f in ("price", "weather", "crowds", "taste", "total")
        },
        "matched_interests": [i18n.tag(t, lg) for t in matched],
        "highlights": rec.highlights,
        "evidence": [{"label": e.label, "display": fmt_value(e, lg)} for e in rec.evidence],
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
    rec = ctx.deps
    bad = ungrounded_numbers_display(output, allowed_numbers(rec), display_numbers(rec))
    if bad:
        raise ModelRetry(
            f"These numbers are not in the evidence: {', '.join(bad)}. "
            "Rewrite using only numbers that appear in the evidence."
        )
    return output.strip()


def template_why(
    rec: RankedRecommendation,
    interests: dict[str, float] | None = None,
    lang: str | None = None,
) -> str:
    """Deterministic explanation built only from evidence (used without an LLM and as fallback)."""
    lg = i18n.pick(lang)
    ev: dict = {}
    for x in rec.evidence:
        ev.setdefault(x.kind, x)  # first fact per kind (e.g. avg temp before rainy-day share)
    parts = [
        i18n.t(
            "why.cost" if rec.travelers == 1 else "why.cost.party",
            lg,
            city=rec.city,
            dates=fmt_dates(rec.window.start, rec.window.end, lg),
            total=fmt_pln(rec.total_cost_pln, lg),
            group=fmt_pln(rec.party_total_pln or rec.total_cost_pln * rec.travelers, lg),
            n=rec.travelers,
            flight=fmt_pln(rec.flight_cost_pln, lg),
            hotel=fmt_pln(rec.hotel_cost_pln, lg),
        )
    ]
    peak = next((c for c in rec.counterfactuals if c.kind == "peak_season"), None)
    if peak and peak.cost_delta_pln > 0:
        parts.append(i18n.t("why.peak", lg, amount=fmt_pln(peak.cost_delta_pln, lg)))
    bits = []
    if "weather" in ev:
        bits.append(i18n.t("why.temp", lg, temp=fmt_value(ev["weather"], lg)))
    if "crowds" in ev:
        bits.append(i18n.t("why.crowds", lg, crowds=fmt_value(ev["crowds"], lg)))
    if bits:
        parts.append(i18n.t("why.expect", lg, parts=i18n.t("why.with", lg).join(bits)))
    matched = [t for t in rec.tags if interests and t in interests]
    if matched:
        parts.append(i18n.t("why.matches", lg, tags=i18n.tags(matched, lg)))
    if rec.highlights:
        parts.append(i18n.t("why.highlights", lg, items=", ".join(rec.highlights)))
    return " ".join(parts)


async def explain(
    rec: RankedRecommendation,
    interests: dict[str, float] | None = None,
    model: Model | str | None = None,
    lang: str | None = None,
) -> str:
    """LLM explanation grounded in evidence; deterministic template if no model or it fails.
    Written in `lang` (default: the request's language)."""
    lg = i18n.pick(lang)
    if model is None and not llm_enabled():
        return template_why(rec, interests, lg)
    try:
        result = await explain_agent.run(
            "EVIDENCE:\n"
            + evidence_payload(rec, interests, lg)
            + "\n\n"
            + i18n.llm_language_rule(lg),
            model=model or model_name(),
            deps=rec,
        )
        return result.output
    except Exception as exc:  # noqa: BLE001 - never break ranking on LLM trouble
        log.warning("explain agent failed for %s: %s", rec.id, exc)
        return template_why(rec, interests, lg)
