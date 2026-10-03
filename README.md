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
| `POST /feedback` `{trip_id, answers, user_id?, profile?, weights?}` | the updated `TasteProfile` (top-level fields, as in the spec), plus `weights`, a `diff` saying what changed and why, and `profile` nested. With `personalize=false`, nothing changes: the `diff` is empty and `note` explains why |
| `POST /profile/dna` `{user_id, answers: {q1..q12: 1..5}, yes_no: {y1, y2}}` | Travel DNA (docs/TRAVEL_DNA.md): `{profile, weights, reasons[]}`. Deterministic; each reason lists its `because` card ids; a missing answer counts as 3 |
| `GET /health`, `GET /cities` | status / candidate cities |

- `tripai.scoring.rank()` is deterministic. Price (vs budget and vs the seasonal median), weather fit vs
  `preferred_temp_c`, crowds (lower is better) and taste fit (interests vs city tags) are combined
  with normalised weights. Each card carries counterfactuals (vs the same trip in peak season, the
  next-best window, the runner-up), a "what would flip it" hint and an `inputs_hash`: sha256 of the
  canonical inputs plus the scoring version.
- Fit verdict (docs/FIT_VERDICT.md, `tripai.agents.fit`): `POST /recommendations` attaches `fit` to the top
  `fit_top` cards (default 5, max 10), an AI second opinion against the
  user's Travel DNA. Each match/concern must cite existing DNA card ids and/or evidence indexes, and may only use
  numbers from the evidence it cites. Otherwise the agent retries, then falls back to deterministic rules
  (`model: "rules"`). Verdicts are cached by (model, inputs_hash, profile hash, card). With `personalize=false`
  the verdict is computed against a neutral DNA and labelled so. Agreement with 20 labelled cases:
  `uv run python -m tripai.agents.fit_eval` (`--no-llm` for rules only).
- The explain agent may only use numbers that appear in the evidence. An output validator rejects any
  other number (`ModelRetry`), and after the retries run out it falls back to the template.
- Flip hints are checked before they are shown: the suggested weight (2 dp, rounded away from the current
  value) or PLN increase is re-scored, and it must make the lower trip score strictly higher. A test applies
  every hint and asserts that the pair swaps.
- Known limits of the explain guard: it checks digits only, so number words ("two thousand") slip through,
  and small integers that also occur in the evidence (e.g. the trip length) are accepted in any context.
- `TasteProfile.personalize=false` (Travel DNA y2 = No): ranking uses neutral default weights (stored
  feedback weights are ignored; only an explicit slider `weights` overrides them). Interests act only as a filter
  (cities matching an interest >= 0.5; if none match, nothing is filtered), and each card's `interest_filter` receipt
  says which interests were used and which cities were dropped. The taste score is a neutral 0.5, but disliked
  tags still cost. `/feedback` never changes the profile. Retaking the DNA quiz updates only DNA-owned fields;
  budget, airports, temperature range, trip length and learned interests are kept.
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

## Jev decision layer (T1e): `tripai.agents.jev`

Jev (TypeSafe) answers typed questions with a calibrated confidence per field. It runs through pydantic-ai's
`TypeSafeModel` (`pydantic-ai-slim[typesafe]`, model `TRIPAI_JEV_MODEL`, default `jev-latest`). The key comes
from `TYPESAFE_API_KEY` or `TYPESAFEAI_API_KEY`, and `TRIPAI_JEV=0` turns it off. Jev only decides: it never
writes text, prices or scores. Every decision point has a deterministic fallback, so the demo works without a key.

- **Fit engine** `TRIPAI_FIT_ENGINE=jev|llm|rules`. Without the env var: jev if a TypeSafe key is set, else llm
  if an LLM key is set, else rules. Jev decides the label (an ordered 4-level rubric) and one yes/no per DNA check
  (`crowd_conflict`, `relax_conflict`, `budget_conflict`, `weather_conflict`, `pace_conflict`, `culture_match`,
  `active_match`, `novelty_match`). Every check that comes back yes (P >= 0.7) becomes a point. Its citations
  (DNA cards the user answered 4-5, plus evidence indexes) are set in code, not by a model. The LLM (or a
  template) then only *phrases* those points (`phrase_agent`): it must return the same number of points, and
  the grounding validator still applies. A label confidence below 0.6 becomes `mixed` + "We're not sure about
  this one; here's why". Fallback chain: jev -> llm -> rules. `FitVerdict.model` records both parts, e.g.
  `typesafe:jev-1.13.0+openai:gpt-6-luna`. `/health` shows `fit_engine` and `jev`.
- **Chat -> Travel DNA** `POST /interview/dna` (`tripai.agents.dna_chat`): Jev reads q1..q12 (1-5 or
  "not said") and y1 from the conversation. Answers with confidence >= 0.6 are kept. For the rest it asks a
  follow-up about the most important unsure card (at most 4), then stops. `answers` / `yes_no` have the same
  shape as the `POST /profile/dna` input. Without Jev, a scripted flow asks the cards and parses "so me" / "nie ja" / "4".
- **Guardrail** `guard(text)`: Jev's `prompt_injection` / `off_topic` (plus a regex fallback) check the user's
  free text before any LLM call (`/interview`, `/interview/dna`). Off-topic text is blocked only at confidence >= 0.6.
- **Notification gate** `jev_worth_interrupting(rec, profile) -> (push, p)` for T5b: push only if p >= 0.8.
  Without Jev, only a `great_fit` verdict passes.
- **Eval** `uv run python -m tripai.agents.fit_eval [--no-llm] [--no-jev]`: per case and per engine,
  agreement with the 20 labels, p50 latency, and estimated cost per verdict (from pydantic-ai/genai-prices
  usage). `jev raw` is Jev's label before the 0.6 gate.

## Live data (T5a): `LiveProvider` + Supabase persistence

`tripai.main` picks the provider from env: `TRIPAI_PROVIDER=live|fixture` wins; otherwise `fixture`
when `TRIPAI_USE_FIXTURES=1`, else `live`. `create_app()` without arguments (tests) stays on `FixtureProvider`.
`GET /health` reports the active `provider` and `store`.

**Per-source mode.** Each live source (`travelpayouts`, `serpapi`, `serper`, `open_meteo`, `gcal`) runs
`live` or `fixture`. `TRIPAI_FIXTURE_SOURCES=travelpayouts,gcal` (or `all`) pins sources to recorded fixtures while
the rest stay live. A source whose credentials are missing also uses fixtures (gcal needs `GOOGLE_CLIENT_ID/SECRET` + the
OAuth token file), so a missing key never crashes anything. `TRIPAI_USE_FIXTURES=1` puts every source on fixtures.
Fixture-served evidence is tagged `[recorded fixture]` (or `[synthetic fixture]` as before) and counts half in `confidence`.
Recorded fixtures only cover 14–19 Jan 2027, so for other dates a fixture source just contributes nothing. That counts as
*not available*, not as a failure: it is left out of `failures`, nothing is logged per call, and it has no effect on `confidence`
(which rates only the evidence a card carries). Each request logs one INFO summary
(`fixtures without coverage: travelpayouts x28, ...; SerpApi capped: n; failures: k`), and the counts are in
`LiveProvider.last_stats["uncovered"]` and `["capped"]`.
`GET /health` → `"sources": {"travelpayouts": "live", "serpapi": "fixture", ...}`. With gcal live, `/windows` and
the default `/recommendations` use real Google Calendar free/busy. On any error they fall back to the demo calendar, never an empty one.

**Warm the cache before a demo:** `uv run python -m tripai.warm [--today YYYY-MM-DD] [--skip-calendar] [--profile p.json]`
runs the demo queries through the real app: KRK, the demo profile, the next 3 long weekends (one per holiday), plus the default
calendar request. It uses the same env-driven source modes, an in-memory store and no LLM. It prints the source modes, timings,
SerpApi lookups and the top 5 with their confidence, and exits non-zero on a failed query. With `SUPABASE_*` set it fills the shared
`api_cache`, so the Railway instance starts warm too.

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

**SerpApi spend is capped.** The daily cap is `TRIPAI_SERPAPI_DAILY_CAP`, default 30. Every process and the warm CLI share it
through a counter row in Supabase `api_cache` (`source=tripai:budget`, no schema change) plus a disk copy. Each request is
also capped by `TRIPAI_SERPAPI_REQUEST_CAP`, default 7. Only real searches count: cache hits are free. Past a cap, the same request is
answered from the recorded fixture if there is one (tagged `[recorded fixture]`), otherwise the cheap estimates stay. `GET /health` →
`serpapi_budget: {day, used, daily_cap, request_cap}`.

Every number is an `Evidence` with `source` + `fetched_at`. Synthetic fixtures keep `[synthetic fixture]`.
Extra evidence kinds: `confidence` (0..1, the mean of the per-factor data quality, and the label says what each
factor is based on), `photo` (value = image URL; see the contract proposal in the PR), `holiday`, `price_baseline`.
A failing connector drops its evidence and lowers `confidence`. A city or option that errors, or has no price or no weather, is
dropped on its own. If nothing at all comes back, `/recommendations` answers **503**, never synthetic numbers posing as live data.
`TRIPAI_LIVE_FALLBACK=1` opts into labelled `FixtureProvider` candidates instead. Peak-season numbers carry
`Evidence(kind="peak")`: the fare, the temperature and the crowd level.

Peak-season counterfactuals need Travelpayouts fares for the city's peak month. Those are often missing
months ahead, and then the card simply has no peak counterfactual.

**Sessions, not `user_id`s.** The API ignores any client-sent `user_id`. Each response carries a server-issued, HMAC-signed
token in the `X-TripAI-Session` header and an HttpOnly cookie (`tripai.api.session`). Clients send the header back. A missing or forged
token gets a fresh session, so nobody can read or overwrite another user's profile, weights, recommendations or feedback.
Recommendations are looked up by `(user_id, id)`. Set `TRIPAI_SESSION_SECRET` in prod: without it the secret is random per process,
and sessions reset on restart.

`tripai.api.supabase_store.SupabaseStore` (when `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set; `TRIPAI_STORE=memory`
opts out) writes profiles + weights, recommendations (`inputs_hash`, rank, full payload) and feedback
(`answers` + `diff`) through PostgREST. Memory stays the primary copy. Writes go out on one background thread,
in order. Reads fall back to Supabase on a miss in a worker thread, never on the event loop, and empty reads are remembered for 60 s. The `Store` protocol is async. Errors are logged and never fail a request.
