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
- Weather fit peaks at the middle of `preferred_temp_c` and falls to 0.75 at its edges, then by 0.08 per °C outside
  (0.16 with a heat/cold dislike). Rainy-day share and sunshine hours scale it down when the provider has them.
- `FixtureProvider` numbers are hand-curated: evidence `source` is `fixture:sample`, shown as "TripAI sample data"
  with no fetch time. "(recorded)" is reserved for real recorded API responses.
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
  if an LLM key is set, else rules. The jev engine is a **cascade (System 1 -> System 2)**:
  - Jev decides the label (an ordered 4-level rubric) and one yes/no per DNA check (`crowd_conflict`,
    `relax_conflict`, `budget_conflict`, `weather_conflict`, `pace_conflict`, `culture_match`,
    `active_match`, `novelty_match`).
  - **Jev confident** (label confidence >= `TRIPAI_JEV_ESCALATE_BELOW`, default 0.5): Jev's decision stands.
    Every check that comes back yes (P >= 0.7) becomes a point. Code sets its citations (DNA cards the user
    answered 4-5, plus evidence indexes). GPT (or a template) only *phrases* those points; it must return the
    same number of points, and the grounding validator still applies. `model` = `typesafe:jev-1.13.0`, or
    `typesafe:jev-1.13.0+openai:gpt-6-luna` when GPT did the wording. `confidence` = Jev's.
  - **Jev unsure**: the *decision* escalates to the GPT fit agent, under the same grounding validator, and
    then to rules if GPT fails. `model` = `typesafe:jev-1.13.0→openai:gpt-6-luna (escalated, jev p=0.38;
    confidence self-rated)`. `confidence` is GPT's self-rated one. If that is < 0.6, the verdict shows as
    `mixed` + "We're not sure about this one; here's why".
  - If Jev itself errors, the chain is llm -> rules. Escalations are cached like any verdict. Fallbacks and
    failed phrasing are not cached, so the next request retries them.
  - `POST /recommendations` computes the top-N fits concurrently. `/health` shows `fit_engine` and `jev`.
- **Chat -> Travel DNA** `POST /interview/dna` (`tripai.agents.dna_chat`): Jev reads q1..q12 (1-5 or
  "not said") and y1 from the conversation. Answers with confidence >= 0.6 are kept; a direct reply to a card
  question ("so me") always wins. For the rest it asks a
  follow-up about the most important unsure card (at most 4), then stops. `answers` / `yes_no` have the same
  shape as the `POST /profile/dna` input. Without Jev, a scripted flow asks the cards and parses "so me" / "nie ja" / "4".
- **Guardrail** `guard(text)` / `screen(texts)`: Jev's `prompt_injection` / `off_topic` (plus a regex fallback)
  check **every** message of the conversation before any LLM call (`/interview`, `/interview/dna`). This
  covers every message because the client resends history and sets `role`. Blocked messages are dropped from
  the transcript on every later turn. Results are cached by text. Off-topic text is blocked only at confidence >= 0.6.
- **Notification gate** `jev_worth_interrupting(rec, profile) -> (push, p)`: push only if p >= 0.8. This is a
  library function **not called yet**: T5b's proactive scan should call it before every push.
  Without Jev, only a `great_fit` verdict passes.
- **Eval** `uv run python -m tripai.agents.fit_eval [--no-llm] [--no-jev]`: per case and per engine,
  agreement with the 20 labels, p50 latency, and estimated cost per verdict (from pydantic-ai/genai-prices
  usage). `cascade` is the jev engine (with % escalated). `jev raw` is Jev's label on every case.

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

  (server only). Not wired yet; the API uses an in-memory `Store`.


## Proactive scan + notifications (T5b)

`proactive_scan(user_id)` (`backend/src/tripai/workflows/`): free windows (calendar + długi-weekend radar, next 90 days)
× candidates → `rank()` → rules (`tripai/notify/rules.py`) → in-app inbox + web push. Every I/O step (context, windows,
ranking, long weekends, watched-pick prices, dedupe check, save, push, run record) goes through `run_step`, so:

- **`DATABASE_URL` set** → a durable **DBOS** workflow: each step is checkpointed in Postgres, and a crashed scan
  resumes from the last finished step. Free steps (DB, push) are retried (3 attempts, exponential backoff). Paid steps
  (provider calls) are not retried. A DBOS schedule runs `daily_scan` every day at 07:00 Europe/Warsaw
  (`TRIPAI_SCAN_CRON`, 6-field cron). It visits **active users only**, one after another, and stops early once the
  SerpApi daily budget is spent (see "Cost caps" below).
  Use the Supabase pooler in **session mode** (port 5432; `aws-0-eu-west-1` is the host that knows this project):
  `postgresql://postgres.nvonqduyallbiggricdl:<url-encoded SUPABASE_PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`.
  DBOS creates its own `dbos` schema (not exposed through PostgREST).
- **unset** → the same body runs inline (tests, local dev). If DBOS fails to launch, the API logs it and stays inline.

When does it ping? (all numbers in title/body are copied from the ranked card and its evidence, never generated)

| Trigger | Condition |
|---|---|
| `new_top` | this scan's #1 differs from the last scan's #1 (first scan counts) and score ≥ 0.6 |
| `price_drop` | a watched pick (`POST /picks`) is ≥ 15% cheaper than the last price we told the user |
| `long_weekend` | a radar window starts within 21 days and its best trip scores ≥ 0.8 |

Fit verdict (docs/FIT_VERDICT.md): the scan asks T1c's `tripai.agents.fit.fit` (LLM, or its deterministic rules
fallback) for a verdict on each notification candidate: the #1, the best trip per soon long weekend, and each watched
pick. When there is a verdict, it replaces the score gate: only `good_fit`/`great_fit` notify, and `fit.summary` +
`concerns` travel with the notification.

**Push gate (Jev):** before every push, a separate DBOS step `interrupt_gate` asks
`tripai.agents.jev.jev_worth_interrupting(rec, profile)` for P(worth interrupting). It pushes only if Jev allows it
(p ≥ 0.8, `NOTIFY_MIN_P`). Otherwise the notification stays in the in-app inbox only (`push_status: "inbox_only"`).
Every notification records `interrupt_p`, `interrupt_ok` and `interrupt_source` (`jev`, or `rules` when Jev isn't
configured, in which case the fit label decides: great_fit 0.85 pushes, good_fit 0.7 doesn't). The answer is
checkpointed, so a replayed scan never asks twice. A gate error never pushes. The inbox shows "Push-worthy" or
"Inbox only" with p. User control: in-app inbox always on, push only
after an explicit opt-in tap, max N per week (price drops first, then long weekends, then new #1), muted cities
(name or IATA), snooze, one notification per dedupe key. `personalize=False` still notifies, but ranks on neutral
default weights. Every rule evaluation, including the ones that didn't fire, is kept on the scan run (`GET /scan/last`).

| Endpoint | What |
|---|---|
| `GET /session` | issue/confirm this browser's session (the frontend calls it once before parallel requests) |
| `POST /scan/run` `{today?, profile?, weights?}` | run the scan now ("Run scan now" demo button); `{run, notifications}` |
| `GET /scan/last` | last scan run with every decision and its reason |
| `GET /notifications` · `POST /notifications/{id}/read` | inbox `{items, unread}` / mark read |
| `GET`/`PUT /notifications/prefs` | `{push_opt_in, max_per_week, muted_cities, snooze_until}` |
| `GET /push/vapid-public-key` · `POST`/`DELETE /push/subscribe` | VAPID key / store or drop a browser `PushSubscription` |
| `GET`/`POST /picks`, `DELETE /picks/{id}` | watch a recommendation's price |

Each notification carries `title`, `body`, `recommendation_id`, `inputs_hash`, `why` (evidence-only template),
`evidence`, `score`, fit fields and the full card. Storage: `SUPABASE_URL` + `SUPABASE_SECRET_KEY` → tables from
`supabase/migrations/0003_notifications.sql` (RLS on, no anon policies; apply it before deploying), else in memory
(`TRIPAI_NOTIFY_STORE=memory` forces memory).

**Who is "the user"?** There are no accounts. Every endpoint acts for the server-issued session from `tripai.api.session`
(`X-TripAI-Session` header or cookie). Any `user_id` the client sends is ignored. The frontend keeps the token in
localStorage (`frontend/lib/api.ts`), so each browser has its own inbox, prefs, picks and push subscription, and one visitor
can't trigger, mute or receive another's pushes. Set `TRIPAI_SESSION_SECRET` in production. Without it, sessions (and
therefore inboxes) reset when the backend restarts. Real auth is out of scope for the hackathon.

**Cost caps** (in place before a live provider scans on a schedule):

| Env | Default | Bounds |
|---|---|---|
| `TRIPAI_SCAN_ACTIVE_DAYS` | 14 | the daily run visits push opt-ins plus users who changed prefs, watched a pick or ran a scan by hand in this window (scheduled runs don't count as activity) |
| `TRIPAI_SCAN_MAX_USERS` | 50 | users per daily run, most recently active first |
| `TRIPAI_MAX_PICKS` | 5 | watched picks per user (each one is a provider call per scan); `POST /picks` returns 409 beyond it |
| `TRIPAI_SCAN_MAX_LW` | 2 | soon long weekends priced per scan |
| `TRIPAI_SCAN_MIN_INTERVAL_S` · `TRIPAI_SCAN_PER_MIN` | 60 · 10 | `POST /scan/run` rate limit, per user and per process overall (429 + `Retry-After`) |

On top of these, the LiveProvider's shared SerpApi daily and per-request caps meter every paid call, and `daily_scan`
stops when the daily cap is used up. Concurrent scans for one user (cron + "Run scan now") are serialised in-process.
Across processes, the weekly cap is re-counted at insert time and the insert is unique on `(user_id, dedupe_key)`, so
nothing is sent twice.

**VAPID setup** (web push):
```bash
cd backend && uv run python -m tripai.notify.vapid   # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
```
Put the three lines into the backend's env (Railway variables; the private key is a secret). The frontend fetches the
public key from `GET /push/vapid-public-key`, so it needs no extra env. Rotating keys invalidates existing subscriptions.

Frontend: `public/sw.js` (shows pushes; a tap opens `/inbox/open?n=…`, which loads the card and lands on `/trips/[id]`),
`app/manifest.ts` (installable PWA; iOS needs Home Screen install for push), `/inbox` (list, "Run scan now",
"why (not) pinged", watch price), `/inbox/settings` (push toggle: the browser permission prompt appears only on that
tap; frequency, muted cities, snooze) and a bell with the unread count in the header.

## Budget as a hard limit + two-phase `/recommendations`

**Budget.** When `TasteProfile.budget_pln` is set, it is a hard limit (`tripai.api.budget_fit`). Scores are unchanged.
- **within:** total ≤ budget.
- **slightly_over:** up to +10%. These are kept and ranked normally, but flagged.
- **Fallback:** when fewer than 3 options fit, the closest over-budget options are added (one per city, smallest overage first). They are marked `over` with the overage in PLN, always rank below every option that fits, and carry no flip hint.

Each recommendation carries `budget: {status, budget_pln, total_cost_pln, overage_pln, overage_pct, label}`, or `null` when no budget is set.
The live provider spends its exact-date SerpApi checks only on options this policy keeps.

**Two phases.** `POST /recommendations?phase=fast` answers in about 1.5 s, even with a cold cache. It uses only:
- Travelpayouts, with a per-call deadline (`TRIPAI_FAST_DEADLINE_S`, default 1.5)
- SerpApi from the cache only
- the seed, including the climate snapshot

There is no exact-date refinement and no LLM: `why` comes from the template and `fit` is null. `phase=full`, the default, is the final answer.
Every recommendation has `phase` and `refined`. `refined` means the flight and hotel were checked for the exact dates on Google (SerpApi).
The frontend should render `fast` and swap in `full` when it arrives.

**Weather.** Both phases take month normals from `data/climate.json`, the same Open-Meteo ERA5 data committed as a snapshot. Its
evidence source is `seed:climate (open-meteo:archive ERA5)`. Live Open-Meteo is still used for:
- cities missing from the snapshot
- the exact-window weather of refined cards, capped at 6 s; past that, the month normals stay

Per-source concurrency limits: Travelpayouts 8, Open-Meteo 16, SerpApi 4, Serper 4. Per-city fetches all run concurrently.
