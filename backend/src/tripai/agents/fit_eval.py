"""Agreement of the fit verdict with hand-labelled cases (docs/FIT_VERDICT.md "Verifiability").

    uv run python -m tripai.agents.fit_eval [cases.json] [--no-llm]

Prints LLM-vs-labels (if an LLM key is configured) and rules-vs-labels agreement.
"""

import argparse
import asyncio
import json
import sys
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_ai.models import Model

from tripai.agents.fit import LABELS, clear_cache, fit, rules_verdict
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
    llm: str | None = None


class Report(BaseModel):
    rows: list[Row]
    model: str | None
    rules_exact: int
    rules_within_one: int
    llm_exact: int | None = None
    llm_within_one: int | None = None


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


async def evaluate(
    cases: list[Case], model: Model | str | None = None, use_llm: bool | None = None
) -> Report:
    use_llm = (model is not None or llm_enabled()) if use_llm is None else use_llm
    clear_cache()
    rows: list[Row] = []
    for case in cases:
        profile = case_profile(case)
        rec = await case_recommendation(case, profile)
        rules = rules_verdict(rec, profile).label
        llm = None
        if use_llm:
            verdict = await fit(rec, profile, model=model)
            llm = verdict.label if verdict.model != "rules" else f"{verdict.label}*"
        rows.append(Row(id=case.id, label=case.label, rules=rules, llm=llm))

    def score(pred: str) -> tuple[int, int]:
        ok = [(r.label, getattr(r, pred).rstrip("*")) for r in rows if getattr(r, pred)]
        return sum(a == b for a, b in ok), sum(_within_one(a, b) for a, b in ok)

    rex, r1 = score("rules")
    report = Report(rows=rows, model=None, rules_exact=rex, rules_within_one=r1)
    if use_llm:
        report.model = model if isinstance(model, str) else getattr(model, "model_name", None)
        report.model = report.model or model_name()
        report.llm_exact, report.llm_within_one = score("llm")
    return report


def _mark(pred: str | None, label: str) -> str:
    return "" if pred is None else ("ok" if pred.rstrip("*") == label else "x")


def format_report(report: Report) -> str:
    n = len(report.rows)
    head = f"{'case':<28} {'label':<10} {'rules':<13} {'AI':<13}"
    lines = [head, "-" * len(head)]
    for r in report.rows:
        lines.append(
            f"{r.id:<28} {r.label:<10} {r.rules:<10}{_mark(r.rules, r.label):<3} "
            f"{(r.llm or '-'):<10}{_mark(r.llm, r.label)}"
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
        if any(r.llm and r.llm.endswith("*") for r in report.rows):
            lines.append("* the agent failed on this case and the rules fallback was used")
    else:
        lines.append("AI: skipped (no LLM key for TRIPAI_MODEL, or --no-llm)")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv

    load_dotenv()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cases", nargs="?", type=Path, default=DEFAULT_CASES)
    ap.add_argument("--no-llm", action="store_true", help="rules only")
    args = ap.parse_args(argv)
    report = asyncio.run(evaluate(load_cases(args.cases), use_llm=False if args.no_llm else None))
    print(format_report(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
