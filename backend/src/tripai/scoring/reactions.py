"""Swipe reactions on offers (T6) -> small, deterministic, explainable profile nudges.

A swipe is a much weaker signal than a post-trip survey, so every step is small and clamped:

- like     ("Chcę tam")   -> +0.05 on each of the city's tags (a new tag starts from neutral 0.5)
- love     ("Super!")     -> +0.10 on each tag, and +0.03 on the weight of the card's strongest
                             price/weather/crowds factor if it scored >= 0.8 ("you loved it for that")
- dislike  ("Nie dla mnie") -> -0.05 on the city's tags you *already* have an interest in, +0.03 on
                             the weight of its weakest price/weather/crowds factor if it scored < 0.4,
                             and that city+dates is hidden from your future lists.

A dislike never creates an interest: a new tag at 0.45 would add interest mass this city matches and
so *raise* its taste score (`engine.taste_score` is the matched share of your interest mass).
With `personalize=False` the reaction is recorded (and a dislike still hides the trip, which is a
list filter, not learning) but the profile and weights stay exactly as they are.
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from tripai.models import TasteProfile, Weights
from tripai.scoring.engine import FACTORS, normalise_weights
from tripai.scoring.feedback import Change
from tripai.scoring.types import RankedRecommendation

Reaction = Literal["like", "dislike", "love"]

TAG_STEP: dict[str, float] = {"like": 0.05, "love": 0.10, "dislike": -0.05}
WEIGHT_STEP = 0.03
LOVE_FACTOR_MIN = 0.8  # a loved card's factor this good is probably why you loved it
DISLIKE_FACTOR_MAX = 0.4  # a disliked card's factor this bad is probably why you passed
WEIGHT_FACTORS = ("price", "weather", "crowds")  # taste is already covered by the tag nudges
VERB = {"like": "you swiped 'Chcę tam' on", "love": "you swiped 'Super!' on",
        "dislike": "you swiped 'Nie dla mnie' on"}  # fmt: skip


class ReactionRecord(BaseModel):
    """One stored swipe (table `reactions`, supabase/migrations/0005_reactions.sql)."""

    user_id: str
    recommendation_id: str
    reaction: Reaction
    city: str
    iata: str
    start: str  # ISO date
    end: str
    diff: list[Change] = Field(default_factory=list)
    # undo snapshot: interests before (None = tag was absent) and normalised weights before/after
    interests_before: dict[str, float | None] = Field(default_factory=dict)
    weights_before: Weights | None = None
    weights_after: Weights | None = None
    personalized: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def hidden(self) -> bool:
        return self.reaction == "dislike"


class ReactionResult(BaseModel):
    profile: TasteProfile
    weights: Weights
    diff: list[Change]
    note: str | None = None
    record: ReactionRecord


def _round(x: float) -> float:
    return round(min(1.0, max(0.0, x)), 2)


def _weight_diff(before: Weights, after: Weights, cause: str | None, reason: str) -> list[Change]:
    out = [
        Change(
            field=f"weights.{f}",
            before=getattr(before, f),
            after=getattr(after, f),
            reason=reason if f == cause else "re-normalised after another weight changed",
        )
        for f in FACTORS
        if abs(getattr(after, f) - getattr(before, f)) >= 0.005
    ]
    out.sort(key=lambda c: c.field != f"weights.{cause}")  # the cause first
    return out


def apply_reaction(
    profile: TasteProfile, weights: Weights, rec: RankedRecommendation, reaction: Reaction
) -> ReactionResult:
    record = ReactionRecord(
        user_id=profile.user_id,
        recommendation_id=rec.id,
        reaction=reaction,
        city=rec.city,
        iata=rec.iata,
        start=rec.window.start.isoformat(),
        end=rec.window.end.isoformat(),
        personalized=profile.personalize,
    )
    before_w = normalise_weights(weights)
    if not profile.personalize:
        note = (
            "Personalisation is off (your choice in Travel DNA), so this reaction is saved but "
            "does not change your profile or weights."
        )
        if reaction == "dislike":
            note += f" {rec.city} on these dates is hidden from your list."
        return ReactionResult(profile=profile, weights=before_w, diff=[], note=note, record=record)

    label = f"{rec.city} ({rec.window.start:%d.%m}-{rec.window.end:%d.%m})"
    step = TAG_STEP[reaction]
    interests = dict(profile.interests)
    diff: list[Change] = []
    before_interests: dict[str, float | None] = {}
    for tag in dict.fromkeys(rec.tags):  # unique, in card order
        old = interests.get(tag)
        if old is None and reaction == "dislike":
            continue  # never invent an interest from a dislike (see module docstring)
        new = _round((0.5 if old is None else old) + step)
        if new == old:
            continue  # already at the clamp
        before_interests[tag] = old
        interests[tag] = new
        diff.append(Change(field=f"interests.{tag}", before=old, after=new,
                           reason=f"{VERB[reaction]} {label}, which offers {tag}"))  # fmt: skip

    cause, reason = None, ""
    scores = {f: getattr(rec.score, f) for f in WEIGHT_FACTORS}
    if reaction == "love":
        f = max(WEIGHT_FACTORS, key=lambda k: (scores[k], -WEIGHT_FACTORS.index(k)))
        if scores[f] >= LOVE_FACTOR_MIN:
            cause = f
            reason = f"{VERB[reaction]} {label}; its {f} score was {scores[f]:.2f}"
    elif reaction == "dislike":
        f = min(WEIGHT_FACTORS, key=lambda k: (scores[k], WEIGHT_FACTORS.index(k)))
        if scores[f] < DISLIKE_FACTOR_MAX:
            cause = f
            reason = f"{VERB[reaction]} {label}; its {f} score was only {scores[f]:.2f}"
    after_w = before_w
    if cause:
        raw = before_w.model_dump()
        raw[cause] += WEIGHT_STEP
        after_w = normalise_weights(Weights(**raw))
    diff = _weight_diff(before_w, after_w, cause, reason) + diff

    record.diff = diff
    record.interests_before = before_interests
    record.weights_before, record.weights_after = before_w, after_w
    note = f"{rec.city} on these dates is hidden from your list." if reaction == "dislike" else None
    if not diff:
        nothing = "Nothing new to learn: your profile already says this."
        note = f"{note} {nothing}" if note else nothing
    return ReactionResult(
        profile=profile.model_copy(update={"interests": interests}),
        weights=after_w,
        diff=diff,
        note=note,
        record=record,
    )


def _same_weights(a: Weights, b: Weights) -> bool:
    x, y = normalise_weights(a), normalise_weights(b)
    return all(abs(getattr(x, f) - getattr(y, f)) < 0.005 for f in FACTORS)


def undo_reaction(
    profile: TasteProfile, weights: Weights, record: ReactionRecord
) -> tuple[TasteProfile, Weights, list[Change], str | None]:
    """Revert what `record` changed, field by field, unless something changed that field since."""
    interests = dict(profile.interests)
    diff: list[Change] = []
    kept: list[str] = []
    label = f"undo: {record.city}"
    for tag, old in record.interests_before.items():
        after = next((c.after for c in record.diff if c.field == f"interests.{tag}"), None)
        cur = interests.get(tag)
        if cur != after:
            kept.append(tag)
            continue
        if old is None:
            interests.pop(tag, None)
        else:
            interests[tag] = old
        diff.append(Change(field=f"interests.{tag}", before=cur, after=old, reason=label))
    w = normalise_weights(weights)
    if (
        record.weights_before
        and record.weights_after
        and not _same_weights(record.weights_before, record.weights_after)
    ):
        if _same_weights(w, record.weights_after):
            diff = _weight_diff(w, record.weights_before, None, label) + diff
            for c in diff:
                if c.field.startswith("weights."):
                    c.reason = label
            w = normalise_weights(record.weights_before)
        else:
            kept.append("weights")
    note = None
    if kept:
        note = f"Kept {', '.join(kept)}: changed again since this swipe."
    return profile.model_copy(update={"interests": interests}), w, diff, note
