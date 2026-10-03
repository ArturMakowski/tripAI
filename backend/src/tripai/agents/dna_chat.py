"""Chat interview -> Travel DNA: free text in, swipe-card answers out (docs/TRAVEL_DNA.md).

Jev reads the conversation and picks 1..5 (or "not said") per card q1..q12 and yes/no for y1, each
with a calibrated confidence. Answers below LOW_CONFIDENCE are not trusted: we ask a follow-up
about the most important unsure card (at most MAX_FOLLOW_UPS times), then leave the rest missing
(= 3, "Depends", in the deterministic mapping). The result's `answers` / `yes_no` are exactly the
input of `POST /profile/dna`, so the same mapping and receipts apply to chat and swipe users.

Without Jev the flow is scripted: it asks the most important cards one by one and reads replies
like "so me" / "nie ja" / "4".
"""

import logging
import re
from itertools import pairwise

from pydantic import BaseModel, Field
from pydantic_ai.models import Model

from tripai import i18n
from tripai.agents.interview import ChatMessage
from tripai.agents.jev import (
    CARDS_EN,
    LOW_CONFIDENCE,
    decide,
    dna_decision_agent,
    jev_enabled,
    screen,
)

log = logging.getLogger(__name__)

STATEMENTS = [f"q{i}" for i in range(1, 13)]
# which unsure card to ask about first: the ones that move weights/dislikes/interests the most
PRIORITY = ["q9", "q11", "q6", "q5", "q7", "q1", "q10", "q4", "q8", "q2", "q3", "q12", "y1"]
MAX_FOLLOW_UPS = 4
OPENER = i18n.MESSAGES["chat.opener"]["en"]  # en form; replies follow the request language


class DnaChatResult(BaseModel):
    reply: str  # the follow-up question, or a short wrap-up when done
    done: bool
    answers: dict[str, int] = Field(default_factory=dict)  # q1..q12 -> 1..5 (confident only)
    yes_no: dict[str, bool] = Field(default_factory=dict)  # y1 (y2 stays with the user)
    confidence: dict[str, float] = Field(default_factory=dict)  # card -> 0..1, as Jev reported
    missing: list[str] = Field(default_factory=list)  # cards we couldn't read (count as 3)
    asked: str | None = None  # card id the follow-up is about
    engine: str  # "typesafe:jev-..." or "scripted"
    blocked: bool = False  # the guardrail stopped the last message


def follow_up_question(card: str, lang: str | None = None) -> str:
    if card == "y1":
        return i18n.t("chat.ask_y1", lang, card=i18n.t("card.y1", lang))
    return i18n.t("chat.ask_card", lang, card=i18n.t(f"card.{card}", lang))


def _asked_card(text: str) -> str | None:
    """Which card the assistant asked about (its statement in either language)."""
    for c in CARDS_EN:
        if any(i18n.t(f"card.{c}", lg) in text for lg in i18n.LANGS):
            return c
    return None


_REPLY_WORDS: list[tuple[re.Pattern[str], int]] = [
    (
        re.compile(r"\bso me\b|\bvery me\b|bardzo ja|\bdefinitely\b|\babsolutely\b", re.IGNORECASE),
        5,
    ),
    (re.compile(r"not me|nie ja|\bnot really\b|\bnope\b|\bno\b|\bnie\b", re.IGNORECASE), 1),
    (re.compile(r"depends|zale[żz]y|\bsometimes\b|\bmaybe\b|\bmeh\b", re.IGNORECASE), 3),
    (re.compile(r"that'?s me|to ja|\byes\b|\btak\b|\bsure\b", re.IGNORECASE), 4),
]


def parse_reply(text: str) -> int | None:
    """A reply to a card question -> 1..5 (digits win, then the swipe words in PL/EN)."""
    if m := re.search(r"\b([1-5])\b", text):
        return int(m.group(1))
    return next((v for pat, v in _REPLY_WORDS if pat.search(text)), None)


def _scripted_answers(messages: list[ChatMessage]) -> tuple[dict[str, int], dict[str, bool]]:
    answers: dict[str, int] = {}
    yes_no: dict[str, bool] = {}
    for prev, msg in pairwise(messages):
        if prev.role != "assistant" or msg.role != "user":
            continue
        card = _asked_card(prev.content)
        v = parse_reply(msg.content) if card else None
        if card == "y1" and v is not None:
            yes_no["y1"] = v >= 4
        elif card and v is not None:
            answers[card] = v
    return answers, yes_no


def _transcript(messages: list[ChatMessage]) -> str:
    return "\n".join(f"{m.role.upper()}: {m.content}" for m in messages)


def _next(
    answers: dict[str, int],
    yes_no: dict[str, bool],
    confidence: dict[str, float],
    messages: list[ChatMessage],
    engine: str,
) -> DnaChatResult:
    known = set(answers) | set(yes_no)
    missing = [c for c in PRIORITY if c not in known]
    asked_already = {c for m in messages if m.role == "assistant" if (c := _asked_card(m.content))}
    follow_ups = len(asked_already)
    todo = [c for c in missing if c not in asked_already]
    if todo and follow_ups < MAX_FOLLOW_UPS:
        card = todo[0]
        return DnaChatResult(
            reply=follow_up_question(card), done=False, answers=answers, yes_no=yes_no,
            confidence=confidence, missing=missing, asked=card, engine=engine,
        )  # fmt: skip
    return DnaChatResult(
        reply=i18n.t("chat.done"),
        done=True, answers=answers, yes_no=yes_no, confidence=confidence,
        missing=sorted(missing, key=PRIORITY.index), engine=engine,
    )  # fmt: skip


async def chat_dna(
    messages: list[ChatMessage], model: Model | None = None, guard_model: Model | None = None
) -> DnaChatResult:
    """One chat turn: guard every message, read DNA from the messages that pass, ask or finish.

    A blocked message is dropped from the transcript (now and on every later turn), so it never
    reaches Jev's DNA read or any LLM. If the latest user message is blocked, the reply is the
    guard's and `blocked` is set; the answers are still those read from the rest of the chat.
    `model` / `guard_model` override the Jev model for the DNA read / the guardrail (tests)."""
    use_jev = model is not None or jev_enabled()
    engine = "scripted"
    if not any(m.role == "user" for m in messages):
        return DnaChatResult(
            reply=i18n.t("chat.opener"), done=False, engine="typesafe:jev" if use_jev else engine
        )
    verdicts = await screen([m.content for m in messages], model=guard_model)
    clean = [m for m, g in zip(messages, verdicts) if not g.blocked]
    last_user = max(i for i, m in enumerate(messages) if m.role == "user")
    blocked = verdicts[last_user] if verdicts[last_user].blocked else None

    # a direct reply to a card question wins over Jev's reading of the whole chat
    answers, yes_no = _scripted_answers(clean)
    confidence: dict[str, float] = {}
    if use_jev and any(m.role == "user" for m in clean):
        try:
            d = await decide(dna_decision_agent, "CONVERSATION:\n" + _transcript(clean), model)
        except Exception as exc:  # noqa: BLE001 - scripted flow still works
            log.warning("jev DNA read failed, using scripted flow: %s", exc)
        else:
            engine, confidence = d.model, d.confidence
            out = d.output
            for q in STATEMENTS:
                v = getattr(out, q)
                if q not in answers and v != "not_said" and d.conf(q) >= LOW_CONFIDENCE:
                    answers[q] = int(v)
            if "y1" not in yes_no and out.y1 != "not_said" and d.conf("y1") >= LOW_CONFIDENCE:
                yes_no["y1"] = out.y1 == "yes"
    if blocked is not None:
        missing = [c for c in PRIORITY if c not in answers and c not in yes_no]
        return DnaChatResult(
            reply=blocked.reply or "", done=False, answers=answers, yes_no=yes_no,
            confidence=confidence, missing=missing, engine=engine, blocked=True,
        )  # fmt: skip
    return _next(answers, yes_no, confidence, clean, engine)
