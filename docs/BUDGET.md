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
