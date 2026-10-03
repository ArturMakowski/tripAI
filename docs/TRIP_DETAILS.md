# Trip details: which flight, which hotel, where, how to get there

Contract: `Recommendation.flight: FlightDetails`, `Recommendation.hotel: HotelDetails` (backend/src/tripai/models.py).
Every field is sourced (`source` + `fetched_at`); unknown = null, never guessed.

## Flight (which airline/line)
- Full phase, top N only: SerpApi `google_flights` for the exact dates → airline, flight numbers, dep/arr times,
  stops, duration, booking link (`booking_token`/Google Flights URL). Fast phase: Travelpayouts airline code only
  (`source: travelpayouts`), times null.
- The cheapest itinerary used for `flight_cost_pln` is the one shown (consistency check in tests).

## Hotel (which hotel, where)
- SerpApi `google_hotels` property used for `hotel_cost_pln`: name, address, `gps_coordinates`, overall_rating,
  reviews, hotel_class, link, thumbnail. Property `nearby_places[].transportations` (when present) → TransferOption
  rows (source `serpapi:google_hotels`).
- `distance_to_center_km`: haversine from hotel to the city centre point in `data/cities.json` (source
  `estimate:haversine`, label "straight-line").
- Airport → hotel: if Google gave no transfer info, driving time/distance via OSRM (`router.project-osrm.org`,
  cached forever per (airport, hotel), throttled; label "by car, estimate"). Never invent public transport.
- Budget: details only for the top N (≤5) in the full phase; all cached in api_cache. No extra SerpApi call per
  card beyond what pricing already does, unless a property-details call is needed (count it against the cap).

## UI
- Receipt: "Your flight" block (airline logo/name, flight numbers, times, stops, duration, link) and "Your stay"
  block (hotel name, rating, stars, address, distance to centre, airport → hotel options), each row with source chip.
- Map: Leaflet/MapLibre with OSM/OpenFreeMap tiles + attribution: hotel pin, airport pin, city-centre pin, straight
  or OSRM route line; tap to open in Google/Apple Maps. Lazy-loaded, works at 390 px, reduced-motion friendly.
- Cards: compact line "Ryanair · direct · 2 h 05" and "Hotel X ★4.4 · 1.2 km from centre".
