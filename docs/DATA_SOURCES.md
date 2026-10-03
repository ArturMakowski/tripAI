# Data sources (researched 2026-10-03)

Most official flight APIs are closed to us: **Amadeus Self-Service is shut down** (keys disabled 17 Jul 2026),
and Kiwi Tequila, Skyscanner, Kayak, Expedia Rapid and Booking.com Demand all require partner contracts.
**Booking.com Demand API** needs a signed Managed Affiliate Partner contract, so it can't be done in 24h.

## Wire live (6)
| # | Source | Role | Access | Cost |
|---|---|---|---|---|
| 1 | SerpApi `google_travel_explore` | **WHERE**: cheapest destinations from KRK, flexible dates | self-serve key | 250 free/mo, $25/1k; cached repeats free |
| 2 | Travelpayouts Aviasales Data API (`v3/grouped_prices`, `v3/prices_for_dates`) | **WHEN**: price calendar per route, anywhere scan | free token | free; cached prices from the last 48h (up to 7 days old), not bookable; set `currency` (default RUB) |
| 3 | SerpApi `google_flights` `price_insights` | "price is LOW vs typical" for the top 3 picks | same key | same quota |
| 4 | Open-Meteo (forecast / climate / archive) | weather for the chosen dates | no key | free (non-commercial) |
| 5 | Google Calendar `freebusy.query` | free windows → proactive trigger | OAuth, testing mode (up to 100 test users) | free |
| 6 | SerpApi `google_hotels` or LiteAPI sandbox | hotel price for the shortlist | self-serve | quota / free sandbox |

## Seed / cache once
- Eurostat `tour_occ_nim` / `tour_occ_nin2m` → monthly **crowd score** (0–1) per region for ~30 candidate cities
- Nager.Date public holidays (PL + destination countries, 2026–27)
- OpenTripMap / OSM Overpass top attractions per candidate city (attribution required)
- List of destination airports reachable from KRK
- Ticketmaster Discovery (optional): events by city and date

## Fallbacks
- `fli` (`pip install fli`, reverse-engineered Google Flights) `SearchDates`, if SerpApi quota runs out
- Ryanair `farfnd` `cheapestPerDay`: **demo only** (ToS prohibits it; Ryanair sues scrapers)
- Recorded fixtures for every demo call
- Each fetch is a durable, retryable DBOS step; cache every response in Supabase with source and `fetched_at`

## Not feasible in 24h
Amadeus (dead), Kiwi Tequila, Skyscanner, Kayak, Booking.com Demand, Expedia Rapid, GetYourGuide,
Travelpayouts Hotellook (closed Oct 2025), Airbnb (no public API), Viator (needs approval, risky).

## Sources
- Amadeus shutdown: https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers
- SerpApi: https://serpapi.com/pricing · https://serpapi.com/blog/introducing-serpapi-google-travel-explore-api/
- Travelpayouts: https://support.travelpayouts.com/hc/en-us/articles/203956163
- fli: https://github.com/punitarani/fli
- Booking.com: https://developers.booking.com/demand/docs/getting-started/prerequisites
- LiteAPI: https://docs.liteapi.travel/docs/getting-a-sandbox-key
- Eurostat: https://ec.europa.eu/eurostat/cache/metadata/en/tour_occ_esms.htm
- Open-Meteo: https://open-meteo.com · Nager.Date: https://date.nager.at

## Serper (serper.dev) — added 2026-10-03
Google Search/Images/Places/News wrapper (`SERPER_API_KEY`). **No flights or hotels endpoints**, so it doesn't replace SerpApi.
Use for: city hero photos on cards (`/images`), attractions/restaurants with ratings (`/places`), local events/news (`/news`).
