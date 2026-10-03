"""`TasteProfile.budget_pln` as a hard constraint on top of the deterministic ranking.

- within: total <= budget
- slightly_over: budget < total <= budget * (1 + TOLERANCE); kept, ranked normally, flagged
- over: dropped, unless fewer than MIN_RESULTS options fit. Then the closest over-budget options
  (smallest overage, one per city) are appended, flagged with the overage in PLN, and always
  ranked *below* every option that fits. `fallback=False` (proactive scan) never adds them.
The personalize=False interest filter runs once, on all candidates, *before* the budget split:
fallbacks come only from cities the filter kept, and every rec carries that one receipt.
No budget set -> plain `rank()`, no status. Scores themselves are untouched (`engine`)."""

from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel

from tripai import i18n
from tripai.models import TasteProfile, Weights
from tripai.scoring.engine import (
    candidate_id,
    effective_budget,
    inputs_hash,
    interest_filter,
    rank,
)
from tripai.scoring.types import Candidate, RankedRecommendation

TOLERANCE = 0.10
MIN_RESULTS = 3

Status = Literal["within", "slightly_over", "over"]


class BudgetStatus(BaseModel):
    status: Status
    budget_pln: float
    total_cost_pln: float
    overage_pln: float  # 0 when within budget
    overage_pct: float
    label: str


def budget_status(total: float, budget: float) -> BudgetStatus:
    """Status from the exact total (same comparison as the filter); PLN shown rounded."""
    over = total - budget
    pct = round(100 * over / budget, 1) if budget > 0 else 0.0
    if over <= 0:
        status, label = "within", i18n.t("budget.within", amount=i18n.fmt_pln(budget))
    elif total <= budget * (1 + TOLERANCE):
        status, label = "slightly_over", i18n.t("budget.slightly", amount=i18n.fmt_pln(over),
                                                pct=i18n.fmt_dec(pct))  # fmt: skip
    else:
        status, label = "over", i18n.t("budget.over", amount=i18n.fmt_pln(over),
                                       pct=i18n.fmt_dec(pct))  # fmt: skip
    return BudgetStatus(
        status=status,
        budget_pln=budget,
        total_cost_pln=round(total),
        overage_pln=max(0, round(over)),
        overage_pct=max(0.0, pct),
        label=label,
    )


def _closest_per_city(cands: Sequence[Candidate], n: int, exclude: set[str]) -> list[Candidate]:
    best: dict[str, Candidate] = {}
    for c in sorted(cands, key=lambda c: (c.total_cost_pln, c.iata, c.window.start)):
        if c.iata not in exclude:
            best.setdefault(c.iata, c)
    return sorted(best.values(), key=lambda c: (c.total_cost_pln, c.iata))[:n]


def rank_within_budget(
    candidates: Sequence[Candidate],
    profile: TasteProfile,
    weights: Weights | None,
    *,
    limit: int = 10,
    fallback: bool = True,
    typical_spend_pln: float | None = None,
) -> list[tuple[RankedRecommendation, BudgetStatus | None]]:
    """Ranked recommendations with their budget status (None when the profile has no budget).
    The price factor's reference is the user's typical spend (docs/BUDGET.md); with a hard
    limit it is capped at the limit, so the #16 behaviour is unchanged."""
    budget = profile.budget_pln
    if not budget:
        recs = rank(candidates, profile, weights, limit=limit, typical_spend_pln=typical_spend_pln)
        return [(r, None) for r in recs]
    ref = min(typical_spend_pln or effective_budget(profile), budget)
    # same dedup + hash as rank() over the full input, so receipts stay comparable
    unique = list({candidate_id(c): c for c in reversed(candidates)}.values())
    digest = inputs_hash(unique, profile, weights or Weights(), ref)
    kept, receipt = interest_filter(unique, profile)
    cap = budget * (1 + TOLERANCE)
    fits = [c for c in kept if c.total_cost_pln <= cap]
    recs = rank(fits, profile, weights, limit=limit, typical_spend_pln=ref) if fits else []
    want = min(MIN_RESULTS, limit)
    if fallback and len(recs) < want:
        over = [c for c in kept if c.total_cost_pln > cap]
        extra = _closest_per_city(over, want - len(recs), {r.iata for r in recs})
        if extra:
            ranked = rank(extra, profile, weights, limit=len(extra), typical_spend_pln=ref)
            for r in ranked:
                r.flip = None  # a flip vs another fallback would read as a real alternative
            # closest first, whatever their score: they are fallbacks, not recommendations
            recs += sorted(ranked, key=lambda r: (r.total_cost_pln, r.iata))
    out = []
    for i, r in enumerate(recs):
        # the subset rank() calls re-ran the filter on already-filtered input: use the receipt
        # of the one real filter pass
        r.rank, r.inputs_hash, r.interest_filter = i + 1, digest, receipt
        out.append((r, budget_status(r.total_cost_pln, budget)))
    return out
