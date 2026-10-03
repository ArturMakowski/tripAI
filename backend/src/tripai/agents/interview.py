"""Interview agent: short conversation -> structured TasteProfile."""

import logging
import re
from typing import Literal

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models import Model

from tripai import i18n
from tripai.agents.jev import screen
from tripai.agents.llm import llm_enabled, model_name
from tripai.models import LuxuryLevel, TasteProfile

log = logging.getLogger(__name__)

TAG_VOCABULARY = [
    "food", "history", "art", "museums", "architecture", "city", "beach", "sun", "nightlife",
    "nature", "hiking", "diving", "surf", "viewpoints", "design", "cycling", "romance",
    "festivals", "whisky", "pizza",
]  # fmt: skip
DISLIKE_VOCABULARY = ["crowds", "heat", "cold", "nightlife", "long flights"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ProfileDraft(BaseModel):
    """What the LLM fills in. Mapped to the shared TasteProfile by `to_profile`."""

    origin_airports: list[str] = Field(default_factory=lambda: ["KRK"])
    budget_pln: int | None = Field(None, description="Total budget per person in PLN, if stated")
    luxury: LuxuryLevel = LuxuryLevel.standard
    interests: dict[str, float] = Field(
        default_factory=dict, description=f"tag -> 0..1, tags from: {', '.join(TAG_VOCABULARY)}"
    )
    dislikes: list[str] = Field(
        default_factory=list, description=f"from: {', '.join(DISLIKE_VOCABULARY)}"
    )
    preferred_temp_min_c: float = 15.0
    preferred_temp_max_c: float = 26.0
    trip_min_days: int = 3
    trip_max_days: int = 7

    def to_profile(self, user_id: str) -> TasteProfile:
        lo, hi = sorted((self.preferred_temp_min_c, self.preferred_temp_max_c))
        dmin, dmax = sorted((max(1, self.trip_min_days), max(1, self.trip_max_days)))
        return TasteProfile(
            user_id=user_id,
            origin_airports=[a.upper() for a in self.origin_airports] or ["KRK"],
            budget_pln=self.budget_pln,
            luxury=self.luxury,
            interests={k.lower(): max(0.0, min(1.0, v)) for k, v in self.interests.items()},
            dislikes=[d.lower() for d in self.dislikes],
            preferred_temp_c=(lo, hi),
            trip_length_days=(dmin, dmax),
        )


class InterviewTurn(BaseModel):
    reply: str = Field(description="What to say to the user next (a question, or a short summary)")
    done: bool = Field(description="True once you know interests, budget and climate preferences")
    profile: ProfileDraft | None = Field(None, description="Filled in only when done=true")


class InterviewResult(BaseModel):
    reply: str
    profile: TasteProfile | None = None


INSTRUCTIONS = f"""\
You are TripAI's onboarding interviewer. In at most 3 short questions, learn:
1) what the user loves doing on a trip (map to tags: {", ".join(TAG_VOCABULARY)}),
2) budget per person in PLN and comfort level (budget/standard/comfort/luxury),
3) preferred temperature and anything they dislike ({", ".join(DISLIKE_VOCABULARY)}).
Ask one friendly question per turn, in the language given by the LANGUAGE line.
When you have enough (or the user has answered 3 times), set done=true, fill `profile`
(interest weights 0..1 reflecting enthusiasm) and give a one-sentence summary as `reply`.
Never invent prices or destinations."""

interview_agent = Agent(
    None,
    output_type=InterviewTurn,
    instructions=INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
)


def _transcript(messages: list[ChatMessage]) -> str:
    return (
        "\n".join(f"{m.role.upper()}: {m.content}" for m in messages) or "USER: (no messages yet)"
    )


# ---------------------------------------------------------------- deterministic fallback

QUESTIONS = ["iv.q1", "iv.q2", "iv.q3"]  # i18n keys (tripai.i18n): asked in order
_KEYWORDS = {
    "food": ["food", "eat", "cuisine", "jedzenie", "kuchnia", "restaur", "tapas", "wine", "wino"],
    "history": ["history", "histor", "ancient", "ruins", "zabyt", "castle", "zamk"],
    "art": ["art", "sztuk", "gallery", "galer"],
    "museums": ["museum", "muze"],
    "architecture": ["architect"],
    "beach": ["beach", "plaż", "plaz", "sea", "morze", "swim"],
    "sun": ["sun", "słońc", "slonc"],
    "nature": ["nature", "natur", "mountain", "gór", "gor", "park"],
    "hiking": ["hik", "trek", "wędr", "wedr"],
    "nightlife": ["nightlife", "party", "impre", "club", "bar"],
    "diving": ["diving", "nurk", "snorkel"],
    "design": ["design"],
    "festivals": ["festival", "festiwal", "concert", "koncert"],
}
_LUXURY_WORDS = {  # checked in this order (en + pl stems)
    LuxuryLevel.luxury: ["luxury", "luksus"],
    LuxuryLevel.comfort: ["comfort", "komfort", "wygod"],
    LuxuryLevel.budget: ["budget", "budżet", "budzet", "tanio", "cheap"],
    LuxuryLevel.standard: ["standard"],
}
_DISLIKES = {
    "crowds": ["crowd", "tłum", "tlum"],
    "heat": ["heat", "upał", "upal", "too hot"],
    "cold": ["cold", "zimn", "freez"],
}


def _rule_based(messages: list[ChatMessage], user_id: str) -> InterviewResult:
    answers = [m.content for m in messages if m.role == "user"]
    if len(answers) < len(QUESTIONS):
        return InterviewResult(reply=i18n.t(QUESTIONS[len(answers)]))
    text = " ".join(answers).lower()
    interests = {tag: 0.8 for tag, kws in _KEYWORDS.items() if any(k in text for k in kws)} or {
        "food": 0.6,
        "history": 0.6,
    }
    dislikes = [d for d, kws in _DISLIKES.items() if any(k in text for k in kws)]
    budget = None
    if m := re.search(r"(\d[\d\s.,]*)\s*(?:k\b|tys)", text):
        budget = int(float(re.sub(r"[\s,]", "", m.group(1)).replace(",", ".")) * 1000)
    else:
        amounts = (int(re.sub(r"\s", "", x)) for x in re.findall(r"\d[\d ]*\d", text))
        budget = next((a for a in amounts if a >= 300), None)
    luxury = next(
        (lv for lv, words in _LUXURY_WORDS.items() if any(w in text for w in words)),
        LuxuryLevel.standard,
    )
    lo, hi = 15.0, 26.0
    temps = [int(t) for t in re.findall(r"(-?\d{1,2})\s*(?:°|stopni|deg|c\b)", text)]
    if temps:
        lo, hi = (min(temps) - 3, max(temps) + 3) if len(temps) == 1 else (min(temps), max(temps))
    draft = ProfileDraft(
        budget_pln=budget,
        luxury=luxury,
        interests=interests,
        dislikes=dislikes,
        preferred_temp_min_c=lo,
        preferred_temp_max_c=hi,
    )
    profile = draft.to_profile(user_id)
    budget = profile.budget_pln
    summary = i18n.t(
        "iv.summary",
        interests=i18n.tags(list(profile.interests)),
        budget=i18n.t("iv.budget", amount=i18n.fmt_pln(budget)) if budget else "",
        luxury=i18n.t(f"lux.{profile.luxury.value}"),
        lo=i18n.fmt_dec(lo),
        hi=i18n.fmt_dec(hi),
        avoid=i18n.t("iv.avoid", items=i18n.tags(dislikes)) if dislikes else "",
    )
    return InterviewResult(reply=summary, profile=profile)


async def interview(
    messages: list[ChatMessage],
    user_id: str = "demo",
    model: Model | str | None = None,
    lang: str | None = None,
) -> InterviewResult:
    """One interview turn in `lang` (default: the request's). Uses the LLM when available,
    otherwise a scripted 3-question flow."""
    with i18n.using(i18n.pick(lang)):
        return await _interview(messages, user_id, model)


async def _interview(
    messages: list[ChatMessage], user_id: str, model: Model | str | None
) -> InterviewResult:
    # guard every message (the client resends history and sets `role`) before any LLM sees it;
    # blocked messages are dropped from the transcript, now and on later turns
    verdicts = await screen([m.content for m in messages])
    if messages and verdicts[-1].blocked and messages[-1].role == "user":
        return InterviewResult(reply=verdicts[-1].reply or "")
    messages = [m for m, g in zip(messages, verdicts) if not g.blocked]
    if model is None and not llm_enabled():
        return _rule_based(messages, user_id)
    try:
        result = await interview_agent.run(
            "Conversation so far:\n" + _transcript(messages) + "\n\n" + i18n.llm_language_rule(),
            model=model or model_name(),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("interview agent failed, using scripted flow: %s", exc)
        return _rule_based(messages, user_id)
    turn = result.output
    profile = turn.profile.to_profile(user_id) if turn.done and turn.profile else None
    return InterviewResult(reply=turn.reply, profile=profile)
