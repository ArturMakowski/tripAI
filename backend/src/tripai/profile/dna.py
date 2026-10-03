"""Travel DNA (docs/TRAVEL_DNA.md): swipe answers -> TasteProfile + Weights + reasons.

Pure and deterministic: no I/O, no LLM. Every derived value lists the card ids it came from
(`because`) so the UI can say "because you swiped *So me* on ...".
"""

from pydantic import BaseModel, Field, StrictBool, StrictInt, field_validator

from tripai import i18n
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
PACE_THRESHOLD = 0.25


class DnaRequest(BaseModel):
    user_id: str = "demo"
    answers: dict[str, StrictInt] = Field(default_factory=dict)  # q1..q12 -> 1..5
    yes_no: dict[str, StrictBool] = Field(default_factory=dict)  # y1, y2
    lang: str | None = None  # "pl" | "en" for the reason texts (else Accept-Language, else en)

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
            parts.append(i18n.t("dna.swiped", gesture=i18n.t(f"dna.gesture.{a[c]}"), card=c))
        else:
            parts.append(i18n.t("dna.no_answer", card=c))
    return "; ".join(parts)


def _v(x: float) -> str:
    """0.21 / 0,21 (2 dp, decimal comma in Polish)."""
    s = f"{x:.2f}"
    return s.replace(".", ",") if i18n.current() == "pl" else s


DNA_OWNED_DISLIKES = {"crowds"}


def map_dna(
    req: DnaRequest, base: TasteProfile | None = None, lang: str | None = None
) -> DnaResult:
    """Map answers to a profile. With `base` (the stored profile), only DNA-owned fields change:
    budget, airports, temperature range, trip length and non-DNA interests/dislikes are kept.
    Reason texts are in `lang` (else `req.lang`, else the request's language)."""
    with i18n.using(i18n.pick(lang or req.lang)):
        return _map_dna(req, base)


def _map_dna(req: DnaRequest, base: TasteProfile | None) -> DnaResult:
    given = set(req.answers)
    a = {q: req.answers.get(q, MISSING) for q in STATEMENTS}
    personalize = req.yes_no.get("y2", True)
    daily = req.yes_no.get("y1")
    reasons: list[Reason] = []

    def add(field: str, value, because: list[str], key: str, **kw) -> None:
        reasons.append(Reason(field=field, value=value, because=because, text=i18n.t(key, **kw)))

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
            add(f"weights.{f}", v, cards, "dna.weight", factor=i18n.t(f"factor.{f}"), v=_v(v),
                sw=_swiped(cards, a, given))  # fmt: skip
    else:
        weights = normalise_weights(Weights())
        for f in ("price", "weather", "crowds", "taste"):
            v = getattr(weights, f)
            add(f"weights.{f}", v, ["y2"], "dna.weight_neutral", factor=i18n.t(f"factor.{f}"),
                v=_v(v))  # fmt: skip

    tags: dict[str, float] = {}
    role = "" if personalize else i18n.t("dna.filter_role")
    for tag, (v, cards) in interests(a).items():
        tags[tag] = _r(v)
        add(f"interests.{tag}", tags[tag], cards, "dna.interest", tag=i18n.tag(tag),
            v=_v(tags[tag]), role=role, sw=_swiped(cards, a, given))  # fmt: skip

    dislikes: list[str] = []
    crowd_cards = [c for c in ("q8", "q11") if a[c] >= 4]
    if crowd_cards:
        dislikes.append("crowds")
        add("dislikes", ["crowds"], crowd_cards, "dna.crowds", sw=_swiped(crowd_cards, a, given))

    lux, lux_cards = luxury(a)
    add("luxury", lux.value, lux_cards, "dna.luxury", level=i18n.t(f"lux.{lux.value}"),
        sw=_swiped(lux_cards, a, given))  # fmt: skip

    p, p_label = pace(a)
    novelty = tags["discovery"]
    add("traits.pace", _r(p), ["q2", "q3"], "dna.pace", label=i18n.t(f"dna.pace.{p_label}"),
        sw=_swiped(["q2", "q3"], a, given))  # fmt: skip
    add("traits.novelty", novelty, ["q1", "q12"], "dna.novelty", v=_v(novelty),
        sw=_swiped(["q1", "q12"], a, given))  # fmt: skip
    if daily is not None:
        add("daily_discovery", daily, ["y1"], "dna.daily_yes" if daily else "dna.daily_no")
    add("personalize", personalize, ["y2"] if "y2" in req.yes_no else [],
        "dna.personalize_on" if personalize else "dna.personalize_off")  # fmt: skip

    traits = {q: float(a[q]) for q in STATEMENTS} | {"pace": _r(p), "novelty": novelty}
    base = base or TasteProfile(user_id=req.user_id)
    kept_dislikes = [d for d in base.dislikes if d not in DNA_OWNED_DISLIKES]
    profile = base.model_copy(
        update={
            "user_id": req.user_id,
            "luxury": lux,
            "interests": base.interests | tags,  # DNA tags overwrite, learned extras stay
            "dislikes": kept_dislikes + [d for d in dislikes if d not in kept_dislikes],
            "traits": base.traits | traits,
            "daily_discovery": daily if daily is not None else base.daily_discovery,
            "personalize": personalize,
        }
    )
    return DnaResult(profile=profile, weights=weights, reasons=reasons)
