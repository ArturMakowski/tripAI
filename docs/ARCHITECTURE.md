# Architecture

```
frontend (Next.js, mobile-first)  ──HTTP/JSON──▶  backend (FastAPI)
                                                    ├─ agents/   pydantic-ai: interview → TasteProfile; explain(); replan()
                                                    ├─ scoring/  deterministic ranking (price, weather, crowds, taste fit) + weights slider
                                                    ├─ connectors/ SerpApi explore/flights/hotels, Travelpayouts, Open-Meteo, GCal freebusy
                                                    ├─ seed/     Eurostat crowds, holidays, attractions, airports → data/*.json
                                                    └─ workflows (DBOS): proactive scan = free windows × candidates → fetch → score → notify
Supabase: profiles, trips, recommendations, api_cache(source, key, payload, fetched_at), feedback
```

## Pipeline: `recommend(profile, windows, weights)`
1. Free windows: GCal freebusy (or manual dates).
2. Candidates: SerpApi Travel Explore from origin + seed city list.
3. For each (city, window): flight price (Travelpayouts calendar → SerpApi price_insights for top N),
   hotel price, climate (Open-Meteo), crowd score (Eurostat seed), holidays, attractions matching tags.
4. `scoring.rank()` → `Recommendation[]` with `ScoreBreakdown` + `Evidence[]`.
5. Agent writes the `why` text **only from the evidence given** (no new numbers).

## API (v0)
- `POST /interview` `{messages}` → `{reply, profile?: TasteProfile}`
- `GET  /windows?from&to` → `FreeWindow[]`
- `POST /recommendations` `{profile, windows?, weights}` → `Recommendation[]`
- `POST /feedback` `{trip_id, answers}` → updated `TasteProfile`
- `POST /replan` `{trip_id, disruption}` → `Recommendation` (stretch)

## Ownership (parallel workers stay in their lane)
| Lane | Owns |
|---|---|
| core | `backend/src/tripai/{scoring,agents,api}`, `backend/src/tripai/main.py`, `supabase/` |
| connectors | `backend/src/tripai/connectors/`, `backend/tests/fixtures/` |
| seed | `backend/src/tripai/seed/`, `data/` |
| frontend | `frontend/` |
| shared (president only / dedicated PR) | `backend/src/tripai/models.py`, `backend/pyproject.toml` deps, `docs/` |
New deps: add with `uv add` in your PR; expect a trivial rebase on `pyproject.toml`/`uv.lock`.
