import json

from pydantic_ai.messages import ModelResponse, RetryPromptPart, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel

from tripai.agents.explain import (
    allowed_numbers,
    explain,
    template_why,
    ungrounded_numbers,
)
from tripai.agents.interview import ChatMessage, interview
from tripai.models import LuxuryLevel
from tripai.scoring import rank


def _top(candidates, profile):
    return rank(candidates, profile)[0]


def test_template_why_is_grounded(candidates, profile):
    for rec in rank(candidates, profile):
        why = template_why(rec, profile.interests)
        assert rec.city in why
        assert ungrounded_numbers(why, allowed_numbers(rec)) == []


def test_ungrounded_numbers_detects_invention(candidates, profile):
    rec = _top(candidates, profile)
    allowed = allowed_numbers(rec)
    assert ungrounded_numbers(f"Only {rec.total_cost_pln:,.0f} PLN", allowed) == []
    assert ungrounded_numbers("Only 1 234 567 PLN and 99.9% sunny", allowed) == ["1234567", "99.9"]


async def test_explain_retries_on_invented_number(candidates, profile):
    rec = _top(candidates, profile)
    calls = []

    def model_fn(messages, info: AgentInfo) -> ModelResponse:
        calls.append(messages)
        if len(calls) == 1:
            return ModelResponse(parts=[TextPart(f"{rec.city} for just 99999 PLN!")])
        retry = [
            p for m in messages for p in getattr(m, "parts", []) if isinstance(p, RetryPromptPart)
        ]
        assert retry and "99999" in str(retry[-1].content)
        return ModelResponse(parts=[TextPart(f"{rec.city}: {rec.total_cost_pln:.0f} PLN total.")])

    why = await explain(rec, profile.interests, model=FunctionModel(model_fn))
    assert len(calls) == 2
    assert why == f"{rec.city}: {rec.total_cost_pln:.0f} PLN total."


async def test_explain_falls_back_when_model_keeps_inventing(candidates, profile):
    rec = _top(candidates, profile)
    why = await explain(
        rec, profile.interests, model=TestModel(custom_output_text="Costs 31337 PLN")
    )
    assert why == template_why(rec, profile.interests)


async def test_explain_without_llm_uses_template(candidates, profile):
    rec = _top(candidates, profile)
    assert await explain(rec, profile.interests) == template_why(rec, profile.interests)


async def test_interview_agent_structured_output():
    def model_fn(messages, info: AgentInfo) -> ModelResponse:
        prompt = messages[-1].parts[-1].content
        assert "food" in prompt
        args = {
            "reply": "Great, food lover on a 3000 PLN budget!",
            "done": True,
            "profile": {
                "budget_pln": 3000,
                "luxury": "comfort",
                "interests": {"Food": 0.9, "history": 1.4},
                "dislikes": ["Crowds"],
                "preferred_temp_min_c": 24,
                "preferred_temp_max_c": 18,
            },
        }
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(args))])

    msgs = [ChatMessage(role="user", content="I love food and history, 3000 PLN, no crowds")]
    res = await interview(msgs, user_id="u9", model=FunctionModel(model_fn))
    p = res.profile
    assert p.user_id == "u9" and p.budget_pln == 3000 and p.luxury == LuxuryLevel.comfort
    assert p.interests == {"food": 0.9, "history": 1.0}
    assert p.dislikes == ["crowds"] and p.preferred_temp_c == (18, 24)


async def test_interview_agent_not_done_returns_no_profile():
    model = TestModel(custom_output_args={"reply": "What do you love?", "done": False})
    res = await interview([], model=model)
    assert res.reply == "What do you love?" and res.profile is None


async def test_scripted_interview_without_llm():
    answers = ["Uwielbiam jedzenie i historię, trochę plaży", "około 3 000 zł, comfort",
               "22 stopni, nie lubię tłumów"]  # fmt: skip
    msgs: list[ChatMessage] = []
    for a in answers:
        r = await interview(msgs)
        assert r.profile is None
        msgs += [
            ChatMessage(role="assistant", content=r.reply),
            ChatMessage(role="user", content=a),
        ]
    p = (await interview(msgs)).profile
    assert set(p.interests) == {"food", "history", "beach"}
    assert p.budget_pln == 3000 and p.luxury == LuxuryLevel.comfort
    assert p.dislikes == ["crowds"] and p.preferred_temp_c == (19, 25)


def test_model_selection(monkeypatch):
    from tripai.agents.llm import llm_enabled, model_name

    monkeypatch.delenv("TRIPAI_LLM")
    assert model_name() == "openai:gpt-6-luna" and not llm_enabled()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert llm_enabled()
    monkeypatch.setenv("TRIPAI_MODEL", "anthropic:claude-sonnet-5-5")
    assert not llm_enabled()  # key of the selected provider is missing
    monkeypatch.setenv("TRIPAI_LLM", "0")
    assert not llm_enabled()
