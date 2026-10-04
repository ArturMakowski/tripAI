# How TripAI works

TripAI answers one question: **given my free days, where and when should I go?** It ranks real trip options
(flight + stay) for your free windows and taste, shows where every number comes from, and keeps watching prices
for you. This page is the end-to-end tour: the user flow, the data, the ranking, the AI parts and what they are
(and are not) allowed to see.

## 1. The user flow

| Step | What happens | Where |
|---|---|---|
| Welcome | One tap to start; no account, a server-issued session cookie | `/` |
| Travel DNA | 14 swipe cards (12 statements on a 1–5 scale + 2 yes/no) → taste profile + ranking weights | `/onboarding` |
| One confirm | Pre-filled: next long weekend, 1 person, default airport; each editable | `/onboarding` |
| Ranked trips | One list of where + when, swipe a row right ("Chcę tam") / left ("Nie dla mnie", undo) / ♥ | `/trips` |
| Trip page | Flight, stay, map, transfers, restaurants & things to do, "why now", sources one tap away | `/trips/[id]` |
| Plan it | Hand-off links to Google Flights / Aviasales / Booking.com for the trip's own dates; nothing is booked by us | `/trips/[id]/confirm` |
| My trips | Approved + watched trips, price checks, target price, edit, delete (undo), mark as booked → rate | `/my-trips` |
| Inbox | A daily scan pings only when something is worth it | `/inbox` |

About 16 taps from opening the app to the first ranked trip (welcome → 14 swipes → one confirm).

## 2. The request pipeline

```
Travel DNA + dates + party + airports
        │
        ▼
1 Candidates   ~30 EU cities (seed) × your free windows × your departure airports (grouped by city)
2 Prices       fast phase  : cache + Travelpayouts calendars + seed estimates          (~1–2.5 s)
               full phase  : exact-date Google Flights / Hotels for the top picks (metered)
3 Context      weather, crowds, holidays, photos
4 Score        deterministic formula → order                         ◀ no AI
5 Budget/value budget status, over-budget last, "great value" badges ◀ no AI
6 Fit verdict  Jev → GPT only if unsure → rules                       ◀ AI: label + cited reasons
7 "Why" text   GPT writes 2–3 sentences from the evidence             ◀ AI: text only
        │
        ▼
Cards: every number with source + fetched_at; estimates labelled "~X · szacunek"
```

The page loads in **two phases**: the fast phase answers from cache and free sources in ~1–2.5 s; the full phase
refines the top picks with exact-date prices and adds the AI parts. The full phase has one wall-time budget
(`TRIPAI_FULL_TARGET_S`, 4.5 s): an AI answer that is late is replaced by the rules verdict / template text right
away, finishes in the background and is cached for the next load.

## 3. Data sources

| Data | Source | Notes |
|---|---|---|
| Exact-date flights | Google Flights (via SerpApi) | Metered: shared daily cap in `api_cache` row `tripai:budget` |
| Exact-date hotels | Google Hotels (via SerpApi) | Same budget; the DNA luxury level picks the price band |
| Cheap fares, calendars | Travelpayouts / Aviasales | Free; usually other dates → shown as an estimate |
| Discovery fallback | Google Travel Explore | Other dates or a city average → always an estimate |
| Weather | Open-Meteo | Forecast, or the same dates averaged over past years |
| Crowds | Eurostat tourism nights (NUTS2) | "% of the season's peak" |
| Holidays, long weekends | Nager.Date + PL bridge-day logic | Drives the pre-filled confirm and the long-weekend list |
| Photos, restaurants, things to do | Serper (Google Images / Places) | Places anchored to the city, hard 25 km filter |
| Transfers, map | Route estimates + OpenStreetMap | "by car, route estimate, no traffic" |
| Airports | OurAirports | Cities group airports (Warszawa = WAW + WMI) |

Every fact is stored as **evidence** (`value`, `source`, `fetched_at`) and cached in Supabase (`api_cache`) with a
per-source TTL. Details: [DATA_SOURCES.md](DATA_SOURCES.md), [TRIP_DETAILS.md](TRIP_DETAILS.md).

### Price honesty ([BUDGET.md](BUDGET.md))
- `price_status`: **exact** (both legs priced for your dates), **partial**, **estimate** (other dates / city average).
- Estimates are shown as `~X · szacunek` with "Brak jeszcze ceny na dokładnie te daty"; they never count for
  ranking advantage (price factor capped at neutral), budget badges, value badges or alerts.
- Party money: flight × travellers + the whole stay = party total; per person = party total / travellers.
- When the SerpApi budget is spent, only metered calls stop: cached exact prices, Travelpayouts, weather and photos
  still apply (the demo plan: warm the cache, then set the cap to 0).

## 4. Ranking (no AI)

Four factors in 0–1, combined with your weights (defaults: price 0.40, weather 0.20, crowds 0.15, taste 0.25;
the DNA and the priority slider move them):

- **price**: against your typical spend (DNA luxury level, later your history); non-exact prices capped at neutral;
- **weather**: distance from your preferred temperature range;
- **crowds**: share of the season's peak;
- **taste**: trip tags against your interests and dislikes.

Same inputs → same score → same order. The budget is an optional hard limit: over-budget exact trips rank last and
are flagged; estimates over the cap are left out. Swipes on trips nudge the weights (with undo); "Nie dla mnie"
hides that city + dates for you.

## 5. The AI parts and what they see

### Fit verdict ([FIT_VERDICT.md](FIT_VERDICT.md)): "is this your kind of trip?"
A cascade, cheapest first:

1. **Jev** (TypeSafe's small classifier) answers a fixed set of yes/no **checks** with confidences
   ("do the crowds clash with q11?", "does the weather fit?"…).
2. **GPT** is asked only when Jev's confidence is below 0.5 (started in parallel if Jev hasn't answered within
   1 s, cancelled if Jev is sure).
3. **Rules**: the deterministic verdict, used as fallback and as the source of grounded downsides.

**Both models see the same price-free input** (`fit_payload`):
- your DNA: the 14 statements with your answers, the 2 yes/no answers;
- interests, dislikes, luxury level, preferred temperature;
- the offer: city, country, dates, tags, highlights, and **style scores only** (weather, crowds, taste);
- the evidence rows **except prices** (flight, hotel, price baseline and peak rows are filtered out).

So a trip can never be "not your style" because of its price; price vs budget lives in the budget status and value
badges.

**Every point is validated**: it must cite a DNA card or an evidence row, and every number in it must appear in what
it cites. Ungrounded points are dropped. A "mixed" or "poor" label must keep a concrete downside; if none survives,
the card shows the rules verdict. Verdicts are cached per trip + profile + language, so a reload gives the same
label.

### "Why" text
The only AI that sees prices. Input: city, dates, nights, cost lines, score points, matched interests, highlights,
all evidence as displayed text, and the "what would flip it" counterfactual. **Any number not in that input is
rejected** and the model must retry; on failure or timeout a deterministic template is used.

### What AI never does
- produce or change a **price**, a **score** or the **ranking order**;
- decide the **budget** status or **value** badges;
- book anything.

## 6. The proactive part

A **DBOS** durable workflow runs every day at 07:00 Europe/Warsaw for active users: it re-ranks your free time for
the next 90 days and notifies (inbox, optionally web push) only on:

- a price drop on a trip you watch, or your **target price** reached (exact-date prices only);
- an upcoming long weekend worth taking;
- a new #1;

and only when the fit is good or great, within your weekly limit, never for cities you excluded from notifications,
never while notifications are paused. Deleted and booked trips are not watched.

## 7. Privacy and infrastructure

- Frontend: Next.js (mobile-first) on Railway. **The backend (FastAPI) is private**: no public URL; only the
  frontend's server-side `/api` proxy reaches it over Railway's private network, with an internal key.
- Sessions: server-issued cookie, no sign-up.
- Database: Supabase Postgres, row-level security on every table with **no** anon/authenticated policies; only the
  backend's secret key reads and writes.
- Sent to AI providers: DNA answers and preferences (TypeSafe for Jev, OpenAI for GPT). No name, e-mail or location
  beyond the departure airport.
- The repository is public: no deployment URLs, keys or project refs in committed files.

## 8. Quality gates

- Backend: `ruff` + `pytest` (no network or keys; fixtures), ~620 tests.
- Frontend: `tsc`, `eslint`, `vitest` (~380 tests, incl. PL/EN parity and a denylist so no internal tech names
  reach the UI).
- End-to-end: replayed browser tests against the deployed app (`e2e/`, `npm run e2e:replay`), including a tap-count
  test for the first run and a money-consistency test (card = trip page = confirm).
- Every change: one PR, a fresh reviewer, fixes, then merge and deploy.
