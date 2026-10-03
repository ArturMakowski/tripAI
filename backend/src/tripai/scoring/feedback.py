"""Post-trip survey -> visible, deterministic profile/weight updates (the learning loop)."""

from collections.abc import Sequence

from pydantic import BaseModel

from tripai.models import TasteProfile, Weights
from tripai.scoring.engine import FACTORS, normalise_weights

WEIGHT_STEP = 0.1  # per point below 3/5
INTEREST_RATE = 0.5  # how far a tag interest moves toward the new rating
FACTOR_ALIASES = {"crowd": "crowds", "cost": "price", "prices": "price", "fit": "taste"}


class Change(BaseModel):
    field: str  # e.g. "weights.crowds", "interests.food", "dislikes"
    before: float | str | list[str] | None
    after: float | str | list[str] | None
    reason: str


class FeedbackResult(BaseModel):
    profile: TasteProfile
    weights: Weights
    diff: list[Change]
    note: str | None = None


def _rating(v) -> float | None:
    try:
        r = float(v)
    except (TypeError, ValueError):
        return None
    return r if 1 <= r <= 5 else None


def apply_feedback(
    profile: TasteProfile,
    weights: Weights,
    answers: dict,
    trip_tags: Sequence[str] = (),
    trip_temp_c: float | None = None,
    trip_label: str = "this trip",
) -> FeedbackResult:
    """Survey answers (1-5 satisfaction per factor or tag, plus optional `loved`/`disliked` tag lists).

    - factor rated <=2  -> its weight goes up by 0.1 per point below 3 (you got burned, so it matters)
    - factor rated 1    -> also recorded as a dislike for crowds/heat
    - tag rated r       -> interest moves halfway toward r/5
    - weather rated <=2 with a temperature inside your range -> range narrows away from it
    """
    if not profile.personalize:
        return FeedbackResult(
            profile=profile,
            weights=normalise_weights(weights),
            diff=[],
            note="Personalisation is off (your choice in Travel DNA), so feedback does not "
            "change your profile or weights.",
        )
    before_w = normalise_weights(weights)
    raw = {f: getattr(before_w, f) for f in FACTORS}
    interests = dict(profile.interests)
    dislikes = list(profile.dislikes)
    lo, hi = profile.preferred_temp_c
    diff: list[Change] = []
    reasons: dict[str, str] = {}

    for key, val in answers.items():
        k = FACTOR_ALIASES.get(key.lower(), key.lower())
        if k in ("loved", "liked") and isinstance(val, list):
            for t in val:
                old = interests.get(t)
                new = round(min(1.0, (old or 0.5) + 0.2), 2)
                if new != old:
                    interests[t] = new
                    diff.append(Change(field=f"interests.{t}", before=old, after=new,
                                       reason=f"you loved {t} on {trip_label}"))  # fmt: skip
            continue
        if k == "disliked" and isinstance(val, list):
            for t in val:
                if t not in dislikes:
                    diff.append(Change(field="dislikes", before=list(dislikes),
                                       after=[*dislikes, t], reason=f"you disliked {t}"))  # fmt: skip
                    dislikes.append(t)
            continue
        r = _rating(val)
        if r is None or k == "overall":
            continue
        if k in FACTORS:
            if r <= 2:
                raw[k] += WEIGHT_STEP * (3 - r)
                reasons[k] = f"{k} rated {r:g}/5 on {trip_label}"
            if r == 1 and k == "crowds" and "crowds" not in dislikes:
                diff.append(Change(field="dislikes", before=list(dislikes),
                                   after=[*dislikes, "crowds"], reason="crowds rated 1/5"))  # fmt: skip
                dislikes.append("crowds")
            if k == "weather" and r <= 2 and trip_temp_c is not None and lo <= trip_temp_c <= hi:
                old_range = [lo, hi]
                if trip_temp_c - lo > hi - trip_temp_c:
                    hi = max(lo + 3, trip_temp_c - 1)
                else:
                    lo = min(hi - 3, trip_temp_c + 1)
                diff.append(Change(field="preferred_temp_c", before=str(old_range),
                                   after=str([lo, hi]),
                                   reason=f"weather rated {r:g}/5 at {trip_temp_c:g} °C"))  # fmt: skip
        elif k in trip_tags or k in interests:
            old = interests.get(k)
            base = 0.5 if old is None else old
            new = round(base + INTEREST_RATE * (r / 5 - base), 2)
            if new != old:
                interests[k] = new
                diff.append(Change(field=f"interests.{k}", before=old, after=new,
                                   reason=f"{k} rated {r:g}/5 on {trip_label}"))  # fmt: skip

    after_w = normalise_weights(Weights(**raw))
    weight_changes = [
        Change(
            field=f"weights.{f}",
            before=getattr(before_w, f),
            after=getattr(after_w, f),
            reason=reasons.get(f, "re-normalised after another weight changed"),
        )
        for f in FACTORS
        if abs(getattr(after_w, f) - getattr(before_w, f)) >= 0.005
    ]
    weight_changes.sort(key=lambda c: c.field.split(".")[1] not in reasons)  # causes first
    diff = weight_changes + diff

    new_profile = profile.model_copy(
        update={"interests": interests, "dislikes": dislikes, "preferred_temp_c": (lo, hi)}
    )
    return FeedbackResult(profile=new_profile, weights=after_w, diff=diff)
