"""Deterministic ranking: the only place where scores are produced. No LLM, no I/O, no clock."""

import hashlib
import json
import math
from collections.abc import Sequence
from datetime import timedelta

from tripai.models import LuxuryLevel, ScoreBreakdown, TasteProfile, Weights
from tripai.scoring.types import (
    Candidate,
    Counterfactual,
    FlipHint,
    InterestFilter,
    RankedRecommendation,
)

SCORING_VERSION = "2026.10.03-1"
FACTORS = ("price", "weather", "crowds", "taste")

# Used when the profile has no explicit budget: total per person, PLN.
DEFAULT_BUDGET_PLN = {
    LuxuryLevel.budget: 1500,
    LuxuryLevel.standard: 2500,
    LuxuryLevel.comfort: 4000,
    LuxuryLevel.luxury: 7000,
}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def normalise_weights(weights: Weights | None) -> Weights:
    w = weights or Weights()
    vals = {f: max(0.0, getattr(w, f)) for f in FACTORS}
    total = sum(vals.values())
    if total <= 0:
        return normalise_weights(Weights())
    out = {f: round(v / total, 4) for f, v in vals.items()}
    # make the 4-dp weights sum to exactly 1, so normalising again is a no-op (idempotent):
    # otherwise re-normalising can shift a total by 1e-4 and turn a verified flip into a tie
    drift = round(1.0 - sum(out.values()), 4)
    if drift:
        top = max(FACTORS, key=lambda f: out[f])
        out[top] = round(out[top] + drift, 4)
    return Weights(**out)


def effective_budget(profile: TasteProfile) -> float:
    return float(profile.budget_pln or DEFAULT_BUDGET_PLN[profile.luxury])


def price_score(cost: float, budget: float, seasonal_median: float) -> float:
    """50% fit vs budget (<=50% of budget -> 1, >=125% -> 0) + 50% deal vs seasonal median
    (at median -> 0.5, half the median -> 1, 1.5x median -> 0)."""
    budget_fit = _clamp((1.25 * budget - cost) / (0.75 * budget)) if budget > 0 else 0.5
    deal = _clamp(1.5 - cost / seasonal_median) if seasonal_median > 0 else 0.5
    return 0.5 * budget_fit + 0.5 * deal


WEATHER_EDGE = 0.75  # score at the edge of the preferred range
WEATHER_PER_DEG = 0.08  # cost per °C outside the range (doubled by a heat/cold dislike)
RAIN_COST = 0.4  # every rainy day costs up to 40% (all days rainy -> x0.6)
SUN_FULL_H = 8.0  # >= 8 h of sun a day is "full"; no sun -> x0.85


def temperature_fit(
    temp_c: float, preferred: tuple[float, float], dislikes: Sequence[str]
) -> float:
    """Peaks (1.0) at the middle of the preferred range and falls smoothly to 0.75 at its edges,
    then keeps falling 0.08 per °C outside (0.16 with a matching heat/cold dislike). So 12 °C is
    not 'perfect' just because it sits inside a wide range, and each degree outside still costs."""
    lo, hi = sorted(preferred)
    mid, half = (lo + hi) / 2, max((hi - lo) / 2, 0.5)
    if lo <= temp_c <= hi:
        return 1.0 - (1.0 - WEATHER_EDGE) * ((temp_c - mid) / half) ** 2
    dist = lo - temp_c if temp_c < lo else temp_c - hi
    per_deg = WEATHER_PER_DEG
    if (temp_c > hi and "heat" in dislikes) or (temp_c < lo and "cold" in dislikes):
        per_deg *= 2
    return _clamp(WEATHER_EDGE - per_deg * dist)


def weather_score(
    temp_c: float,
    preferred: tuple[float, float],
    dislikes: Sequence[str],
    rainy_day_share: float | None = None,
    sunshine_h: float | None = None,
) -> float:
    """Temperature fit, scaled down by rain and lack of sunshine when those are known."""
    score = temperature_fit(temp_c, preferred, dislikes)
    if rainy_day_share is not None:
        score *= 1.0 - RAIN_COST * _clamp(rainy_day_share)
    if sunshine_h is not None:
        score *= 0.85 + 0.15 * _clamp(sunshine_h / SUN_FULL_H)
    return _clamp(score)


def crowd_score(crowd: float) -> float:
    return _clamp(1.0 - crowd)


def taste_score(tags: Sequence[str], interests: dict[str, float], dislikes: Sequence[str]) -> float:
    """Share of the user's interest mass this city satisfies, minus 0.25 per disliked tag present."""
    tagset = set(tags)
    mass = sum(max(0.0, w) for w in interests.values())
    base = (
        0.5 if mass <= 0 else sum(max(0.0, w) for t, w in interests.items() if t in tagset) / mass
    )
    return _clamp(base - 0.25 * len(tagset & set(dislikes)))


def score_candidate(c: Candidate, profile: TasteProfile, weights: Weights) -> ScoreBreakdown:
    w = normalise_weights(weights)
    parts = {
        "price": price_score(
            c.total_cost_pln, effective_budget(profile), c.seasonal_median_cost_pln
        ),
        "weather": weather_score(
            c.temp_c, profile.preferred_temp_c, profile.dislikes, c.rainy_day_share, c.sunshine_h
        ),
        "crowds": crowd_score(c.crowd),
        # personalize=False: interests act only as a filter (see rank), never as a ranking signal;
        # disliked tags still cost (dislikes are not interests)
        "taste": taste_score(c.tags, profile.interests, profile.dislikes)
        if profile.personalize
        else taste_score(c.tags, {}, profile.dislikes),
    }
    total = sum(getattr(w, f) * parts[f] for f in FACTORS)
    return ScoreBreakdown(**{f: round(v, 4) for f, v in parts.items()}, total=round(total, 4))


INTEREST_FILTER_MIN = 0.5


def interest_filter(
    candidates: Sequence[Candidate], profile: TasteProfile
) -> tuple[list[Candidate], InterestFilter | None]:
    """personalize=False (Travel DNA y2 = No): interests are kept only as a filter. Keep the cities
    matching at least one interest >= 0.5; if that would leave nothing, keep everything.
    Returns the kept candidates plus a receipt of what the filter did (None when it didn't run)."""
    if profile.personalize:
        return list(candidates), None
    liked = sorted(t for t, w in profile.interests.items() if w >= INTEREST_FILTER_MIN)
    matching = [c for c in candidates if set(liked) & set(c.tags)]
    kept = matching or list(candidates)  # nothing matches -> don't filter at all
    applied = len(kept) < len(candidates)
    dropped = sorted({c.city for c in candidates} - {c.city for c in kept})
    shown = ", ".join(liked)
    if not liked:
        text = "Personalisation is off and no interests are set, so nothing was filtered."
    elif applied:
        text = (
            f"Personalisation is off: showing only cities matching your interests ({shown}); "
            f"filtered out: {', '.join(dropped)}."
        )
    elif not matching:
        text = f"Personalisation is off: no city matches your interests ({shown}), so none were filtered."
    else:
        text = f"Personalisation is off: every city matches your interests ({shown})."
    return kept, InterestFilter(liked=liked, dropped_cities=dropped, applied=applied, text=text)


def candidate_id(c: Candidate) -> str:
    return f"{c.iata}-{c.window.start:%Y%m%d}-{c.window.end:%Y%m%d}"


def inputs_hash(candidates: Sequence[Candidate], profile: TasteProfile, weights: Weights) -> str:
    """sha256 over canonical JSON of everything the ranking depends on (incl. scoring version)."""
    payload = {
        "scoring_version": SCORING_VERSION,
        "profile": profile.model_dump(mode="json"),
        "weights": normalise_weights(weights).model_dump(mode="json"),
        "candidates": sorted(
            (c.model_dump(mode="json") for c in candidates),
            key=lambda d: (d["iata"], d["window"]["start"], d["window"]["end"]),
        ),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def fmt_window(c: Candidate) -> str:
    s, e = c.window.start, c.window.end
    if s.month == e.month:
        return f"{s.day}-{e.day} {MONTHS[s.month - 1]}"
    return f"{s.day} {MONTHS[s.month - 1]}-{e.day} {MONTHS[e.month - 1]}"


def _months(w) -> set[int]:
    """Calendar months a window touches (the peak counterfactual is meaningless inside them)."""
    out, d = set(), w.start
    while d <= w.end:
        out.add(d.month)
        d = d.replace(day=1) + timedelta(days=32)
        d = d.replace(day=1)
    return out


def _peak_candidate(c: Candidate) -> Candidate | None:
    if c.peak is None:
        return None
    return c.model_copy(
        update={
            "flight_cost_pln": c.peak.flight_cost_pln,
            "hotel_cost_pln": c.peak.hotel_cost_pln,
            "temp_c": c.peak.temp_c,
            "crowd": c.peak.crowd,
            "rainy_day_share": c.peak.rainy_day_share,
            "sunshine_h": c.peak.sunshine_h,
        }
    )


def _counterfactual(
    kind, label: str, this: Candidate, this_score: float, other: Candidate, other_score: float
) -> Counterfactual:
    cost_delta = round(other.total_cost_pln - this.total_cost_pln)
    pct = round(100 * cost_delta / other.total_cost_pln) if other.total_cost_pln else 0
    score_delta = round(this_score - other_score, 4)
    if cost_delta >= 0:
        cost_txt = f"{cost_delta} PLN ({pct}%) cheaper"
    else:
        cost_txt = f"{-cost_delta} PLN ({-pct}%) more expensive"
    pts = round(100 * score_delta)
    text = f"{cost_txt} than {label}; score {'+' if pts >= 0 else ''}{pts} pts"
    return Counterfactual(
        kind=kind,
        label=label,
        city=other.city,
        window=other.window if kind != "peak_season" else None,
        total_cost_pln=round(other.total_cost_pln),
        cost_delta_pln=cost_delta,
        cost_delta_pct=pct,
        score_total=other_score,
        score_delta=score_delta,
        crowd=other.crowd,
        temp_c=other.temp_c,
        text=text,
    )


def with_weight(weights: Weights, factor: str, value: float) -> Weights:
    """Set one normalised weight to `value`, rescaling the others proportionally (slider semantics)."""
    w = normalise_weights(weights)
    old = getattr(w, factor)
    rest = 1 - old
    scaled = {
        f: (value if f == factor else (getattr(w, f) * (1 - value) / rest if rest > 0 else 0.0))
        for f in FACTORS
    }
    return Weights(**scaled)


def with_extra_cost(c: Candidate, extra_pln: float) -> Candidate:
    return c.model_copy(update={"flight_cost_pln": c.flight_cost_pln + extra_pln})


def _overtakes(lo_c: Candidate, hi_c: Candidate, profile: TasteProfile, weights: Weights) -> bool:
    """Strictly higher total (as displayed, 4 dp), so the swap never relies on a tie-break."""
    lo = score_candidate(lo_c, profile, weights).total
    return lo > score_candidate(hi_c, profile, weights).total


def _flip(
    this: Candidate,
    this_sb: ScoreBreakdown,
    rival: Candidate,
    rival_sb: ScoreBreakdown,
    profile: TasteProfile,
    weights: Weights,
    rival_above: bool,
) -> FlipHint:
    """Smallest single-weight change that swaps the pair; plus the price change that would do it.

    rival_above=False: `this` is ranked above `rival` (what would make the rival overtake).
    rival_above=True: `rival` is above `this` (what would lift `this` over it).
    Every suggestion is verified by re-scoring with the exact displayed value, so applying it
    really flips the pair (rounded away from the current value, past the crossing point).
    """
    hi, lo = (rival_sb, this_sb) if rival_above else (this_sb, rival_sb)
    hi_c, lo_c = (rival, this) if rival_above else (this, rival)
    w = normalise_weights(weights)
    gap = sum(getattr(w, f) * (getattr(hi, f) - getattr(lo, f)) for f in FACTORS)

    best: tuple[float, str, float] | None = None  # (change, factor, new weight)
    for f in FACTORS:
        d = getattr(hi, f) - getattr(lo, f)
        if d >= 0:
            continue  # raising this weight only widens the gap
        # Raise raw weight f by x (others fixed): gap + x*d = 0 -> x = gap / -d.
        x = gap / -d
        crossing = (getattr(w, f) + x) / (1 + x)
        t = math.ceil(crossing * 100 + 1e-9) / 100
        while t <= 1.0 and not _overtakes(lo_c, hi_c, profile, with_weight(w, f, t)):
            t = round(t + 0.01, 2)
        if t <= 1.0 and t > getattr(w, f) and (best is None or t - getattr(w, f) < best[0]):
            best = (t - getattr(w, f), f, t)

    # Price route: how much pricier would the higher-ranked trip have to be to drop below the other.
    price_inc = None
    if w.price > 0:
        budget = effective_budget(profile)
        target = hi.price - (gap / w.price)
        base_cost = hi_c.total_cost_pln
        if price_score(base_cost * 10, budget, hi_c.seasonal_median_cost_pln) < target:
            lo_cost, hi_cost = base_cost, base_cost * 10
            for _ in range(60):
                mid = (lo_cost + hi_cost) / 2
                if price_score(mid, budget, hi_c.seasonal_median_cost_pln) > target:
                    lo_cost = mid
                else:
                    hi_cost = mid
            inc = math.ceil(hi_cost - base_cost) + 1
            for _ in range(100):
                if _overtakes(lo_c, with_extra_cost(hi_c, inc), profile, w):
                    price_inc = float(inc)
                    break
                inc += max(1, math.ceil(base_cost * 0.005))

    lo_name = f"{lo_c.city} ({fmt_window(lo_c)})"
    hi_name = f"{hi_c.city} ({fmt_window(hi_c)})"
    parts = []
    factor = weight_from = weight_to = None
    if best is not None:
        _, factor, weight_to = best
        weight_from = getattr(w, factor)
        parts.append(f"{factor} weight {weight_from:.2f} -> {weight_to:.2f}")
    if price_inc is not None:
        parts.append(f"{hi_c.city} costing {price_inc:.0f} PLN more")
    if parts:
        text = f"{lo_name} would overtake {hi_name} with: " + " or ".join(parts)
    else:
        text = f"No single weight or price change makes {lo_name} overtake {hi_name}"
    return FlipHint(
        rival_id=candidate_id(rival),
        rival_city=rival.city,
        factor=factor,
        weight_from=weight_from,
        weight_to=weight_to,
        price_increase_pln=price_inc,
        text=text,
    )


def rank(
    candidates: Sequence[Candidate],
    profile: TasteProfile,
    weights: Weights | None = None,
    *,
    limit: int = 10,
    one_per_city: bool = True,
) -> list[RankedRecommendation]:
    """Score every candidate, keep the best window per city, attach the receipt."""
    weights = normalise_weights(weights)
    candidates = list({candidate_id(c): c for c in reversed(candidates)}.values())  # first wins
    # hash the inputs *before* filtering: the filter is a deterministic function of them
    digest = inputs_hash(candidates, profile, weights)
    candidates, filter_receipt = interest_filter(candidates, profile)
    scored = [(c, score_candidate(c, profile, weights)) for c in candidates]
    scored.sort(key=lambda cs: (-cs[1].total, cs[0].total_cost_pln, cs[0].iata, cs[0].window.start))

    picked: list[tuple[Candidate, ScoreBreakdown]] = []
    seen: set[str] = set()
    for c, sb in scored:
        if one_per_city and c.iata in seen:
            continue
        seen.add(c.iata)
        picked.append((c, sb))
    picked = picked[:limit]

    out: list[RankedRecommendation] = []
    for i, (c, sb) in enumerate(picked):
        cfs: list[Counterfactual] = []
        peak = _peak_candidate(c)
        if peak is not None and c.peak.month not in _months(c.window):
            peak_sb = score_candidate(peak, profile, weights)
            label = f"same trip in {MONTHS[c.peak.month - 1]} (peak season)"
            cfs.append(_counterfactual("peak_season", label, c, sb.total, peak, peak_sb.total))
        alt = next(
            (
                (o, osb)
                for o, osb in scored
                if o.iata == c.iata and candidate_id(o) != candidate_id(c)
            ),
            None,
        )
        if alt is not None:
            label = f"next-best window {fmt_window(alt[0])}"
            cfs.append(_counterfactual("next_window", label, c, sb.total, alt[0], alt[1].total))
        flip = None
        if i + 1 < len(picked):
            nxt = picked[i + 1]
            label = f"runner-up {nxt[0].city} {fmt_window(nxt[0])}"
            cfs.append(_counterfactual("runner_up", label, c, sb.total, nxt[0], nxt[1].total))
        if i == 0 and len(picked) > 1:
            flip = _flip(c, sb, picked[1][0], picked[1][1], profile, weights, rival_above=False)
        elif i > 0:
            prev = picked[i - 1]
            flip = _flip(c, sb, prev[0], prev[1], profile, weights, rival_above=True)

        out.append(
            RankedRecommendation(
                id=candidate_id(c),
                rank=i + 1,
                city=c.city,
                country=c.country,
                iata=c.iata,
                window=c.window,
                total_cost_pln=round(c.total_cost_pln),
                flight_cost_pln=round(c.flight_cost_pln),
                hotel_cost_pln=round(c.hotel_cost_pln),
                score=sb,
                evidence=c.evidence,
                highlights=c.highlights,
                counterfactuals=cfs,
                flip=flip,
                inputs_hash=digest,
                interest_filter=filter_receipt,
                scoring_version=SCORING_VERSION,
                tags=c.tags,
                temp_c=c.temp_c,
                crowd=c.crowd,
            )
        )
    return out
