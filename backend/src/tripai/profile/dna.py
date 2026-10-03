"""Travel DNA (docs/TRAVEL_DNA.md): swipe answers -> TasteProfile + Weights + reasons.

Pure and deterministic: no I/O, no LLM. Every derived value lists the card ids it came from
(`because`) so the UI can say "because you swiped *So me* on ...".
"""

from pydantic import BaseModel, Field, field_validator

from tripai.models import LuxuryLevel, TasteProfile, Weights
from tripai.scoring.engine import normalise_weights

STATEMENTS = [f"q{i}" for i in range(1, 13)]
YES_NO = ["y1", "y2"]
MISSING = 3  # missing statement answer counts as "Zależy / Depends"

CARDS_EN = {
    "q1": "I love discovering places I don't know yet.",
    "q2": "I prefer every travel day to be planned.",
    "q3": "I like changing plans spontaneously.",
    "q4": "Experiences matter more to me than comfort.",
    "q5": "I'm keen on local food and culture.",
    "q6": "Above all I look for rest and relaxation.",
    "q7": "I like being active (hiking, cycling, water).",
    "q8": "I often pick less touristy places.",
    "q9": "Price strongly drives where I go and what I do.",
    "q10": "I'll pay more for a unique experience.",
    "q11": "I like travelling away from crowds.",
    "q12": "I happily return to places I know.",
    "y1": "Do you want to discover new places every day?",
    "y2": "Should the app tailor recommendations to your style?",
}
GESTURE = {1: "Not me", 2: "Rather not", 3: "Depends", 4: "That's me", 5: "So me"}
PACE_THRESHOLD = 0.25


class DnaRequest(BaseModel):
    user_id: str = "demo"
    answers: dict[str, int] = Field(default_factory=dict)  # q1..q12 -> 1..5
    yes_no: dict[str, bool] = Field(default_factory=dict)  # y1, y2

    @field_validator("answers")
    @classmethod
    def _check_answers(cls, v: dict[str, int]) -> dict[str, int]:
        for k, a in v.items():
            if k not in STATEMENTS:
                raise ValueError(f"unknown card {k!r}; expected q1..q12")
            if not 1 <= a <= 5:
                raise ValueError(f"{k}: answer must be 1..5, got {a}")
        return v

    @field_validator("yes_no")
    @classmethod
    def _check_yes_no(cls, v: dict[str, bool]) -> dict[str, bool]:
        for k in v:
            if k not in YES_NO:
                raise ValueError(f"unknown card {k!r}; expected y1 or y2")
        return v


class Reason(BaseModel):
    field: str  # "weights.crowds" | "interests.food" | "luxury" | "traits.pace" | ...
    value: float | str | bool | list[str] | None
    because: list[str]  # card ids
    text: str


class DnaResult(BaseModel):
    profile: TasteProfile
    weights: Weights
    reasons: list[Reason]


def n(a: float) -> float:
    """1..5 -> 0..1."""
    return (a - 1) / 4


def _avg(*xs: float) -> float:
    return sum(xs) / len(xs)


def _r(x: float) -> float:
    return round(x, 4)


def raw_weights(a: dict[str, int]) -> Weights:
    """Spec formulas, before normalisation."""
    return Weights(
        price=0.25 + 0.35 * n(a["q9"]) - 0.15 * n(a["q10"]),
        crowds=0.10 + 0.20 * _avg(n(a["q8"]), n(a["q11"])),
        taste=0.20 + 0.15 * n(a["q4"]) + 0.10 * n(a["q10"]),
        weather=0.20 + 0.05 * n(a["q6"]),
    )


def interests(a: dict[str, int]) -> dict[str, tuple[float, list[str]]]:
    """tag -> (value 0..1, cards it came from)."""
    discovery = _avg(n(a["q1"]), 1 - n(a["q12"]))
    return {
        "food": (n(a["q5"]), ["q5"]),
        "culture": (n(a["q5"]), ["q5"]),
        "history": (0.8 * n(a["q5"]), ["q5"]),
        "beach": (n(a["q6"]), ["q6"]),
        "wellness": (n(a["q6"]), ["q6"]),
        "hiking": (n(a["q7"]), ["q7"]),
        "nature": (max(n(a["q7"]), 0.6 * n(a["q6"])), ["q7", "q6"]),
        "offbeat": (_avg(n(a["q8"]), n(a["q11"])), ["q8", "q11"]),
        "discovery": (discovery, ["q1", "q12"]),
    }


def luxury(a: dict[str, int]) -> tuple[LuxuryLevel, list[str]]:
    if a["q9"] >= 4 and a["q10"] <= 2:
        return LuxuryLevel.budget, ["q9", "q10"]
    if a["q10"] >= 4 and a["q4"] <= 2:
        return LuxuryLevel.luxury, ["q10", "q4"]
    if a["q4"] <= 2:
        return LuxuryLevel.comfort, ["q4"]
    return LuxuryLevel.standard, ["q9", "q10", "q4"]


def pace(a: dict[str, int]) -> tuple[float, str]:
    p = n(a["q2"]) - n(a["q3"])
    label = (
        "structured" if p > PACE_THRESHOLD else "spontaneous" if p < -PACE_THRESHOLD else "balanced"
    )
    return p, label


def _swiped(cards: list[str], a: dict[str, int], given: set[str]) -> str:
    parts = []
    for c in cards:
        if c in given:
            parts.append(f"{GESTURE[a[c]]} on {c}")
        else:
            parts.append(f"no answer on {c} (counted as Depends)")
    return "; ".join(parts)


def map_dna(req: DnaRequest) -> DnaResult:
    given = set(req.answers)
    a = {q: req.answers.get(q, MISSING) for q in STATEMENTS}
    personalize = req.yes_no.get("y2", True)
    daily = req.yes_no.get("y1")
    reasons: list[Reason] = []

    if personalize:
        weights = normalise_weights(raw_weights(a))
        sources = {
            "price": ["q9", "q10"],
            "crowds": ["q8", "q11"],
            "taste": ["q4", "q10"],
            "weather": ["q6"],
        }
        for f, cards in sources.items():
            v = getattr(weights, f)
            reasons.append(Reason(field=f"weights.{f}", value=v, because=cards,
                                  text=f"{f} weight {v:.2f} because you swiped "
                                  f"{_swiped(cards, a, given)}"))  # fmt: skip
    else:
        weights = normalise_weights(Weights())
        for f in ("price", "weather", "crowds", "taste"):
            v = getattr(weights, f)
            reasons.append(Reason(field=f"weights.{f}", value=v, because=["y2"],
                                  text=f"{f} weight {v:.2f}: neutral default, because you chose "
                                  "not to tailor recommendations to your style"))  # fmt: skip

    tags: dict[str, float] = {}
    for tag, (v, cards) in interests(a).items():
        tags[tag] = _r(v)
        role = "" if personalize else " (used only as a filter, not for ranking)"
        reasons.append(Reason(field=f"interests.{tag}", value=tags[tag], because=cards,
                              text=f"{tag} {tags[tag]:.2f}{role} because you swiped "
                              f"{_swiped(cards, a, given)}"))  # fmt: skip

    dislikes: list[str] = []
    crowd_cards = [c for c in ("q8", "q11") if a[c] >= 4]
    if crowd_cards:
        dislikes.append("crowds")
        reasons.append(Reason(field="dislikes", value=["crowds"], because=crowd_cards,
                              text=f"avoiding crowds because you swiped "
                              f"{_swiped(crowd_cards, a, given)}"))  # fmt: skip

    lux, lux_cards = luxury(a)
    reasons.append(Reason(field="luxury", value=lux.value, because=lux_cards,
                          text=f"{lux.value} comfort level because you swiped "
                          f"{_swiped(lux_cards, a, given)}"))  # fmt: skip

    p, p_label = pace(a)
    novelty = tags["discovery"]
    reasons.append(Reason(field="traits.pace", value=_r(p), because=["q2", "q3"],
                          text=f"{p_label} pace because you swiped "
                          f"{_swiped(['q2', 'q3'], a, given)}"))  # fmt: skip
    reasons.append(Reason(field="traits.novelty", value=novelty, because=["q1", "q12"],
                          text=f"novelty {novelty:.2f} because you swiped "
                          f"{_swiped(['q1', 'q12'], a, given)}"))  # fmt: skip
    if daily is not None:
        what = "a new attraction every day" if daily else "no need for something new every day"
        answer = "Yes" if daily else "No"
        reasons.append(
            Reason(
                field="daily_discovery",
                value=daily,
                because=["y1"],
                text=f"{what} because you answered {answer} on y1",
            )
        )
    if personalize:
        text = "recommendations tailored to your style; post-trip feedback updates your profile"
    else:
        text = (
            "neutral ranking; post-trip feedback will not change your profile (your choice on y2)"
        )
    reasons.append(
        Reason(
            field="personalize",
            value=personalize,
            because=["y2"] if "y2" in req.yes_no else [],
            text=text,
        )
    )

    traits = {q: float(a[q]) for q in STATEMENTS} | {"pace": _r(p), "novelty": novelty}
    profile = TasteProfile(
        user_id=req.user_id,
        luxury=lux,
        interests=tags,
        dislikes=dislikes,
        traits=traits,
        daily_discovery=daily,
        personalize=personalize,
    )
    return DnaResult(profile=profile, weights=weights, reasons=reasons)
