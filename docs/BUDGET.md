# Budget = value, not a cap (user decision, 3 Oct)
"It depends": users pay more for a great location/trip and less for a mediocre one.

- **Onboarding:** remove the "max price" step. Price sensitivity comes from Travel DNA: q9 (price drives choice) →
  price weight; q10 (pay more for unique) → splurge tolerance.
- **Optional hard limit:** `TasteProfile.budget_pln` stays, but is null by default and set only in Profile
  ("Never show trips over X"). When set, the current hard rule (#16) applies unchanged.
- **Without a limit, rank on value:** the existing price factor (vs the seasonal median and the user's typical
  spend) plus a **value explanation**:
  - "Worth the splurge": the card costs ≥ 15% more than the cheapest top-5 alternative AND scores clearly better on
    the non-price factors. Text: "+300 PLN for 6 °C warmer, half the crowds, central hotel".
  - "Great value": price factor high AND fit ≥ good.
  - Both are deterministic, from existing factor scores and evidence, and carry their numbers. They go in
    `Recommendation` as `value_badge` + `value_reason` (contract field added by the president).
- **Typical spend:** inferred from history (saved picks / swipes), otherwise from the DNA luxury level. Shown as a
  chip ("You usually spend ~1,200 PLN"), never a wall.

# Money consistency (must hold everywhere)
- card total == receipt total == confirm total == flight + hotel (± rounding, 0 PLN), in both phases and both
  languages; the fast → full refresh updates every screen together.
- Hotel shown = hotel priced (#24). City-level estimates are labelled "estimate (city average, not your dates)" and
  never shown as a hotel.
- "Per person" only if every line is per person. Hotel per room ÷ guests, or label "per room".
- Comparisons always say which trip: "Málaga: 92 PLN more" / "7–11 Nov: 646 PLN more, +1.8 pts lower".
- The deal baseline needs ≥ 3 fares, otherwise no "% vs typical" badge.

# Party pricing (user request, 3 Oct)
- `TasteProfile.adults/children/rooms` (rooms default ceil(people/2)). Onboarding + trips header: "Ile osób? 1 · 2 · 3 · 4+".
- Flights priced for all travellers (SerpApi `adults=`/Travelpayouts per-pax × n); hotel per room × rooms for the
  exact dates. The UI shows "2 osoby · 2 480 zł razem · 1 240 zł/os.".
- **Money model (the only one; backend `tripai.scoring.party`, fixed 4 Oct after a double-counted hotel):**

  | field | meaning |
  |---|---|
  | `flight_cost_pln` | **per traveller** (one return ticket) |
  | `hotel_cost_pln` | **TOTAL for the room(s) for the whole stay** (price per room × rooms), not per person |
  | `rooms` | `TasteProfile.rooms`, default `ceil(travellers / 2)` |
  | `travelers` | `adults + children` |
  | `party_total_pln` | `flight_cost_pln × travelers + hotel_cost_pln` |
  | `per_person_pln` | `party_total_pln / travelers` |
  | `total_cost_pln` | `== per_person_pln` (backward compatibility; for one traveller = flight + hotel) |

  Example: Palma, 2 adults, 1 room: flight 428, hotel 964 → group 428 × 2 + 964 = 1 820, per person 910.
  Budgets, the price factor, value badges and typical spend all compare the per-person figure. Texts for one traveller
  say "(lot + pokój)"; for a group "na osobę" plus the group total and "loty n × X + hotel Y". `HotelDetails.price_pln_total`
  == `hotel_cost_pln`; hotel evidence rows are "price for 1 room".

# Price honesty (bug found from tester screenshots, 3 Oct)
- A price from OTHER dates (Google Travel Explore cheapest-month, a city-average hotel) must NEVER be shown or
  scored as this trip's price. Order: exact-date SerpApi → exact-date Travelpayouts (prices_for_dates with exact
  departure_at/return_at) → no price.
- `Recommendation.price_status`: `exact` | `partial` (one leg exact) | `estimate`. Estimates are shown muted as
  "od ~X zł (inne daty)", excluded from the price factor and from budget/value badges, and never sorted above
  exact prices without a label.
- Real case: Nice 11–15 Nov showed 358 PLN (Wizz 22–29 Nov) + 1,292 PLN (city average). Real: from 588/826 zł
  flights, 829–1,131 zł hotels. Regression test with these numbers.
