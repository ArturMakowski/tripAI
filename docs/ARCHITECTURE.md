# Architecture

End-to-end walkthrough (flow, data, what the AI sees): [HOW_IT_WORKS.md](HOW_IT_WORKS.md).

```
browser ──▶ frontend (Next.js, mobile-first, Railway)
              └─ same-origin /api proxy (server-side, adds X-TripAI-Internal-Key)
                   │  Railway private network only; the backend has no public URL
                   ▼
            backend (FastAPI, Python 3.12, uv)
              ├─ api/        routes: recommendations (fast|full), profile/dna, windows, reactions, trips, picks,
              │              notifications, push, scan, places, session
              ├─ scoring/    deterministic ranking (price, weather, crowds, taste) + budget fit + value + party money
              ├─ agents/     pydantic-ai: fit verdict (Jev → GPT → rules), "why" text, LLM answer cache
              ├─ live/       live provider: candidates, exact-date refinement, SerpApi budget, places, trip details
              ├─ connectors/ SerpApi (Google Flights/Hotels/Explore), Travelpayouts, Open-Meteo, Serper, routes
              ├─ seed/       Eurostat crowds, holidays, cities, airports → data/*.json
              ├─ notify/     rules + inbox/web push
              └─ workflows/  DBOS: daily 07:00 proactive scan
Supabase Postgres (RLS on, no anon policies): profiles, trips, saved_picks, recommendations, reactions,
notifications, notification_prefs, push_subscriptions, scan_runs, feedback, api_cache
```

## Pipeline: `POST /recommendations?phase=fast|full`
1. Windows: the dates you picked (or the pre-filled next long weekend); `GET /windows/long-weekends` for the radar.
2. Candidates: seed city list × windows × your airports (grouped per city, one metered call per city).
3. Prices: fast = cache + Travelpayouts + seed estimates; full = exact-date Google Flights/Hotels for the top picks
   (shared daily SerpApi cap), plus weather, crowds, photos.
4. `scoring.rank()` → ranked recommendations with `ScoreBreakdown` + `Evidence[]`, budget status, value badges.
5. Full phase only: fit verdict + "why" text (AI), within one request time budget; late answers fall back to rules /
   template and are cached for the next load.

## API
The current route list and payloads live in the backend README; the shared contract is `backend/src/tripai/models.py`
(mirrored in `frontend/lib/types.ts`).

## Ownership (parallel workers stay in their lane)
| Lane | Owns |
|---|---|
| core | `backend/src/tripai/{scoring,agents,api}`, `backend/src/tripai/main.py`, `supabase/` |
| connectors | `backend/src/tripai/connectors/`, `backend/tests/fixtures/` |
| seed | `backend/src/tripai/seed/`, `data/` |
| frontend | `frontend/` |
| shared (president only / dedicated PR) | `backend/src/tripai/models.py`, `backend/pyproject.toml` deps, `docs/` |
New deps: add with `uv add` in your PR; expect a trivial rebase on `pyproject.toml`/`uv.lock`.
