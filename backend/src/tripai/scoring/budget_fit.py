"""`TasteProfile.budget_pln` as a hard constraint on top of the deterministic ranking.

- within: total <= budget
- slightly_over: budget < total <= budget * (1 + TOLERANCE); kept, ranked normally, flagged
- price_status != "exact" (other dates / city average): no budget status; listed after every
  exact option that fits, and only if even the estimate fits (docs/BUDGET.md "Price honesty").
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
    limit it is the limit itself, exactly as in #16 (a trip well inside the user's own limit is
    not "expensive" just because their history is frugal).

    Price honesty holds with or without a budget: exact-priced options first, then the ones
    without a price for these dates (labelled, no flip hints); see docs/BUDGET.md."""
    budget = profile.budget_pln
    ref = float(budget) if budget else typical_spend_pln
    # same dedup + hash as rank() over the full input, so receipts stay comparable
    unique = list({candidate_id(c): c for c in reversed(candidates)}.values())
    # the limit is in the profile already; the hash carries the real typical spend
    digest = inputs_hash(unique, profile, weights or Weights(), typical_spend_pln)
    kept, receipt = interest_filter(unique, profile)
    cap = budget * (1 + TOLERANCE) if budget else float("inf")
    # price honesty: only a price for these dates can be checked against the budget
    exact = [c for c in kept if c.price_status == "exact"]
    unsure = [c for c in kept if c.price_status != "exact"]
    fits = [c for c in exact if c.total_cost_pln <= cap]
    recs = rank(fits, profile, weights, limit=limit, typical_spend_pln=ref) if fits else []
    n_exact = len(recs)
    # then options without an exact price (labelled, no budget status): only when even their
    # other-dates estimate fits, and always after every exact option (that fits)
    maybe = [c for c in unsure if c.total_cost_pln <= cap and c.iata not in {r.iata for r in recs}]
    if maybe and len(recs) < limit:
        more = rank(maybe, profile, weights, limit=limit - len(recs), typical_spend_pln=ref)
        for r in more:
            r.flip = None  # never "would overtake" an exact-priced option on a guessed price
        recs += more
    want = min(MIN_RESULTS, limit)
    if budget and fallback and n_exact < want and len(recs) < want:
        over = [c for c in exact if c.total_cost_pln > cap]
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
        exact_price = r.price_status == "exact"
        status = budget_status(r.total_cost_pln, budget) if budget and exact_price else None
        out.append((r, status))
    return out
