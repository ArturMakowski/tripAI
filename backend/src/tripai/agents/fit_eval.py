"""Agreement of the fit verdict with hand-labelled cases (docs/FIT_VERDICT.md "Verifiability").

    uv run python -m tripai.agents.fit_eval [cases.json] [--no-llm] [--no-jev]

Prints per-case labels and, per engine (jev / llm / rules), agreement with the hand labels,
p50 latency and estimated cost per verdict. Jev runs if a TypeSafe key is set, the LLM if its key is.
"""

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_ai.models import Model

from tripai.agents.fit import LABELS, clear_cache, fit_run, rules_verdict
from tripai.agents.jev import jev_enabled, jev_model_name
from tripai.agents.llm import llm_enabled, model_name
from tripai.models import FreeWindow, TasteProfile, Weights
from tripai.scoring import FixtureProvider, rank
from tripai.scoring.types import RankedRecommendation

DEFAULT_CASES = Path(__file__).resolve().parents[3] / "tests" / "fit_eval" / "cases.json"


class Offer(BaseModel):
    iata: str
    start: date
    end: date


class Case(BaseModel):
    id: str
    answers: dict[str, int] = Field(default_factory=dict)
    yes_no: dict[str, bool] = Field(default_factory=dict)
    profile: dict = Field(default_factory=dict)
    offer: Offer
    label: str
    why: str = ""


class Row(BaseModel):
    id: str
    label: str
    rules: str
    llm: str | None = None  # "*" suffix: that engine failed and a fallback answered
    cascade: str | None = None  # the jev engine: Jev, or the LLM when Jev escalated ("^" suffix)
    jev_raw: str | None = None  # Jev's own label, whatever its confidence


class EngineStats(BaseModel):
    engine: str
    model: str
    exact: int
    within_one: int
    n: int
    p50_ms: float
    cost_usd: float | None = None  # mean per verdict; None if the provider reports no price
    fallbacks: int = 0
    escalated: int | None = None  # cascade only: cases Jev handed to the LLM


class Report(BaseModel):
    rows: list[Row]
    model: str | None
    rules_exact: int
    rules_within_one: int
    llm_exact: int | None = None
    llm_within_one: int | None = None
    cascade_exact: int | None = None
    cascade_within_one: int | None = None
    engines: list[EngineStats] = Field(default_factory=list)


def load_cases(path: Path = DEFAULT_CASES) -> list[Case]:
    return [Case(**c) for c in json.loads(path.read_text())["cases"]]


def case_profile(case: Case) -> TasteProfile:
    traits = {q: float(a) for q, a in case.answers.items()}
    extra = dict(case.profile)
    personalize = extra.pop("personalize", case.yes_no.get("y2", True))
    return TasteProfile(
        user_id=f"eval:{case.id}",
        traits=traits,
        daily_discovery=case.yes_no.get("y1"),
        personalize=personalize,
        **extra,
    )


async def case_recommendation(case: Case, profile: TasteProfile) -> RankedRecommendation:
    window = FreeWindow(start=case.offer.start, end=case.offer.end)
    cands = await FixtureProvider().candidates("KRK", [window], profile.luxury)
    cands = [c for c in cands if c.iata == case.offer.iata]
    if not cands:
        raise ValueError(f"{case.id}: no fixture offer for {case.offer.iata}")
    return rank(cands, profile, Weights())[0]


def _within_one(a: str, b: str) -> bool:
    return abs(LABELS.index(a) - LABELS.index(b)) <= 1


def _model_label(model: Model | str | None, default: str) -> str:
    return model if isinstance(model, str) else getattr(model, "model_name", None) or default


async def evaluate(
    cases: list[Case],
    model: Model | str | None = None,
    use_llm: bool | None = None,
    *,
    jev: Model | None = None,
    use_jev: bool | None = None,
) -> Report:
    """Run every case through rules, the LLM engine and the Jev engine (each when available)."""
    use_llm = (model is not None or llm_enabled()) if use_llm is None else use_llm
    use_jev = (jev is not None or jev_enabled()) if use_jev is None else use_jev
    clear_cache()
    rows: list[Row] = []
    ms: dict[str, list[float]] = {"rules": [], "llm": [], "cascade": [], "jev_raw": []}
    cost: dict[str, list[float | None]] = {"rules": [], "llm": [], "cascade": [], "jev_raw": []}
    fallbacks = {"llm": 0, "cascade": 0}
    escalated = 0
    for case in cases:
        profile = case_profile(case)
        rec = await case_recommendation(case, profile)
        t0 = time.perf_counter()
        row = Row(id=case.id, label=case.label, rules=rules_verdict(rec, profile).label)
        ms["rules"].append((time.perf_counter() - t0) * 1000)
        cost["rules"].append(0.0)
        for col, engine, on in (("llm", "llm", use_llm), ("cascade", "jev", use_jev)):
            if not on:
                continue
            run = await fit_run(rec, profile, model=model, engine=engine, jev=jev,
                                phrase=use_llm)  # fmt: skip
            ok = run.engine == engine
            fallbacks[col] += not ok
            escalated += run.escalated
            mark = "" if ok else "*"
            setattr(row, col, run.verdict.label + ("^" if run.escalated else mark))
            ms[col].append(run.latency_ms)
            cost[col].append(run.cost_usd)
            if run.jev is not None:  # the decision alone: no phrasing, no gate
                row.jev_raw = run.jev.output.label_name
                ms["jev_raw"].append(run.jev.latency_ms)
                cost["jev_raw"].append(run.jev.cost_usd)
        rows.append(row)

    def score(pred: str) -> tuple[int, int]:
        ok = [(r.label, getattr(r, pred).rstrip("*^")) for r in rows if getattr(r, pred)]
        return sum(a == b for a, b in ok), sum(_within_one(a, b) for a, b in ok)

    llm_name = _model_label(model, model_name())
    phraser = llm_name if use_llm else "template"
    names = {"rules": "rules", "llm": llm_name,
             "cascade": f"typesafe:{_model_label(jev, jev_model_name())}\u2192{llm_name if use_llm else 'rules'} (phrasing: {phraser})",
             "jev_raw": f"typesafe:{_model_label(jev, jev_model_name())} (decision only)"}  # fmt: skip
    stats = []
    for engine in ("cascade", "jev_raw", "llm", "rules"):
        if not ms[engine]:
            continue
        exact, within = score(engine)
        known = [c for c in cost[engine] if c is not None]
        stats.append(
            EngineStats(
                engine=engine,
                model=names[engine],
                exact=exact,
                within_one=within,
                n=len(rows),
                p50_ms=round(statistics.median(ms[engine]), 1),
                cost_usd=sum(known) / len(known) if known else None,
                fallbacks=fallbacks.get(engine, 0),
                escalated=escalated if engine == "cascade" else None,
            )
        )

    rex, r1 = score("rules")
    report = Report(rows=rows, model=None, rules_exact=rex, rules_within_one=r1, engines=stats)
    if use_llm:
        report.model = llm_name
        report.llm_exact, report.llm_within_one = score("llm")
    if use_jev:
        report.cascade_exact, report.cascade_within_one = score("cascade")
    return report


def _mark(pred: str | None, label: str) -> str:
    return "" if pred is None else ("ok" if pred.rstrip("*^") == label else "x")


def _pct(k: int | None, n: int) -> str:
    return "" if k is None or not n else f"{k}/{n} ({100 * k / n:.0f}%)"


def _usd(c: float | None) -> str:
    return "n/a" if c is None else f"${c:.6f}"


def format_report(report: Report) -> str:
    n = len(report.rows)
    head = f"{'case':<28} {'label':<10} {'rules':<13} {'AI':<13} {'cascade':<13} {'jev raw':<13}"
    lines = [head, "-" * len(head)]
    for r in report.rows:
        lines.append(
            f"{r.id:<28} {r.label:<10} {r.rules:<10}{_mark(r.rules, r.label):<3} "
            f"{(r.llm or '-'):<10}{_mark(r.llm, r.label):<3} "
            f"{(r.cascade or '-'):<10}{_mark(r.cascade, r.label):<3} "
            f"{(r.jev_raw or '-'):<10}{_mark(r.jev_raw, r.label)}"
        )
    lines.append("")
    lines.append(
        f"rules vs labels: {report.rules_exact}/{n} exact, {report.rules_within_one}/{n} within one"
    )
    if report.llm_exact is not None:
        lines.append(
            f"AI ({report.model}) vs labels: {report.llm_exact}/{n} exact, "
            f"{report.llm_within_one}/{n} within one"
        )
    else:
        lines.append("AI: skipped (no LLM key for TRIPAI_MODEL, or --no-llm)")
    if report.cascade_exact is None:
        lines.append("jev: skipped (no TYPESAFE_API_KEY / TYPESAFEAI_API_KEY, or --no-jev)")
    if any(x and x.endswith("*") for r in report.rows for x in (r.llm, r.cascade)):
        lines.append("* that engine failed on this case and the next one in the chain answered")
    if any(r.cascade and r.cascade.endswith("^") for r in report.rows):
        lines.append("^ Jev was unsure (label p < escalate threshold) and the LLM decided")
    if report.engines:
        lines += ["", "cascade = Jev decides, escalates to the LLM when unsure; jev raw = Jev's label always",
                  "", "| engine | model | exact | within one | p50 latency | est. cost / verdict | escalated |",
                  "|---|---|---|---|---|---|---|"]  # fmt: skip
        for e in report.engines:
            fb = f" ({e.fallbacks} fallbacks)" if e.fallbacks else ""
            lines.append(
                f"| {e.engine} | {e.model} | {e.exact}/{e.n}{fb} | {e.within_one}/{e.n} | "
                f"{e.p50_ms:.0f} ms | {_usd(e.cost_usd)} | {_pct(e.escalated, e.n)} |"
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv

    load_dotenv()
    os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cases", nargs="?", type=Path, default=DEFAULT_CASES)
    ap.add_argument(
        "--no-llm", action="store_true", help="skip the LLM engine (jev phrases by template)"
    )
    ap.add_argument("--no-jev", action="store_true", help="skip the Jev engine")
    args = ap.parse_args(argv)
    report = asyncio.run(
        evaluate(
            load_cases(args.cases),
            use_llm=False if args.no_llm else None,
            use_jev=False if args.no_jev else None,
        )
    )
    print(format_report(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
