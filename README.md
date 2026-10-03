# TripAI

Proactive AI travel planner (HackYeah 2026): from your taste, budget and free days it recommends **where and when** to go, with a sourced, reproducible score.

## Hosted
The app and API run on Railway (project `tripai`). Ask the team for the URLs; they are intentionally not published here.

## Run locally (for devs)
Prerequisites: [uv](https://docs.astral.sh/uv/), Node 20+, git.

```bash
git clone https://github.com/ArturMakowski/tripAI.git && cd tripAI
cp .env.example .env            # optional: fill keys (ask Artur); without keys everything runs on recorded fixtures

# backend → http://localhost:8000/docs
cd backend && uv sync && uv run uvicorn tripai.main:app --reload

# frontend (second terminal) → http://localhost:3000; the browser calls /api, proxied to localhost:8000
cd frontend && npm install
npm run dev
#   other backend:  BACKEND_INTERNAL_URL=<backend-url> TRIPAI_INTERNAL_KEY=<key> npm run dev
#   no backend at all (in-browser demo data):  NEXT_PUBLIC_MOCK=1 npm run dev
```

Tests: `cd backend && uv run pytest && uv run ruff check .` · `cd frontend && npm test && npm run build`

Private backend (T12): the browser only talks to the frontend (same-origin `/api/*`); see
[Private backend](#private-backend-t12).

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
| `POST /reactions` `{recommendation_id, reaction: like\|dislike\|love}` · `GET /reactions` · `DELETE /reactions/{id}` | T6 swipe on offers: small, deterministic profile nudges with a `diff` (same shape as `/feedback`), see "Swipe on offers (T6)" |

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
- **Language (pl | en):** every user-facing text the backend writes follows the request language. That covers
  the 'why' text, fit summaries and points, DNA reasons, feedback reasons, interview and DNA-chat questions,
  guard replies, receipts (counterfactuals, flip, filter), radar labels ('Weź 2 dni wolnego → 5 dni') and
  notifications. The language comes from a `lang` body field (`/interview`, `/interview/dna`, `/recommendations`,
  `/profile/dna`, `/feedback`, `/scan/run`), else `?lang=` or `Accept-Language`, else `en`; responses carry
  `Content-Language`. Notifications are written at scan time in `notification_prefs.lang` (set by `/scan/run`
  or `PUT /notifications/prefs`; needs migration `0004`). Strings live in `tripai.i18n`; scores and
  `inputs_hash` don't depend on the language. Polish numbers use `1 098 zł` / `18,5 °C`, and the grounding
  guards accept both forms. Jev's decision prompts stay English (decisions, not text).
- **Budget = value (docs/BUDGET.md):** `budget_pln` is an optional hard limit (null by default). When it's set,
  the #16 rule applies unchanged, and the limit stays the price reference. The price factor compares
  against the user's **typical spend**: the median of their history (watched picks + liked/loved swipes, ≥ 3 trips),
  else the DNA luxury level (`scoring.value.typical_spend`). It's part of `inputs_hash` when it differs from the
  default. Without a limit, cards get a deterministic `value_badge`. `great_value` means a price factor ≥ 0.75 and in
  the list's top quarter, with fit ≥ good. `worth_splurge` means above typical spend, ≥ 15% over the cheapest exact
  top-5 option and ≥ 0.10 better on weather/crowds/taste. Each badge has a `value_reason` carrying its real numbers;
  only `price_status == "exact"` cards get badges. `/recommendations` also returns `typical_spend_pln/_source/_label`
  for the chip.
  Value amounts and the chip are trip totals and say so: "(flight + room)". The provider (choosing which cities
  get exact-date checks) and the proactive scan use the same typical spend as the cards.
- **Money consistency:** `total_cost_pln == flight_cost_pln + hotel_cost_pln` exactly (rounded parts), and
  comparisons always name the option they describe ("Same trip in Jul (peak season): 1046 PLN more, 42 pts lower",
  flip "If the flight to Naples gets 59 PLN pricier, …"). Property tests check every card in both phases and both languages.
- **"What would flip it"** is written in plain language and names the concrete modelled trigger: the flight
  price (that's how the price route is modelled) or the user's own priorities. It never forecasts weather or
  crowds. EN: "If the flight to Athens gets 177 PLN pricier, Lisbon wins."; PL: "Jeśli lot do Aten podrożeje
  o 177 zł, lepszą opcją będzie Lizbona." Polish city names are declined (`i18n.city`). Weights stay in brackets
  for verification. Crowd evidence reads "Tłum: 28% szczytu sezonu" / "Crowds: 28% of peak season". One number per
  row: for live seed data the value is the share of the peak month's tourist nights (Eurostat), and that is
  also what's scored (`seed.load.crowd_level`). Cities without that data show a relative "/100" scale, never
  "% of peak". `inputs_hash` ignores (localised) evidence labels.
- **Full-phase speed:** each AI fit verdict and each 'why' has one deadline (`TRIPAI_LLM_TIMEOUT_S`, default 4 s).
  Past it, the page gets the rules verdict / `template_why`, while the model keeps going in the background
  (≤ `TRIPAI_LLM_BACKGROUND_S`, 20 s) and caches its answer for the next load. The LLM's own fit decision starts
  speculatively when Jev hasn't answered within `TRIPAI_SPECULATE_AFTER_S` (1 s); then an escalation costs ~max(Jev, LLM),
  not the sum, and the call is cancelled if Jev turns out sure. A quick, sure Jev costs no LLM call. Late calls are
  shared per key (a reload joins the running one), capped at `TRIPAI_LLM_MAX_BACKGROUND` (16), and drained on
  shutdown.
  Answers are cached in process and in `api_cache` (`tripai:fit`, `tripai:why`), keyed by a digest of exactly
  what the model sees: payload, language and model. A changed price is a miss, and a cached 'why' is re-checked
  against the card's numbers before reuse (`agents/llm_cache.py`; `TRIPAI_LLM_CACHE=0` disables it). Once the
  SerpApi daily budget is spent, the meter refuses metered calls at once (no Supabase re-read). Refinement still runs
  on cached exact-date results, recorded fixtures, Travelpayouts fares, window weather and photos, so the demo plan
  (warm the cache, then cap 0) serves cached exact prices.
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
  `postgresql://postgres.<project-ref>:<url-encoded SUPABASE_PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`.
  DBOS creates its own `dbos` schema (not exposed through PostgREST).
- **unset** → the same body runs inline (tests, local dev). If DBOS fails to launch, the API logs it and stays inline.

When does it ping? (all numbers in title/body are copied from the ranked card and its evidence, never generated)

| Trigger | Condition |
|---|---|
| `new_top` | this scan's #1 differs from the last scan's #1 (first scan counts) and score ≥ 0.6 |
| `price_drop` | a watched pick (`POST /picks`) is ≥ 15% cheaper than the last price we told the user |
| `long_weekend` | a radar window starts within 21 days and its best trip scores ≥ 0.8 |
| `target_price` | a watched pick's exact-date price is ≤ the user's own target (T13, see "My trips") |

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

**Budget.** When `TasteProfile.budget_pln` is set, it is a hard limit (`tripai.scoring.budget_fit`). Scores are unchanged.
- **within:** total ≤ budget.
- **slightly_over:** up to +10%. These are kept and ranked normally, but flagged.
- **Fallback:** when fewer than 3 options fit, the closest over-budget options are added (one per city, smallest overage first). They are marked `over` with the overage in PLN, always rank below every option that fits, and carry no flip hint.

Each recommendation carries `budget: {status, budget_pln, total_cost_pln, overage_pln, overage_pct, label}`, or `null` when no budget is set.
The live provider spends its exact-date SerpApi checks only on options this policy keeps. So an option whose cached estimate is
over the limit is never re-priced, even if its exact-date Google price might fit. That's a deliberate trade-off for SerpApi
spend. With `personalize=False`, the interest filter runs **once**, on every candidate, before the budget split. Fallbacks therefore come
only from cities that match the user's interests, and every card carries the same filter receipt. The proactive scan (`workflows/scan.py`)
uses the same policy **without** fallbacks: a push never suggests an over-budget trip. Re-pricing of watched picks is not filtered,
because the user chose that trip and the alert is about its price.

**Two phases.** `POST /recommendations?phase=fast` answers in about 1.5 s, even with a cold cache. It uses only:
- Travelpayouts, with a per-call deadline (`TRIPAI_FAST_DEADLINE_S`, default 1.5)
- SerpApi from the cache only
- the seed, including the climate snapshot

There is no exact-date refinement and no LLM: `why` comes from the template and `fit` is null. `phase=full`, the default, is the final answer.
`GET /health` advertises `"phases": ["fast", "full"]`; the frontend (#15) sends `?phase=` only when it sees that (issue #18).
Every recommendation has `phase`, `refined` and `over_budget_pln` (total − budget when positive, 0 within budget, null without a budget). `refined` means the flight and hotel were checked for the exact dates on Google (SerpApi).
The frontend should render `fast` and swap in `full` when it arrives. The fast phase persists nothing. With `TRIPAI_LIVE_FALLBACK=1`
and a cold cache where every city misses the deadline, the fast answer is labelled `FixtureProvider` sample data.

**Weather.** Both phases take month normals from `data/climate.json`, the same Open-Meteo ERA5 data committed as a snapshot. Its
evidence source is `seed:climate (open-meteo:archive ERA5)`. Live Open-Meteo is still used for:
- cities missing from the snapshot
- the exact-window weather of refined cards, capped at 6 s; past that, the month normals stay

Per-source concurrency limits: Travelpayouts 8, Open-Meteo 16, SerpApi 4, Serper 4. Per-city fetches all run concurrently.


## Swipe on offers (T6): `tripai.scoring.reactions`

`POST /reactions` `{recommendation_id, reaction, profile?, weights?, lang?}` acts for the session user (a client `user_id` is ignored) on a
recommendation that `/recommendations` stored for that session (404 otherwise). It returns `{profile, weights, diff, note, hidden, learned}`.
A swipe is a weak signal, so every step is small, clamped to 0..1 and explained in `diff[].reason`:

| Swipe | Interests (city's tags) | Weights |
|---|---|---|
| → like "Chcę tam" | +0.05 each; at most **one** tag you don't have yet is adopted, starting at 0.05 | unchanged |
| ↑ love "Super!" | +0.10 each (one new tag at most, starting at 0.10) | +0.03 on the card's best of price/weather/crowds if it scored ≥ 0.8, then re-normalised |
| ← dislike "Nie dla mnie" | −0.05, only on tags you already have | +0.03 on its worst of price/weather/crowds if it scored < 0.4 |

New tags start at the step, not at a neutral 0.5. The taste score is the matched share of your interest mass, so a 0.55 tag
diluted every other city by about 40% after a single like. Now one like moves unrelated cities by at most 0.05 (pinned by a test).
A dislike never invents an interest: a new tag at 0.45 would add interest mass the city matches and *raise* its taste score.
`diff[].reason` and `note` are written in the request's language (`lang` body field, `?lang=` or Accept-Language; `tripai.i18n` `rx.*`).
A disliked city+dates (the recommendation id) is left out of later `/recommendations` for that user. The same city on other dates
still shows. `personalize=false` records the reaction (and still hides a dislike, which is a list filter, not learning), but changes
nothing, and `note` says so. Re-swiping a card replaces the old reaction. `DELETE /reactions/{id}` (undo) reverts exactly what the
swipe changed, unless that field changed again since (`note` names it), and unhides the trip. `GET /reactions` lists the session's swipes.

Storage: `SupabaseStore` upserts into `reactions` (`supabase/migrations/0005_reactions.sql`, RLS on, no anon policy;
**the president applies it before deploy**). Until it's applied, writes are logged and ignored, and memory serves. Reactions are read once per
user and process. A failed read is not treated as "no reactions": it's retried after `MISS_TTL_S`, so a blip can't un-hide trips.

## End-to-end tests (T9): `e2e/`
Agentic E2E tests for the critical demo flows, run on the live Railway app at iPhone 14 size (TesterArmy `e2e` + Playwright Chromium,
agent model OpenAI `gpt-6-luna`). Replays are committed, so reruns mostly skip model calls. Tests never trigger SerpApi:
`/recommendations` is forced to `phase=fast` except in tests tagged `@live`.
`cd e2e && npm install && npx playwright install chromium && npm run e2e` (or `npm run e2e:prod` / `npm run e2e:local`). See [e2e/README.md](e2e/README.md).

## Trip details (T5c): which flight, which hotel, how to get there

Fills `Recommendation.flight` (`FlightDetails`) and `Recommendation.hotel` (`HotelDetails`), as described in `docs/TRIP_DETAILS.md`.
The core rule: **what is shown is what was priced.**

**Refined cards (top N, full phase).**
- **Flight:** `flight_cost_pln` is Google's cheapest listed itinerary for the exact dates, and that same itinerary is shown:
  airline, flight numbers, local times, duration, stops and the Google Flights link. Round-trip searches only list the outbound
  legs, so `inbound` stays empty rather than costing a second, per-itinerary SerpApi search.
- **Hotel:** `hotel_cost_pln` is a **real property**: the offer at the luxury quantile (nearest rank), priced at its own
  total stay. That property is shown with name, address (when Google gives it), GPS, rating, reviews, stars, link and photo.
- **Distance:** `distance_to_center_km` is a straight-line haversine to the city point in `data/cities.json`.
- **Airport pin:** comes from `data/airports.json` (OurAirports) for the airport the priced flight lands at. That's Google's itinerary, else
  the Travelpayouts/Explore one. It is never the city's main code by default: an unknown landing means no pin and no OSRM.
- **Transfers:** Google's own travel times from that airport. A place only counts if it is Google's name for the landing airport, or carries
  a word distinctive to it (not the city name, and not shared with the city's other airports). So "Milan Linate" is never shown for a
  Bergamo landing.
- **Hotel search:** queried as "City, Country". Offers more than 75 km from the city centre are dropped: the recorded "Naples hotels"
  search returned Naples, Florida. If Google
  gave none, the driving time comes from **OSRM** (`tripai.connectors.osrm`). That's cached for about 10 years per pair, limited
  to 1 request per second process-wide, has a 5 s cap, and is labelled "by car, estimate". Public transport is never invented.

**Cheap pass / `phase=fast`.** Only the Travelpayouts airline code, stops, price and Aviasales link of the fare that was used
(times null), or Explore's airline. A month-median price has no single itinerary, so `flight` is null. `hotel` is null until
refined.

**Cost.** No extra SerpApi calls: everything comes from the searches pricing already makes. Fixture-served details are tagged
`[recorded fixture]` / `[synthetic fixture]` like evidence.

## Where to eat / what to do (T14): `GET /destinations/{iata}/places`

- `GET /destinations/FCO/places?lang=pl&interests=food:0.9,hiking:0.7&limit=3` returns `DestinationPlaces`, with the top
  `restaurants` and `things_to_do` from Google Maps via Serper Places (`tripai.live.places`). Each place has a name, ★ rating,
  review count, Google's own `price_level` text (restaurants only; `null` when Google gives none, and we never fill it in;
  the UI always labels it with its source, e.g. `€20–30 (Google)`, never bare next to PLN totals),
  a category localised to PL/EN (Google's Polish one on PL screens, else our translation, else `null`), address, Maps link, `source` and `fetched_at`.
- Anchored at the destination: every search sends the city + country in `q`, plus `ll=@<lat>,<lon>,13z` (from
  `data/cities.json`) and `gl=<destination country>`. Without these, Google answered near the requester (live bug: "top
  attractions in Palma" returned shops named "Top" in Łódź).
- Hard geo filter: a place farther than 25 km from the city centre is dropped. A place without coordinates is kept only
  if its address names the city or the country. A search with fewer than 3 nearby results fails validation, so it is
  never cached and never counted as a success. The filter also applies to fixtures and to older cache rows.
- Names in the UI language: searches run with `hl=en`, because only English gives real review counts (with `hl=pl`, Google
  writes "69 tys." and Serper returns 69). On a Polish screen, one extra attractions search with `hl=pl` supplies the
  Polish names and categories, joined to the English results by Google's place id.
- Spend: up to 3 searches per city (restaurants EN, attractions EN, attractions PL), cached for 7 days in api_cache
  (`serper:places`). A hard cap allows at most 3 *successful* real Serper calls per city per ISO week (`WeeklyCap`,
  counter row `tripai:budget` / `serper_places:<city>:<week>`, override with `TRIPAI_SERPER_PLACES_WEEKLY_CAP`). In-flight
  calls hold a slot, a failed call releases it, and attempts stop at cap + 2. Concurrent cold requests share one search
  (single-flight). After a cap hit, the shared cache is re-checked once.
- Purging bad cache rows: `uv run python -m tripai.live.places_purge` (dry run), then `--apply`. It deletes
  `serper:places` rows that fail the geo filter, from Supabase `api_cache` (needs `SUPABASE_SECRET_KEY`) and from the disk
  cache.
- Interests re-rank the cached results and never trigger another search: `hiking`/`nature` → parks and viewpoints,
  `history`/`art`/`beach`/`nightlife` → the matching places, and a strong `food` interest → `food_first`. A list can be
  empty for one of these reasons, given in `notes`: `budget`, `not_recorded` (fixture mode) or `unavailable`.
- Fixtures: `backend/tests/fixtures/serper/places/` has recorded restaurant searches for Rome, Lisbon, Barcelona,
  Athens, Porto and Prague, and attraction searches for 10 cities.
- UI: the receipt keeps "Why it fits you", compacted per DECLUTTER: at most 3 bold claims, with swipe quotes and cited sources
  behind "Because you swiped… ›". Under it, it adds compact **Gdzie zjeść / Co robić** rows
  (`★4.6 · 2.1k · €20–30 · Italian`, tap → Google Maps). Each list shows 3 rows and puts the rest behind "+N more"
  (`components/places-section.tsx`). The rows come through the same-origin `/api` proxy and are never mocked: if
  nothing is sourced, there is no section. Concurrent calls share one request, and only complete answers are
  memoised, so an empty or partial answer is asked for again next time.

## Private backend (T12)

The backend is not meant to be called from the internet. The browser only talks to the frontend; the frontend's
route handler `frontend/app/api/[...path]/route.ts` (`frontend/lib/proxy.ts`) forwards `/api/*` to the backend and adds
`X-TripAI-Internal-Key`. Neither the backend URL nor the key is `NEXT_PUBLIC`, so neither reaches the client bundle
(`cd frontend && npm run test:bundle` builds with canary values and greps `.next/static`).

| Where | Variable | What |
|---|---|---|
| backend | `TRIPAI_INTERNAL_KEY` | Shared secret. When set, every route needs `X-TripAI-Internal-Key` (constant-time compare, else 401), including `/docs` and `/openapi.json`, and CORS is off (same-origin via the proxy). Unset (local dev, tests): everything is open, CORS `*`, and a warning is logged at startup. Unset on a deployment (`RAILWAY_ENVIRONMENT` set, or `TRIPAI_ENV=production`): the backend refuses to start (fail closed). Use an ASCII value, e.g. `openssl rand -hex 32` |
| frontend (server) | `TRIPAI_INTERNAL_KEY` | Same value; the proxy adds it to every forwarded request. Unset in production: `/api/*` answers 503 (fail closed) |
| frontend (server) | `BACKEND_INTERNAL_URL` | Backend base URL, e.g. the backend's Railway private-network host and port. Unset in dev: `NEXT_PUBLIC_API_URL`, else `http://localhost:8000`; unset in production: `/api/*` answers 503 and the app falls back to demo fixtures |
| frontend (build) | `NEXT_PUBLIC_MOCK` | `1` forces in-browser fixtures (unchanged) |

- `GET /health` stays open for platform health checks but answers only `{"ok": true}` without the key; through the proxy it
  returns the full status (provider, sources, budget, `phases`).
- The proxy forwards method, path, query string, (streamed) body, `X-TripAI-Session`, cookies and `Accept-Language`, and returns
  status and headers, including `X-TripAI-Session` and every `Set-Cookie`. A client-sent `X-TripAI-Internal-Key` is dropped, and a
  backend `Location` is rewritten to `/api/...` so the private host never reaches the browser. `lib/proxy.ts` imports `server-only`.
  Upstream timeouts: 60 s for `/recommendations`, 95 s for `/scan/*`, 50 s for `/interview`, 30 s otherwise (504 on timeout,
  502 if the backend is unreachable).
- The backend container starts with `python -m tripai.serve`: one dual-stack socket on `[::]` (IPv6 for Railway private
  networking, IPv4 too) on `$PORT`. Plain `uvicorn --host ::` would be IPv6-only, because asyncio sets `IPV6_V6ONLY`.
- `python -m tripai.warm` sends the key itself when it is set.

## Price honesty + party pricing (T5d, docs/BUDGET.md)

**Only prices for the trip's own dates count.**
- **`price_status`:** each card carries `exact` (both legs priced for these dates), `partial` (one leg) or `estimate` (other dates or
  a city average).
- **Flight, exact-date order:**
  1. SerpApi Google Flights (top cards, within the SerpApi cap);
  2. Travelpayouts `prices_for_dates` with exactly `departure_at`/`return_at`. It's free, and the top `TRIPAI_LIVE_EXACT_TOP` (default 10)
     cards get it in both phases;
  3. otherwise no exact price.

  A month-calendar fare also counts as exact only if it departs on day 1 and returns on the last day.
- **Hotel:** exact only from Google Hotels for the dates. Explore's nightly price or the editorial table stays an estimate.
- **Scoring:** a non-exact card's price factor is capped at neutral: `min(NEUTRAL_PRICE_SCORE, price_score(estimate))`. Not knowing a
  price never helps a card, but a high estimate still counts against it.
- **Ordering, with or without a budget:** exact-priced options come first, then the non-exact ones. Those are labelled via
  `price_status` and get no flip hints, because a "would overtake" on a guessed price is meaningless. With a budget, non-exact cards
  get no `budget` status, are listed only if even their estimate fits, and over-budget fallbacks come only from exact prices.
- **Refinement targets are status-blind:** every card is ranked on its current price as if it were known. Verifying a card therefore
  can't lift it over unverified ones. When an exact price comes back high, the loop moves on to the next candidate.
- **Pushes need exact prices:** the proactive scan only pushes `exact` trips, because a push quotes a total. A watched pick re-priced
  from other dates is "no exact-date price": no price-drop alert, and its baseline is not updated.
- **Fast phase:** hotels are never exact before refinement, so in budget mode fast cards carry no `budget` status. The full answer
  adds them.
- **Evidence:** keeps saying "not your exact dates". The UI shows these prices muted ("od ~X zł (inne daty)").
- **Regression test** (`tests/test_price_honesty.py`): the tester's Nice 11–15 Nov card, 358 PLN from a 22–29 Nov fare + a 1,292 PLN
  city average, now becomes the exact 588 PLN fare + ibis budget at 829 PLN, or a labelled `partial`/`estimate`.

**Party pricing** (docs/BUDGET.md is the reference).
- **Lines:** `flight_cost_pln` is per traveller, and `hotel_cost_pln` is the **total for the room(s)** for the whole stay (rooms default to
  ceil(people / 2)).
- **Totals:** `party_total_pln = flight × travellers + hotel`, and `per_person_pln = party_total_pln / travellers = total_cost_pln`.
- **Where it's computed:** `rank()` fills these from the candidate (`Candidate.travelers`), so the API, budget, value badges and
  notifications all read one money model.
- **Tests:** `tests/test_party_money.py` checks it as properties for 1–12 travellers (children, odd sizes, explicit rooms), on both
  providers, plus the Palma regression.

**Party pricing.** `TasteProfile.adults`, `children` and `rooms` (default: ceil(people / 2)).
- **Per-person card:** flights are per person, hotels per room. `flight_cost_pln + hotel_cost_pln = total_cost_pln` is **per person**: the
  flight plus this person's share of the rooms.
- **Group fields:** `travelers`, `party_total_pln` (= per person × travellers) and `per_person_pln`.
- **Hotel details:** `hotel.price_pln_total` is the group's price for the property (rooms × room price). Hotel evidence rows say
  "price for 1 room". The card's `hotel_cost_pln` is the per-person share, and the `party` row ties the three together.
- **Evidence:** a `party` row shows the sum, e.g. "2 os., pokoje: 1: loty 2 × … + hotel 1 × … = … razem".
- **Both providers:** the `FixtureProvider` sample data applies the same per-person hotel share.

## My trips (T13): approved plans, price checks, target price

`backend/src/tripai/api/trips.py`, mounted next to the T5b routes. Everything acts for the session user.

| Endpoint | What |
|---|---|
| `POST /trips` `{recommendation_id}` | Persist an approval from the confirm page (nothing is booked). Also watches the trip's price (a `saved_pick`) when a watch slot is free (`TRIPAI_MAX_PICKS`). Re-approving keeps the first approval's price and time |
| `GET /trips?today=` | `{planned, past, max_watched}`. Planned = approved trips + watched picks (one row per trip); past = approved trips whose end date has passed (rate them via the survey). A watched pick that ended without being approved is dropped |
| `PUT /trips/{id}/target` `{target_pln}` | Set the user's target price (per person, all-in), or clear it with `null`. Watches an approved trip first if it wasn't watched (409 at the cap) |
| `DELETE /trips/{id}/watch` | "Przestań obserwować / Stop watching": frees the watch slot and drops the target. An approved trip stays in the list, unwatched; a trip that was only saved leaves it (`null`) |

**Watch slots:** a trip that has ended releases its slot, so `TRIPAI_MAX_PICKS` counts only picks whose trip hasn't ended yet. This applies to
`POST /picks`, approvals, targets and the scan's own pick budget.

Each row carries the saved price, the scan's **latest check** (`current_pln`, `price_status`, `checked_at`) and
`change_pln` (current − saved). `change_pln` is only set when both are exact-date prices for the same party size. An estimate is
shown, never compared.

**Money follows the party model (docs/BUDGET.md, #38/#40).**
- `*_pln` is per person (`== total_cost_pln`). The flight line is per traveller and the hotel line is the whole stay.
- Rows also carry `saved_/current_flight_pln`, `saved_/current_hotel_pln`, the party size (`travelers`, `current_travelers`) and
  `*_party_pln` (`flight × n + hotel`, via `tripai.scoring.party`).
- Targets are per person, like budgets.
- The `target_price` text for a group reads like the other notifications:
  "Teraz 684 zł/os. (1 368 zł razem dla 2 os.), Twój cel … (loty 2 × 234 + hotel 900)".

**Scan changes** (`workflows/scan.py`, `notify/rules.py`):
- Every re-priced pick gets its latest check recorded. If there is no price now, the check says so: the old number is
  never shown with a fresh timestamp. Writes are partial updates (`NotifyStore.patch_pick`), so a target set during a
  scan isn't overwritten by a stale row.
- `target_price` fires once per (trip, target), when `price_status == "exact"` and the price is at or under the target.
  A new target re-arms it. It has no fit/score gate (the user chose the trip and the number), but snooze, muted cities, the
  weekly cap and the Jev push gate still apply. When it fires, `price_drop` is skipped for that trip in that scan.
  Text is in PL/EN (`n.target.*`): "Twoja cena: Málaga 1-3 sty / Teraz 837 zł, Twój cel 900 zł (lot 361 + hotel 476)."
- Price honesty (T5d) holds here too: an estimate/partial price never triggers `target_price` and never sets a baseline.
- Trips that have already started are no longer re-priced (that saves paid calls).

**Storage:** `supabase/migrations/0006_my_trips.sql` adds the approval columns to `trips` (unique on
`(user_id, recommendation_id)`; the `profiles` FK is dropped because a session can approve before its profile row exists),
plus `saved_pln`, `target_pln` and `last_*` columns on `saved_picks`, and the `target_price` notification kind. RLS stays on with
no anon policy. **The president applies it before deploy.** Until then, the backend keeps working:
- `saved_picks` writes that hit PostgREST's "no such column" answer (400 `PGRST204`) are retried with the 0003 columns only, so the watch and its
  `price_drop` baseline still persist.
- Target and last-check values stay in memory and are merged back into the Supabase rows this process reads.
- `trips` writes are logged and served from memory.

## Origin airports + Travel DNA photos (T15)

- **Origin airports.** Defined once in `tripai.seed.airports.ORIGINS`/`ORIGIN_LABELS`, written to `data/airports.json` as
  `city` + `label`, and mirrored in `frontend/lib/airports.ts` (a test keeps the two in sync). The airports are KRK, WAW,
  WMI, KTW, GDN, WRO, POZ and RZE.
  - A secondary airport is always named with the city it serves: "Warszawa-Modlin (WMI)" / "Warsaw Modlin (WMI)",
    "Katowice-Pyrzowice (KTW)", "Rzeszów-Jasionka (RZE)".
- **City picker.** In `components/airport-picker.tsx` the city is the unit: Warszawa = WAW + WMI. `expandToCity()` runs
  before a selection is saved, in onboarding and on the profile.
- **Every origin is searched.** `tripai.scoring.origins.candidates_for_origins` groups the airports by city, and each city
  is one provider call with a comma origin (`"WAW,WMI"`).
  - Google Flights gets one SerpApi search per city (comma `departure_id`).
  - Travelpayouts and fixtures loop over the airports; the fixture name uses the group's first airport.
  - Only the first city gets the metered pipeline. Further cities get the cheap pass: Travelpayouts and cached SerpApi,
    no sample fallback.
  - The cheapest offer per (destination, window) wins, labelled with the airport it departs from.
- **Route priors.** Every origin maps to a voivodeship for school breaks; WMI, WRO, POZ and RZE used to raise a
  `KeyError`. They also have conservative `direct_from` priors in `tripai.seed.cities`.
- **Travel DNA photos** (`frontend/public/swipe/`, credits in `CREDITS.md` and on `/credits` only, never in other
  views). Each card has one photo that literally shows the statement: q2 a checklist being ticked off, q6 a beach hammock,
  q12 pins on places you've been, y2 a tape measure ("made to measure"), and so on.
  - Only CC0, public domain or CC BY images are used, cropped to 900×1200 and under 250 KB; a test enforces all of this.
  - Licence links on `/credits` are derived from the licence name (`licenseUrl`).
