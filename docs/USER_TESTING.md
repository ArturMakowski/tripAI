# User testing (3 Oct): findings and decisions

## Must (before demo)
- Straight to the point: testers don't read. Execute docs/DECLUTTER.md. Remove from the user view: inputs hash; the
  "AI check · typesafe:jev… · confidence" line; the "Data confidence (1 = live…)" line; stock-photo evidence
  (Posters.pl / serper:images); breakdown math (→ stars, #23).
- "What would flip it" in plain language naming a CONCRETE trigger we model: "Jeśli lot do Malagi podrożeje o 193 zł,
  lepszą opcją będzie Catania" — never "if the weather gets worse" (we don't model that).
- Crowds label: "Tłum: 12% szczytu sezonu" (not "0 = quietest… 39% of Aug nights").
- Onboarding order: dates + party size BEFORE any price question; price phrased per person and per trip.
- Party size: stepper 1–12 (groups of 8–10 happen).
- Hotel price must say whether it is a specific hotel ("Hotel X, 4 noce") or a city average ("średnia w mieście").

## Should (building now)
- **Moje podróże:** planned (approved + saved, price status / last check), past → rate (feeds the survey); user-set
  target price per trip → alert when the price drops to it.
- **Restaurants & things to do:** top 3 restaurants + top 3 attractions per destination via Serper Places (name,
  ★ rating, review count, price level, link). No activity prices without a real source.

## Won't (roadmap)
- Cost splitting (Tricount/Splitwise-like) — the testers themselves warned against scope creep.
- Post-booking itinerary.
- MCP server (see below) — roadmap slide, thin demo only if time allows.

## Pitch answers
- **vs ChatGPT / agentic commerce:** ChatGPT talks about trips; TripAI computes, monitors and proves them:
  - exact-date data-backed ranking (16/20 vs GPT 14/20);
  - durable price monitoring;
  - outcome learning;
  - Polish context.
  And ChatGPT can call us over MCP: find_free_windows, recommend_trips, get_trip_details, explain_trip,
  verify_ranking, watch_trip, update_travel_dna, book_links; resources travel_dna, my_trips.
- **Monetization:** free recommendations; affiliate commission (never paid ranking); Premium ~19 zł/month
  (monitoring/alerts, group trips, later cost splitting).
- **Data sources:** seeded open data (Eurostat, OSM, Wikimedia) + live Google (SerpApi), Travelpayouts, Open-Meteo.
