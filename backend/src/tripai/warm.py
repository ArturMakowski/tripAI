"""Pre-run the demo queries so the cache (disk + Supabase `api_cache`) is warm before a demo:

    uv run python -m tripai.warm                     # KRK, demo profile: next 3 long weekends + calendar
    uv run python -m tripai.warm --skip-calendar --today 2026-10-03

Uses the same provider/calendar selection as the API (TRIPAI_PROVIDER, TRIPAI_FIXTURE_SOURCES, keys
from .env), runs the requests through the real app with an in-memory store (no profile rows written)
and `explain_top=0` (no LLM spend). Exits non-zero if any query fails.
"""

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from tripai.connectors import config

DEMO_PROFILE = {
    "user_id": "demo",
    "origin_airports": ["KRK"],
    "budget_pln": 2500,
    "interests": {"food": 0.9, "history": 0.7},
}


def _queries(today: date, profile: dict, skip_calendar: bool) -> list[tuple[str, dict]]:
    from tripai.scoring import long_weekends

    # one window per holiday (the longest variant), the next three by date
    best: dict[tuple, object] = {}
    for b in long_weekends(today, today + timedelta(days=365), max_leave=2):
        if b.window.start <= today:
            continue
        key = tuple(h.date for h in b.holidays) or (b.window.start,)
        if key not in best or b.total_days > best[key].total_days:
            best[key] = b
    weekends = sorted(best.values(), key=lambda b: b.window.start)[:3]
    base = {"profile": profile, "explain_top": 0, "today": today.isoformat()}
    out = [
        (
            "long weekends: " + ", ".join(b.label for b in weekends),
            {**base, "windows": [b.window.model_dump(mode="json") for b in weekends]},
        )
    ]
    if not skip_calendar:
        out.append(("calendar free windows + radar (default request)", base))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m tripai.warm", description=__doc__.split("\n")[0])
    ap.add_argument("--today", type=date.fromisoformat, default=None)
    ap.add_argument("--profile", help="JSON file with a TasteProfile (default: demo profile)")
    ap.add_argument("--skip-calendar", action="store_true", help="only the long-weekend query")
    args = ap.parse_args(argv)

    config.load_dotenv_files()
    from fastapi.testclient import TestClient

    from tripai.api import create_app
    from tripai.api.state import MemoryStore
    from tripai.live import calendar_from_env, provider_from_env
    from tripai.scoring.windows import TZ

    provider, calendar = provider_from_env(), calendar_from_env()
    client = TestClient(create_app(provider=provider, calendar=calendar, store=MemoryStore()))
    health = client.get("/health").json()
    print("sources:", json.dumps(health["sources"]))
    print("serpapi budget:", json.dumps(health.get("serpapi_budget")))
    if not hasattr(provider, "source_modes"):
        print("provider is FixtureProvider (TRIPAI_PROVIDER/TRIPAI_USE_FIXTURES): nothing to warm")
        return 0

    profile = json.loads(Path(args.profile).read_text()) if args.profile else DEMO_PROFILE
    today = args.today or datetime.now(TZ).date()
    failed = 0
    for name, body in _queries(today, profile, args.skip_calendar):
        t = time.time()
        r = client.post("/recommendations", json=body)
        stats = getattr(provider, "last_stats", {})
        print(f"\n== {name}\n   HTTP {r.status_code} in {time.time() - t:.1f}s; "
              f"serpapi searches {stats.get('serpapi_network')} (lookups {stats.get('serpapi_calls')}), refined {len(stats.get('refined', []))}, "
              f"failures {len(stats.get('failures', []))}"
              + (f", FALLBACK {stats['fallback']}" if stats.get("fallback") else ""))  # fmt: skip
        if r.status_code != 200:
            failed += 1
            print("  ", r.text[:300])
            continue
        for rec in r.json()[:5]:
            conf = next((e["value"] for e in rec["evidence"] if e["kind"] == "confidence"), None)
            print(f"   #{rec['rank']} {rec['city']:<20} {rec['window']['start']}..{rec['window']['end']}"
                  f"  {rec['total_cost_pln']:>6.0f} PLN  score {rec['score']['total']:.2f}"
                  f"  confidence {conf}")  # fmt: skip
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
