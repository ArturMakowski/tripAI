"""`TasteProfile.budget_pln` as a hard constraint on top of the deterministic ranking.

- within: total <= budget
- slightly_over: budget < total <= budget * (1 + TOLERANCE); kept, ranked normally, flagged
- over: dropped, unless fewer than MIN_RESULTS options fit. Then the closest over-budget options
  (smallest overage, one per city) are appended, flagged with the overage in PLN, and always
  ranked *below* every option that fits.
No budget set -> plain `rank()`, no status. Scores themselves are untouched (tripai.scoring)."""

from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel

from tripai.models import TasteProfile, Weights
from tripai.scoring import rank
from tripai.scoring.engine import inputs_hash
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
    over = round(total - budget)
    pct = round(100 * over / budget, 1) if budget > 0 else 0.0
    if over <= 0:
        status, label = "within", f"Within your {budget:.0f} PLN budget"
    elif total <= budget * (1 + TOLERANCE):
        status, label = "slightly_over", f"Slightly over budget: +{over} PLN ({pct:g}%)"
    else:
        status, label = "over", f"Over budget: +{over} PLN ({pct:g}%)"
    return BudgetStatus(
        status=status,
        budget_pln=budget,
        total_cost_pln=round(total),
        overage_pln=max(0, over),
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
) -> list[tuple[RankedRecommendation, BudgetStatus | None]]:
    """Ranked recommendations with their budget status (None when the profile has no budget)."""
    budget = profile.budget_pln
    if not budget:
        return [(r, None) for r in rank(candidates, profile, weights, limit=limit)]
    cap = budget * (1 + TOLERANCE)
    fits = [c for c in candidates if c.total_cost_pln <= cap]
    recs = rank(fits, profile, weights, limit=limit) if fits else []
    if len(recs) < min(MIN_RESULTS, limit):
        over = [c for c in candidates if c.total_cost_pln > cap]
        extra = _closest_per_city(over, min(MIN_RESULTS, limit) - len(recs), {r.iata for r in recs})
        if extra:
            ranked = rank(extra, profile, weights, limit=len(extra))
            for r in ranked:
                r.flip = None  # a flip vs another fallback would read as a real alternative
            # closest first, whatever their score: they are fallbacks, not recommendations
            recs += sorted(ranked, key=lambda r: (r.total_cost_pln, r.iata))
    # one reproducibility hash for the whole answer (all inputs, budget policy is deterministic)
    digest = inputs_hash(candidates, profile, weights or Weights()) if candidates else ""
    out = []
    for i, r in enumerate(recs):
        r.rank, r.inputs_hash = i + 1, digest or r.inputs_hash
        out.append((r, budget_status(r.total_cost_pln, budget)))
    return out
