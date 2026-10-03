# TripAI

Proactive AI travel planner (HackYeah 2026): from your taste, budget and free days it recommends **where and when** to go, with a sourced, reproducible score.

## Hosted
| | URL |
|---|---|
| App (frontend) | https://frontend-production-11c11.up.railway.app |
| API (backend) | https://backend-production-f17bd.up.railway.app/docs |

Both are Railway services in project `tripai`; the backend deploys automatically from `main`.

## Run locally (for devs)
Prerequisites: [uv](https://docs.astral.sh/uv/), Node 20+, git.

```bash
git clone https://github.com/ArturMakowski/tripAI.git && cd tripAI
cp .env.example .env            # optional: fill keys (ask Artur); without keys everything runs on recorded fixtures

# backend → http://localhost:8000/docs
cd backend && uv sync && uv run uvicorn tripai.main:app --reload

# frontend (second terminal) → http://localhost:3000
cd frontend && npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
#   or against the hosted API:  NEXT_PUBLIC_API_URL=https://backend-production-f17bd.up.railway.app npm run dev
#   or no backend at all (in-browser demo data):  npm run dev
```

Tests: `cd backend && uv run pytest && uv run ruff check .` · `cd frontend && npm test && npm run build`

Docs: [concept](docs/CONCEPT.md) · [architecture](docs/ARCHITECTURE.md) · [data sources](docs/DATA_SOURCES.md) · [competitors](docs/COMPETITORS.md) · [backlog](docs/BACKLOG.md)


## Backend core (T1): scoring, agents, API

```bash
cd backend
uv run uvicorn tripai.main:app --reload     # http://localhost:8000/docs
uv run pytest && uv run ruff check .   # (ruff format --check also flags shared models.py, pre-existing)
```

Works offline: without the model provider's key, the interview runs a scripted 3-question flow and
explanations use a deterministic template. With the key set (e.g. `OPENAI_API_KEY`), pydantic-ai agents are used
(`TRIPAI_MODEL`: any pydantic-ai model string, default `openai:gpt-6-luna`; `TRIPAI_LLM=0` forces them off).

| Endpoint | What |
|---|---|
| `POST /interview` `{messages, user_id}` | `{reply, profile?}`; the profile arrives when the interview is done |
| `GET /windows?from&to&min_days` | free windows from the calendar provider (fixture: 9-17 office job, PL holidays off) |
| `POST /windows` `{from, to, busy[], min_days}` | free windows from explicit busy intervals |
| `GET /windows/long-weekends?from&to&max_leave` | długi weekend radar: "Take 1 day off (Fri 28 May) -> 4 days" |
| `POST /recommendations` `{profile, windows?, weights?, limit, explain_top, today?}` | ranked `RankedRecommendation[]` |
| `POST /feedback` `{trip_id, answers, user_id?, profile?, weights?}` | the updated `TasteProfile` (top-level fields, as in the spec), plus `weights`, a `diff` saying what changed and why, and `profile` nested |
| `GET /health`, `GET /cities` | status / candidate cities |

- `tripai.scoring.rank()` is deterministic. Price (vs budget and vs the seasonal median), weather fit vs
  `preferred_temp_c`, crowds (lower is better) and taste fit (interests vs city tags) are combined
  with normalised weights. Each card carries counterfactuals (vs the same trip in peak season, the
  next-best window, the runner-up), a "what would flip it" hint and an `inputs_hash`: sha256 of the
  canonical inputs plus the scoring version.
- The explain agent may only use numbers that appear in the evidence. An output validator rejects any
  other number (`ModelRetry`), and after the retries run out it falls back to the template.
- Flip hints are checked before they are shown: the suggested weight (2 dp, rounded away from the current
  value) or PLN increase is re-scored, and it must make the lower trip score strictly higher. A test applies
  every hint and asserts that the pair swaps.
- Known limits of the explain guard: it checks digits only, so number words ("two thousand") slip through,
  and small integers that also occur in the evidence (e.g. the trip length) are accepted in any context.
- Connector seam: `tripai.scoring.provider.TripDataProvider` / `CalendarProvider` (Protocols).
  `FixtureProvider` serves 10 cities from KRK; its evidence is labelled `fixture:*`. Pass a live
  provider with `create_app(provider=...)`.
- Holidays come from `data/holidays_pl.json` / `data/holidays.json` (Nager.Date format) when present,
  otherwise from the built-in PL table (computed from Easter, incl. Wigilia).
- `supabase/migrations/0001_init.sql`: profiles, recommendations, trips, feedback, api_cache
  (`source, cache_key, payload, fetched_at, expires_at`). RLS is enabled on every table with no
  anon/authenticated policies: only the backend connects, using `SUPABASE_URL` + `SUPABASE_SECRET_KEY`
  (server only). Wired by T5a (`SupabaseStore`, see below); without those env vars the API uses an
  in-memory `Store`.

## Live data (T5a): `LiveProvider` + Supabase persistence

`tripai.main` picks the provider from env: `TRIPAI_PROVIDER=live|fixture` wins; otherwise `fixture`
when `TRIPAI_USE_FIXTURES=1`, else `live`. `create_app()` without arguments (tests) stays on `FixtureProvider`.
`GET /health` reports the active `provider` and `store`.

`tripai.live.LiveProvider` (seed + connectors), per `/recommendations` call:
1. **Shortlist** `TRIPAI_LIVE_MAX_CITIES` (default 12) of the ~36 seed cities by taste fit (+ direct route from the origin). No I/O.
2. **Cheap pass** for every (city, window): Travelpayouts month calendar (free; exact departure day,
   else nearest ±3 days, else month median), else one Google Travel Explore call for all cities;
   hotel nightly from Explore, else a labelled editorial estimate (`estimate:tripai-editorial`);
   weather from Open-Meteo month normals; crowds from the Eurostat seed; local holidays, PL school
   breaks, attractions (highlights) and a Wikimedia photo from the seed.
3. **Refine** the top `TRIPAI_LIVE_TOP_N` (default 3) by the real scorer with exact-date SerpApi
   Google Flights (price + price level, typical range as the deal baseline) and Google Hotels
   (quantile by luxury level: 25/50/75/90th percentile), exact-window Open-Meteo and a Serper photo.
   Re-rank and repeat until the top N are all refined, at most `TRIPAI_LIVE_MAX_REFINE` (default 6) in total.
   Worst case is 1 + 2×6 = 13 SerpApi calls per cold request; repeats come from the cache (disk + Supabase `api_cache`).

Every number is an `Evidence` with `source` + `fetched_at`. Synthetic fixtures keep `[synthetic fixture]`.
Extra evidence kinds: `confidence` (0..1, the mean of the per-factor data quality, and the label says what each
factor is based on), `photo` (value = image URL; see the contract proposal in the PR), `holiday`, `price_baseline`.
A failing connector drops its evidence and lowers `confidence`. A city with no price or no weather is
skipped. If nothing at all comes back, the provider serves `FixtureProvider` candidates (`fixture:*`). It never returns a 500.

Peak-season counterfactuals need Travelpayouts fares for the city's peak month. Those are often missing
months ahead, and then the card simply has no peak counterfactual.

`tripai.api.supabase_store.SupabaseStore` (when `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set; `TRIPAI_STORE=memory`
opts out) writes profiles + weights, recommendations (`inputs_hash`, rank, full payload) and feedback
(`answers` + `diff`) through PostgREST. Memory stays the primary copy. Writes go out on one background thread,
in order, and reads fall back to Supabase on a miss. Errors are logged and never fail a request.
