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


def _concern(info) -> list:
    """A concrete minus for a fit *decision* (FitDraft); none for a phrasing request."""
    schema = json.dumps(info.output_tools[0].parameters_json_schema)
    return [{"text": "Too busy then.", "dna": ["q11"]}] if '"label"' in schema else []


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
    # generous deadlines: timing asserts keep a 2-3x margin for a loaded CI runner
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "2.0")
    monkeypatch.setenv("TRIPAI_LLM_BACKGROUND_S", "5")
    monkeypatch.setenv("TRIPAI_SPECULATE_AFTER_S", "0.1")
    yield
    for t in list(llm_cache._inflight.values()):  # nothing leaks into the next test
        t.cancel()
    llm_cache._inflight.clear()


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
                 "matches": [], "concerns": _concern(info)}  # fmt: skip
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(draft))])

    return FunctionModel(fn, model_name="gpt-slow")


async def test_escalation_costs_max_not_sum(rec, profile):
    """Slow, unsure Jev (0.6 s) + GPT (0.6 s): GPT starts after 0.1 s, total ~0.7 s, not 1.2 s."""
    jc, gc = [], []
    t = time.perf_counter()
    run = await fit_run(rec, profile, model=slow_gpt(0.6, gc), jev=slow_jev(0.6, 0.3, jc),
                        engine="jev")  # fmt: skip
    took = time.perf_counter() - t
    assert run.escalated and run.verdict.label == "poor_fit"
    assert 0.05 < gc[0] - jc[0] < 0.4  # speculation kicked in while Jev was still thinking
    assert took < 1.05, took  # the serial sum would be >= 1.2 s


async def test_quick_sure_jev_never_calls_the_llm(rec, profile):
    """Review #5: speculation only when Jev is slow, so a quick, sure Jev costs no GPT call."""
    jc, gc = [], []
    run = await fit_run(rec, profile, model=slow_gpt(0.5, gc), jev=slow_jev(0.02, 0.95, jc),
                        engine="jev", phrase=False)  # fmt: skip
    assert not run.escalated and run.verdict.label == "good_fit" and gc == []


async def test_quick_unsure_jev_asks_the_llm_right_away(rec, profile):
    jc, gc = [], []
    run = await fit_run(rec, profile, model=slow_gpt(0.05, gc), jev=slow_jev(0.02, 0.3, jc),
                        engine="jev")  # fmt: skip
    assert run.escalated and len(gc) == 1 and gc[0] >= jc[0]


async def test_slow_sure_jev_cancels_the_speculative_llm(rec, profile):
    jc, started, cancelled = [], [], []

    async def gpt_fn(messages, info):
        started.append(1)
        try:
            await asyncio.sleep(3.0)
        except asyncio.CancelledError:
            cancelled.append(1)
            raise
        raise AssertionError("the speculative call should have been cancelled")

    t = time.perf_counter()
    run = await fit_run(rec, profile, model=FunctionModel(gpt_fn, model_name="gpt-slow"),
                        jev=slow_jev(0.4, 0.95, jc), engine="jev", phrase=False)  # fmt: skip
    assert time.perf_counter() - t < 1.2
    assert not run.escalated and run.verdict.label == "good_fit"
    await asyncio.sleep(0.05)
    assert started and cancelled  # it ran in parallel with the slow Jev, then was cancelled


async def test_slow_llm_never_blocks_the_page_and_keeps_the_shown_label(
    rec, profile, mem, monkeypatch
):
    """GPT takes 1 s, the deadline is 0.3 s: rules verdict now. GPT disagrees on the label, so
    a reload keeps the label the user saw (stable verdicts), with no new model call."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.3")
    jc, gc = [], []
    jev, gpt = slow_jev(0.05, 0.3, jc), slow_gpt(1.0, gc)  # GPT says poor_fit
    t = time.perf_counter()
    v1 = await fit(rec, profile, model=gpt, jev=jev)
    took = time.perf_counter() - t
    assert took < 0.9, took
    assert v1.model == "rules" and v1 == fit_rules(rec, profile) and v1.label != "poor_fit"
    await llm_cache.drain()
    assert any(k[0] == llm_cache.FIT for k in mem.d)
    clear_cache()  # a fresh process: only the persistent layer remains
    t = time.perf_counter()
    v2 = await fit(rec, profile, model=gpt, jev=jev)
    assert time.perf_counter() - t < 0.1 and len(gc) == 1  # no new LLM call
    assert v2.label == v1.label and v2.model == "rules"


async def test_late_ai_verdict_replaces_the_rules_one_when_it_agrees(
    rec, profile, mem, monkeypatch
):
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.3")
    want = fit_rules(rec, profile).label
    gc = []

    async def agreeing(messages, info):
        gc.append(1)
        await asyncio.sleep(0.8)
        draft = {"label": want, "confidence": 0.8, "summary": "AI wording.",
                 "matches": [], "concerns": [{"text": "Busy.", "dna": ["q11"]}]}  # fmt: skip
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(draft))])

    gpt, jev = FunctionModel(agreeing, model_name="gpt-agree"), slow_jev(0.05, 0.3, [])
    v1 = await fit(rec, profile, model=gpt, jev=jev)
    assert v1.model == "rules"
    await llm_cache.drain()
    clear_cache()
    v2 = await fit(rec, profile, model=gpt, jev=jev)
    assert v2.label == v1.label == want and "gpt-agree" in v2.model and len(gc) == 1


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


async def test_slow_explanation_gets_the_template_then_the_cached_llm_text(rec, mem, monkeypatch):
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.3")
    gc = []
    text = f"{rec.city}: {round(rec.total_cost_pln)} PLN in total."
    gpt = slow_gpt(1.0, gc, text=text)
    t = time.perf_counter()
    why1 = await explain(rec, {"food": 1.0}, model=gpt, lang="en")
    assert time.perf_counter() - t < 0.9
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


def test_demo_plan_warm_cache_then_cap_zero_still_refines(monkeypatch, tmp_path):
    """Review #1 / demo plan: warm the SerpApi cache, set the cap to 0, and full-phase cards are
    still refined with the cached exact-date prices; no network call, no meter read."""
    import respx
    import test_live  # T5a harness: seed cities, recorded SerpApi payloads behind respx

    for var in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "TRIPAI_PROVIDER", "TRIPAI_USE_FIXTURES",
                "TRIPAI_NO_CACHE"):  # fmt: skip
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))  # the warmed connector cache
    monkeypatch.setenv("TRIPAI_FIXTURE_SOURCES", "travelpayouts,serper,open_meteo")
    monkeypatch.setenv("TRIPAI_SERPAPI_REQUEST_CAP", "50")
    prof = TasteProfile(user_id="t", budget_pln=2500, interests={"food": 0.9, "history": 0.7})

    def provider(budget):
        return test_live.LiveProvider(today=test_live.TODAY, city_ids=test_live.FIXTURE_CITIES,
                                      top_n=3, max_refine=3, budget=budget)  # fmt: skip

    # 1) warm-up run: live (mocked) SerpApi, results land in the connector cache
    warm_budget = SerpApiBudget(daily_cap=100, root=tmp_path / "b1")
    with respx.mock() as mock:
        mock.get(url__startswith="https://serpapi.com/").mock(
            side_effect=test_live._serpapi_from_fixtures
        )
        warm = provider(warm_budget)
        warm_cands = test_live.run(warm, prof)
    assert warm.last_stats["refined"] and warm.last_stats["serpapi_network"] > 0

    # 2) demo: cap 0 (budget spent). The meter must refuse instantly; the cache answers.
    reads: list[str] = []
    spent = SerpApiBudget(daily_cap=0, root=tmp_path / "b2")

    async def remote(day):
        reads.append(day)
        return 0

    spent._read_remote = remote  # type: ignore[method-assign]
    with respx.mock(assert_all_called=False) as mock:
        route = mock.get(url__startswith="https://serpapi.com/").mock(
            side_effect=AssertionError("no SerpApi network call with the cap at 0")
        )
        demo = provider(spent)
        cands = test_live.run(demo, prof)
    assert route.call_count == 0 and demo.last_stats["serpapi_network"] == 0
    assert set(demo.last_stats["refined"]) == set(warm.last_stats["refined"])
    refined = [c for c in cands if f"{c.iata}-{c.window.start:%Y%m%d}-{c.window.end:%Y%m%d}"
               in demo.last_stats["refined"]]  # fmt: skip
    # identical to the warm-up run: same statuses and prices, at least one fully exact card
    key = lambda c: (c.iata, c.window.start)
    before = {key(c): (c.price_status, c.total_cost_pln) for c in warm_cands}
    assert all((c.price_status, c.total_cost_pln) == before[key(c)] for c in refined)
    assert any(c.price_status == "exact" for c in refined)
    srcs = {e.source for c in refined for e in c.evidence}
    assert "serpapi:google_flights" in srcs  # the cached live answer, not a recorded fixture
    assert len(reads) <= 1  # at most one counter read, then "exhausted today" answers locally


# ---------------------------------------------------------------- background calls (#2-#4)


async def test_reload_joins_the_running_llm_call(rec, mem, monkeypatch):
    """Review #2: a reload while the late call is still running doesn't start a second one."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.2")
    gc = []
    gpt = slow_gpt(0.8, gc, text=f"{rec.city}: {round(rec.total_cost_pln)} PLN in total.")
    a = await explain(rec, {}, model=gpt, lang="en")
    b = await explain(rec, {}, model=gpt, lang="en")  # the user reloads within the window
    assert a == b == template_why(rec, {}, "en") and len(gc) == 1 and llm_cache.inflight() == 1
    await llm_cache.drain()
    assert await explain(rec, {}, model=gpt, lang="en") != a and len(gc) == 1


async def test_background_work_is_capped(rec, mem, monkeypatch):
    """Review #2: with the cap reached, a late call is just cut off (no background run)."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.2")
    monkeypatch.setenv("TRIPAI_LLM_MAX_BACKGROUND", "0")
    gc = []
    gpt = slow_gpt(0.6, gc, text=f"{rec.city}: {round(rec.total_cost_pln)} PLN in total.")
    assert await explain(rec, {}, model=gpt, lang="en") == template_why(rec, {}, "en")
    assert llm_cache.inflight() == 0
    await asyncio.sleep(0.7)
    assert not any(k[0] == llm_cache.WHY for k in mem.d)  # cancelled, nothing cached


async def test_cancelled_request_does_not_orphan_the_call(rec, mem, monkeypatch):
    """Review #3: the client disconnects; the call keeps running, is tracked, and caches."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "1.0")
    gc = []
    gpt = slow_gpt(0.4, gc, text=f"{rec.city}: {round(rec.total_cost_pln)} PLN in total.")
    req = asyncio.ensure_future(explain(rec, {}, model=gpt, lang="en"))
    await asyncio.sleep(0.1)
    req.cancel()
    with pytest.raises(asyncio.CancelledError):
        await req
    assert llm_cache.inflight() == 1  # held, visible to drain()
    await llm_cache.drain()
    assert any(k[0] == llm_cache.WHY for k in mem.d)


async def test_drain_with_timeout_cancels_what_is_left(rec, mem, monkeypatch):
    """Review #4: shutdown waits briefly, then cancels cleanly."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.1")
    gpt = slow_gpt(5.0, [], text="late")
    await explain(rec, {}, model=gpt, lang="en")
    assert llm_cache.inflight() == 1
    t = time.perf_counter()
    await llm_cache.drain(timeout=0.2)
    assert time.perf_counter() - t < 1.0 and llm_cache.inflight() == 0


def test_app_shutdown_drains_llm_calls():
    from fastapi.testclient import TestClient

    from tripai.api import create_app

    with TestClient(create_app()) as c:
        assert c.get("/health").status_code == 200
    assert llm_cache.inflight() == 0


async def test_budget_reads_again_on_a_new_utc_day(tmp_path, monkeypatch):
    """Nit: the "exhausted today" memo resets when the UTC day changes."""
    b = SerpApiBudget(daily_cap=1, root=tmp_path)
    reads = []

    async def remote(day):
        reads.append(day)
        return 1

    b._read_remote = remote  # type: ignore[method-assign]
    monkeypatch.setattr(SerpApiBudget, "_today", staticmethod(lambda: "2026-10-03"))
    with pytest.raises(BudgetExhausted):
        await b.take()
    with pytest.raises(BudgetExhausted):
        await b.take()
    assert reads == ["2026-10-03"]
    monkeypatch.setattr(SerpApiBudget, "_today", staticmethod(lambda: "2026-10-04"))

    async def fresh(day):
        reads.append(day)
        return 0

    b._read_remote = fresh  # type: ignore[method-assign]
    assert await b.take() == 1 and reads[-1] == "2026-10-04"


# ---------------------------------------------------------------- many items at once (t18b)


def _recs_many(candidates, profile, n):
    recs = rank(candidates, profile, limit=50, one_per_city=False)
    assert len(recs) >= n
    return recs[:n]


async def test_many_items_together_finish_at_the_deadline(candidates, profile, mem, monkeypatch):
    """12 fits + 8 explanations at once, more than the background limit (6), engines far slower
    than the deadline: the whole batch takes ~the deadline, not a multiple of it."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.5")
    monkeypatch.setenv("TRIPAI_LLM_MAX_BACKGROUND", "6")
    recs = _recs_many(candidates, profile, 12)
    jc, gc, ec = [], [], []
    jev, gpt = slow_jev(0.2, 0.3, jc), slow_gpt(3.0, gc)
    why = slow_gpt(3.0, ec, text="late text")
    t = time.perf_counter()
    out = await asyncio.gather(
        *(fit(r, profile, model=gpt, jev=jev) for r in recs),
        *(explain(r, {"food": 1.0}, model=why, lang="en") for r in recs[:8]),
    )
    took = time.perf_counter() - t
    assert len(out) == 20 and all(v.model == "rules" for v in out[:12])
    assert out[12:] == [template_why(r, {"food": 1.0}, "en") for r in recs[:8]]
    assert took < 1.2, took  # ~0.5 s deadline (+ margin), not 20 x 3 s or a serial chain
    assert llm_cache.inflight() <= 6  # the rest were cut off at the deadline, not queued


async def test_request_budget_counts_time_already_spent(rec, profile, mem, monkeypatch):
    """The AI items get only what is left of the request's budget after fetching prices."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "4.0")
    loop = asyncio.get_running_loop()
    llm_cache.start_request_budget(loop.time() - 0.7, total_s=1.0)  # 0.7 s already spent
    t = time.perf_counter()
    v = await fit(rec, profile, model=slow_gpt(3.0, []), jev=slow_jev(0.2, 0.3, []))
    took = time.perf_counter() - t
    assert v.model == "rules" and took < 0.8, took  # waited ~0.3 s, not the 4 s item deadline


async def test_reload_while_still_running_gets_the_fallback_at_once(rec, profile, mem, monkeypatch):
    """A repeat that finds this key still running for the earlier load doesn't wait again."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.3")
    gc = []
    gpt, jev = slow_gpt(1.5, gc), slow_jev(0.05, 0.3, [])
    await fit(rec, profile, model=gpt, jev=jev)  # cold: rules at 0.3 s, GPT keeps going
    t = time.perf_counter()
    again = await fit(rec, profile, model=gpt, jev=jev)  # reload while GPT is still running
    assert time.perf_counter() - t < 0.1 and again.model == "rules" and len(gc) == 1


async def test_repeat_after_background_is_served_from_cache(candidates, profile, mem, monkeypatch):
    """Cold batch (5 fits + 3 explanations) falls back at the deadline; once the background
    calls land, the same batch is answered from the cache with no new model calls."""
    monkeypatch.setenv("TRIPAI_LLM_TIMEOUT_S", "0.3")
    recs = _recs_many(candidates, profile, 5)
    jc, gc, ec = [], [], []
    jev, gpt = slow_jev(0.05, 0.3, jc), slow_gpt(0.8, gc)

    def why_model():
        async def fn(messages, info):
            ec.append(1)
            await asyncio.sleep(0.8)
            payload = json.loads(str(messages[-1].parts[-1].content).split("EVIDENCE:\n")[1]
                                 .split("\n\nLANGUAGE")[0])  # fmt: skip
            return ModelResponse(parts=[TextPart(f"{payload['city']}: {payload['total_cost']}.")])

        return FunctionModel(fn, model_name="why-slow")

    why = why_model()

    async def batch():
        return await asyncio.gather(*(fit(r, profile, model=gpt, jev=jev) for r in recs),
                                    *(explain(r, {}, model=why, lang="en") for r in recs[:3]))  # fmt: skip

    cold = await batch()
    assert all(v.model == "rules" for v in cold[:5])
    await llm_cache.drain()
    calls = (len(jc), len(gc), len(ec))
    clear_cache()  # a fresh process: only the persistent layer
    t = time.perf_counter()
    warm = await batch()
    assert time.perf_counter() - t < 0.15
    assert (len(jc), len(gc), len(ec)) == calls  # no new Jev/GPT calls
    # same verdict labels as the first load (stable), real texts for the explanations
    assert [v.label for v in warm[:5]] == [v.label for v in cold[:5]]
    assert [w for w in warm[5:]] == [f"{r.city}: {round(r.total_cost_pln)} PLN." for r in recs[:3]]
