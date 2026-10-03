# Connectors (T2)

Async httpx clients. Every result is a pydantic `SourcedResult` with `source` and `fetched_at`, plus
`.evidence() -> list[tripai.models.Evidence]` for the receipt card.

| Client | Method | Source tag | Key |
|---|---|---|---|
| `SerpApiExplore` | `explore("KRK", month=1, travel_duration=2)` → `ExploreResult` (cheapest destinations + dates) | `serpapi:google_travel_explore` | `SERPAPI_API_KEY` |
| `SerpApiFlights` | `price_insights("KRK","FCO", out, back)` → lowest price, `price_level`, typical range, history | `serpapi:google_flights` | same |
| `SerpApiHotels` | `search("Rome", in, out, iata="FCO")` → offers, `median_nightly`, `cheapest(min_rating)` | `serpapi:google_hotels` | same |
| `Travelpayouts` | `month_calendar("KRK","FCO","2027-01")` (v3 grouped_prices), `prices_for_dates(...)` | `travelpayouts:*` | `TRAVELPAYOUTS_TOKEN` |
| `OpenMeteo` | `weather(lat, lon, start, end)` → forecast if ≤16 days ahead, else same-dates average of the last 3 years (ERA5 archive) | `open-meteo:forecast` / `open-meteo:archive` | none |
| `GCalFreeBusy` | `query(start, end)` → busy blocks, `.free_days()`, `.free_windows(min_days)` → `FreeWindow[]` | `gcal:freebusy` | OAuth (below) |
| `Serper` | `city_images("Rome", country="Italy")` → `.best()` hero photo; `places("Rome", country="Italy")` → `.top()` attractions with ratings | `serper:images` / `serper:places` | `SERPER_API_KEY` |
| `fli_dates.search_dates` | optional fallback if SerpApi quota is gone (not a dependency) | `google_flights_via_fli` | none |

All prices are in PLN (`currency` field on each result). Failures raise `ConnectorError`
(`MissingCredentials` and `FixtureNotFound` are subclasses), so callers can skip one candidate.

## Fixtures, cache, probe
- `TRIPAI_USE_FIXTURES=1` serves `backend/tests/fixtures/<source>/<name>.json` with no network and no keys.
  The names are route-level (`KRK-FCO`, `FCO`, `KRK`), but the request's dates must match the recorded ones,
  otherwise `FixtureNotFound`. Data for other dates is never served under the requested label.
  The recorded set is: flights and hotels for 14–19 Jan 2027; Travelpayouts for month `2027-01`;
  explore with `month=1`; a calendar covering Jan–Feb 2027, clipped to the requested range; weather for
  any January window, using the nearest recorded city within 75 km.
- Results from synthetic fixtures (`"recorded": false`: Travelpayouts and the demo calendar) have
  `synthetic=True`, and their evidence `source` ends in ` [synthetic fixture]`.
- `gcal:freebusy` is never cached: it's per-user data, and the cache may be shared. Calendar-level errors raise
  `ConnectorError`, so an unreadable calendar never looks free. The probe only records a real calendar
  with `--record-gcal`.
- Cache: `(source, params)` maps to the payload, with a TTL per source (`cache.TTL_BY_SOURCE`). It is stored on disk under
  `backend/.cache/api/` and in the Supabase `api_cache` table when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-side only; the table has RLS) are set
  (table shape: `source, cache_key, payload, fetched_at, expires_at`, owned by T1). Secrets never enter keys
  or files. Cache errors count as misses. Set `TRIPAI_NO_CACHE=1` to disable the cache.
- `uv run python -m tripai.connectors.probe [--only travelpayouts,open_meteo] [--routes FCO,LIS] [--no-record]`
  calls every API that has a key and re-records the fixtures (KRK to 10 cities, 14–19 Jan 2027).
- `uv run python tests/fixtures/make_synthetic.py` regenerates the synthetic fixtures (`"recorded": false`).
  It never overwrites live recordings.

## Google Calendar login
Create a Desktop OAuth client, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run
`uv run python -m tripai.connectors.gcal_freebusy login`. The login uses a loopback redirect with PKCE and the
`calendar.freebusy` scope. The token, including the refresh token, is saved to `~/.config/tripai/gcal_token.json`
(override with `TRIPAI_GCAL_TOKEN`).
