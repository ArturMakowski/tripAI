"""Full-phase speed (t18): speculative LLM next to Jev, per-item deadline with a deterministic
fallback, late answers cached for the next load, and no Supabase round-trips once the SerpApi
budget is spent. Offline: fake engines that just sleep."""

import asyncio
import json
import time
from datetime import UTC, datetime

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from tripai.agents import llm_cache
from tripai.agents.explain import explain, template_why
from tripai.agents.fit import clear_cache, fit, fit_run, rules_verdict
from tripai.agents.jev import FIT_LEVELS
from tripai.connectors.cache import CachedPayload
from tripai.live.budget import BudgetExhausted, SerpApiBudget
from tripai.models import TasteProfile
from tripai.scoring import rank

NO = dict.fromkeys(["crowd_conflict", "relax_conflict", "budget_conflict", "weather_conflict",
                    "pace_conflict", "culture_match", "active_match", "novelty_match"], False)  # fmt: skip


class MemCache:
    def __init__(self):
        self.d: dict = {}

    async def get(self, source, params):
        v = self.d.get((source, json.dumps(params, sort_keys=True)))
        return None if v is None else CachedPayload(v, datetime.now(UTC))

    async def set(self, source, params, payload, fetched_at):
        self.d[(source, json.dumps(params, sort_keys=True))] = payload


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    clear_cache()
    llm_cache.reset()
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.5")
    monkeypatch.setenv("TRIPAI_LLM_BACKGROUND_S", "5")


@pytest.fixture
def mem(monkeypatch):
    m = MemCache()
    monkeypatch.setenv("TRIPAI_LLM_CACHE", "1")
    monkeypatch.setattr(llm_cache, "_backend", m)
    return m


@pytest.fixture
def profile():
    return TasteProfile(user_id="s", dislikes=["crowds"], traits={"q11": 5, "q8": 5})


@pytest.fixture
def rec(candidates, profile):
    return rank(candidates, profile, limit=1)[0]


def slow_jev(delay: float, p_label: float, calls: list) -> FunctionModel:
    async def fn(messages, info: AgentInfo) -> ModelResponse:
        calls.append(time.perf_counter())
        await asyncio.sleep(delay)
        answers = {"label": FIT_LEVELS.index("good_fit"), **NO}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(answers))],
                             provider_details={"confidence": {"label": p_label}})  # fmt: skip

    return FunctionModel(fn, model_name="jev-slow")


def slow_gpt(delay: float, calls: list, text: str | None = None) -> FunctionModel:
    async def fn(messages, info: AgentInfo) -> ModelResponse:
        calls.append(time.perf_counter())
        await asyncio.sleep(delay)
        if text is not None:
            return ModelResponse(parts=[TextPart(text)])
        draft = {"label": "poor_fit", "confidence": 0.8, "summary": "Too busy then.",
                 "matches": [], "concerns": []}  # fmt: skip
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(draft))])

    return FunctionModel(fn, model_name="gpt-slow")


async def test_escalation_costs_max_not_sum(rec, profile):
    """Jev 0.3 s (unsure) + GPT 0.3 s run side by side: ~0.3 s, not 0.6 s."""
    jc, gc = [], []
    t = time.perf_counter()
    run = await fit_run(rec, profile, model=slow_gpt(0.3, gc), jev=slow_jev(0.3, 0.3, jc),
                        engine="jev")  # fmt: skip
    took = time.perf_counter() - t
    assert run.escalated and run.verdict.label == "poor_fit"
    assert abs(gc[0] - jc[0]) < 0.1  # GPT started with Jev, not after it
    assert took < 0.5, took


async def test_confident_jev_cancels_the_speculative_llm(rec, profile):
    jc, started, cancelled = [], [], []

    async def gpt_fn(messages, info):
        started.append(1)
        try:
            await asyncio.sleep(2.0)
        except asyncio.CancelledError:
            cancelled.append(1)
            raise
        raise AssertionError("the speculative call should have been cancelled")

    t = time.perf_counter()
    run = await fit_run(rec, profile, model=FunctionModel(gpt_fn, model_name="gpt-slow"),
                        jev=slow_jev(0.05, 0.95, jc), engine="jev", phrase=False)  # fmt: skip
    assert time.perf_counter() - t < 0.3
    assert not run.escalated and run.verdict.label == "good_fit"
    await asyncio.sleep(0.05)
    assert started and cancelled  # it ran in parallel, then was cancelled


async def test_slow_llm_never_blocks_the_page_and_fills_the_cache(rec, profile, mem):
    """GPT takes 1 s, the deadline is 0.5 s: rules verdict now, the real one on the next load."""
    jc, gc = [], []
    jev, gpt = slow_jev(0.05, 0.3, jc), slow_gpt(1.0, gc)
    t = time.perf_counter()
    v1 = await fit(rec, profile, model=gpt, jev=jev)
    took = time.perf_counter() - t
    assert took < 0.8, took
    assert v1.model == "rules" and v1 == fit_rules(rec, profile)
    await llm_cache.drain()  # the late GPT verdict lands in the cache
    assert any(k[0] == llm_cache.FIT for k in mem.d)
    clear_cache()  # a fresh process: only the persistent layer remains
    t = time.perf_counter()
    v2 = await fit(rec, profile, model=gpt, jev=jev)
    assert time.perf_counter() - t < 0.1
    assert v2.label == "poor_fit" and "gpt-slow" in v2.model and len(gc) == 1  # no new LLM call
    assert v2.inputs_hash == rec.inputs_hash


def fit_rules(rec, profile):
    from tripai.agents.fit import _finish

    return _finish(rules_verdict(rec, profile), "rules", rec, profile).model_copy(
        update={"created_at": None}
    )


@pytest.fixture(autouse=True)
def _comparable_created_at(monkeypatch):
    """Verdict equality ignores created_at."""
    from tripai.models import FitVerdict

    monkeypatch.setattr(FitVerdict, "__eq__", lambda a, b: a.model_dump(exclude={"created_at"})
                        == b.model_dump(exclude={"created_at"}))  # fmt: skip


async def test_slow_explanation_gets_the_template_then_the_cached_llm_text(rec, mem):
    gc = []
    text = f"{rec.city}: {round(rec.total_cost_pln)} PLN in total."
    gpt = slow_gpt(1.0, gc, text=text)
    t = time.perf_counter()
    why1 = await explain(rec, {"food": 1.0}, model=gpt, lang="en")
    assert time.perf_counter() - t < 0.8
    assert why1 == template_why(rec, {"food": 1.0}, "en")
    await llm_cache.drain()
    t = time.perf_counter()
    why2 = await explain(rec, {"food": 1.0}, model=gpt, lang="en")
    assert time.perf_counter() - t < 0.1 and why2 == text and len(gc) == 1
    # another language is another prompt: a miss (and the template while it loads)
    assert await explain(rec, {"food": 1.0}, model=gpt, lang="pl") == template_why(
        rec, {"food": 1.0}, "pl"
    )
    await llm_cache.drain()


async def test_cached_text_is_rechecked_against_the_card(rec, mem):
    """A cached 'why' whose numbers no longer match this card is a miss."""
    gc = []
    gpt = slow_gpt(0.0, gc, text=f"{rec.city}: {round(rec.total_cost_pln)} PLN in total.")
    await explain(rec, {}, model=gpt, lang="en")
    key = next(k for k in mem.d if k[0] == llm_cache.WHY)
    mem.d[key] = "Only 99999 PLN!"  # tampered / stale
    assert await explain(rec, {}, model=gpt, lang="en") != "Only 99999 PLN!"


async def test_exhausted_budget_stops_reading_supabase(tmp_path):
    """Once today's cap is reached, refusals are immediate (no remote read under the lock)."""
    b = SerpApiBudget(daily_cap=3, root=tmp_path)
    reads = []

    async def remote(day):
        reads.append(day)
        await asyncio.sleep(0.05)
        return 3

    b._read_remote = remote  # type: ignore[method-assign]
    with pytest.raises(BudgetExhausted):
        await b.take()
    t = time.perf_counter()
    for _ in range(20):
        with pytest.raises(BudgetExhausted):
            await b.take()
    assert len(reads) == 1 and time.perf_counter() - t < 0.05
    assert await b.exhausted()
    # a higher cap (config change) is a new state: it reads again
    b._daily_cap = 10
    reads.clear()
    assert await b.take() == 4 and len(reads) == 1


def test_provider_skips_refinement_when_budget_is_spent(monkeypatch, tmp_path):
    """No exact-date pipeline (and no meter calls) once the daily budget is exhausted."""
    import test_live  # the T5a harness: LiveProvider on recorded fixtures

    for var in ("SERPAPI_API_KEY", "SERPER_API_KEY", "TRAVELPAYOUTS_TOKEN", "SUPABASE_URL",
                "SUPABASE_SECRET_KEY", "TRIPAI_PROVIDER", "TRIPAI_USE_FIXTURES",
                "TRIPAI_FIXTURE_SOURCES"):  # fmt: skip
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))

    class Spent(SerpApiBudget):
        async def exhausted(self):
            return True

        async def take(self):
            raise AssertionError("refinement must be skipped, not attempted")

    p = test_live.live(top_n=3, max_refine=3, budget=Spent(daily_cap=0))
    cands = test_live.run(p, TasteProfile(user_id="t", interests={"food": 1.0}))
    assert cands and p.last_stats.get("refine_skipped")
    assert not p.last_stats.get("refined")
