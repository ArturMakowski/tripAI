"""Budget = value, not a cap (docs/BUDGET.md).

- `typical_spend`: what this user usually spends on a trip. The median of their history (saved
  picks, liked swipes) once there are >= 3 trips, else the DNA luxury level's default. It feeds
  the price factor (`engine.price_score`) in place of a cap.
- `annotate_value`: deterministic `value_badge` + `value_reason` on each recommendation when the
  profile has no hard limit (`budget_pln` is None). Every number comes from the cards' totals,
  scores and evidence:
  * great_value (checked first): price factor >= 0.75 and in the top quarter of the list AND
    fit >= good (AI fit verdict if present, else the score band);
  * worth_splurge: costs more than the user's typical spend AND >= 15% more than the cheapest
    top-5 alternative AND its non-price score (weather/crowds/taste, the user's weights) beats
    that alternative's by >= 0.10, with at least one concrete gain to name.
Only cards with `price_status == "exact"` get a badge or serve as the comparison.
"""

import statistics
from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel

from tripai import i18n
from tripai.models import TasteProfile, Weights
from tripai.scoring.engine import DEFAULT_SPEND_PLN, normalise_weights
from tripai.scoring.types import RankedRecommendation

MIN_HISTORY = 3
SPLURGE_MIN_PREMIUM = 0.15
SPLURGE_MIN_EDGE = 0.10  # non-price score lead, 0..1
GREAT_VALUE_PRICE = 0.75
GOOD_FIT = {"good_fit", "great_fit"}
GOOD_TOTAL = 0.65  # score band for "good" when no fit verdict (fit.label_from_score)
TOP_N = 5
MIN_DEG = 2.0  # a smaller temperature gap isn't worth mentioning


class TypicalSpend(BaseModel):
    pln: float
    source: Literal["history", "dna"]
    trips: int  # history size used (0 for dna)


def typical_spend(profile: TasteProfile, history: Sequence[float] = ()) -> TypicalSpend:
    spent = [float(x) for x in history if x and x > 0]
    if len(spent) >= MIN_HISTORY:
        return TypicalSpend(pln=round(statistics.median(spent)), source="history", trips=len(spent))
    return TypicalSpend(pln=DEFAULT_SPEND_PLN[profile.luxury], source="dna", trips=0)


def _non_price(r: RankedRecommendation, w: Weights) -> float:
    total = w.weather + w.crowds + w.taste
    if total <= 0:
        return (r.score.weather + r.score.crowds + r.score.taste) / 3
    return (
        w.weather * r.score.weather + w.crowds * r.score.crowds + w.taste * r.score.taste
    ) / total


def _fit_ok(r: RankedRecommendation) -> bool:
    if r.fit is not None:
        return r.fit.label in GOOD_FIT
    return r.score.total >= GOOD_TOTAL


def _splurge_parts(r: RankedRecommendation, alt: RankedRecommendation) -> list[str]:
    """What the extra money buys, only where this card is better and the numbers exist."""
    parts = []
    if r.score.weather > alt.score.weather and r.temp_c is not None and alt.temp_c is not None:
        d = round(r.temp_c - alt.temp_c, 1)
        if abs(d) >= MIN_DEG:
            key = "value.warmer" if d > 0 else "value.cooler"
            parts.append(i18n.t(key, deg=i18n.fmt_dec(abs(d))))
    if r.crowd is not None and alt.crowd is not None and r.crowd < alt.crowd and alt.crowd > 0:
        fewer = round(100 * (1 - r.crowd / alt.crowd))
        if fewer >= 10:
            parts.append(i18n.t("value.fewer_crowds", pct=fewer))
    if r.score.taste > alt.score.taste:
        parts.append(
            i18n.t(
                "value.better_taste",
                a=round(100 * r.score.taste),
                b=round(100 * alt.score.taste),
            )
        )
    return parts


def annotate_value(
    recs: Sequence[RankedRecommendation],
    profile: TasteProfile,
    weights: Weights | None,
    typical: TypicalSpend,
    lang: str | None = None,
) -> None:
    """Set `value_badge` / `value_reason` in place (no hard limit only; None otherwise)."""
    with i18n.using(i18n.pick(lang)):
        for r in recs:
            r.value_badge = r.value_reason = None
        if profile.budget_pln:
            return  # the hard limit (#16) speaks instead
        w = normalise_weights(weights)
        # badges and their comparisons use exact prices only (price_status, price-honesty rules)
        exact = [r for r in recs if r.price_status == "exact"]
        top = exact[:TOP_N]
        # "high" price factor = >= 0.75 AND in the top quarter of this list (a badge on every
        # card would say nothing)
        prices = sorted((r.score.price for r in exact), reverse=True)
        cut = max(GREAT_VALUE_PRICE, prices[max(0, -(-len(prices) // 4) - 1)]) if prices else 1.0
        for r in exact:
            if r.score.price >= cut and _fit_ok(r):
                r.value_badge = "great_value"
                if r.total_cost_pln < typical.pln:
                    r.value_reason = i18n.t(
                        "value.great_under",
                        city=r.city,
                        total=i18n.fmt_pln(r.total_cost_pln),
                        under=i18n.fmt_pln(typical.pln - r.total_cost_pln),
                        typical=i18n.fmt_pln(typical.pln),
                        price=round(100 * r.score.price),
                    )
                else:
                    r.value_reason = i18n.t(
                        "value.great",
                        city=r.city,
                        total=i18n.fmt_pln(r.total_cost_pln),
                        price=round(100 * r.score.price),
                        fit=round(100 * r.score.total),
                    )
                continue
            if r.total_cost_pln <= typical.pln:
                continue  # within what this user usually spends: not a splurge
            others = [o for o in top if o.id != r.id]
            alt = min(others, key=lambda o: (o.total_cost_pln, o.id)) if others else None
            if (
                alt is not None
                and r.total_cost_pln >= (1 + SPLURGE_MIN_PREMIUM) * alt.total_cost_pln
                and _non_price(r, w) - _non_price(alt, w) >= SPLURGE_MIN_EDGE
                and (parts := _splurge_parts(r, alt))
            ):
                r.value_badge = "worth_splurge"
                r.value_reason = i18n.t(
                    "value.splurge",
                    city=r.city,
                    amount=i18n.fmt_pln(r.total_cost_pln - alt.total_cost_pln),
                    alt=alt.city,
                    parts=", ".join(parts),
                )
