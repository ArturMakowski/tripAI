# TripAI frontend (T4)

A mobile-first Next.js 16 app (App Router, TypeScript, Tailwind v4, shadcn/ui, motion, zustand), designed and demoed at phone width.
On desktop it renders inside a phone-sized column.

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000; /api proxies to localhost:8000 (fixtures if it is down, or NEXT_PUBLIC_MOCK=1)
npm test             # vitest: scoring, flip math, inputs hash, mock backend (no network)
npm run lint && npm run typecheck && npm run build
npm run test:bundle  # build with canary secrets, assert none reach .next/static
```

## Screens and demo flow
| Route | What it shows |
|---|---|
| `/` | Welcome screen and the trust promises |
| `/onboarding` | Interview chat with quick-reply chips → taste profile summary (`POST /interview`) |
| `/profile` | Editable profile chips: tap to change an interest's strength, toggle dislikes, set budget, stay, temperature, trip length and airports |
| `/windows` | Free windows (`GET /windows`) plus the **Długi weekend radar** ("Take 1 day off → 4 days"), with day strips |
| `/trips` | Proactive push card, recommendation cards (photo, where + when, all-in PLN, score ring, contribution bar), and the **price ↔ comfort ↔ experience** slider that re-ranks with layout animation |
| `/trips/[id]` | **"Why this, why now" receipt**: weighted factor bars, cost lines with source and timestamp, deltas vs July / next-best window / runner-up, every evidence item, "what would flip it" and the inputs hash |
| `/trips/[id]/confirm` | Explicit approval ("nothing is booked yet"), then hand-off links (Google Flights, Booking.com) and a tentative `.ics` |
| `/my-trips` | **My trips / Moje podróże**: planned trips (approved + saved) with the latest price check and an editable target price; past trips → "Oceń wyjazd" |
| `/survey` | Post-trip survey (`?trip=&city=` from My trips, else the demo Barcelona trip) → weight diff bars and profile diff → animated re-rank → "new top pick" (`POST /feedback`) |

Demo script: interview → windows → trips → drag the slider to **Price** (Athens takes #1) → open the receipt → plan it → survey
→ "Fill demo answers" → crowd weight goes up → Rome goes back to #1.

## Travel DNA swipe onboarding (`/onboarding`)
**Order: the swipe deck first** (it's the part people love), then one quick step, then the result.
- **Step 1** is the swipe deck below.
- **Step 2, "Kiedy i z kim?"** has three parts:
  - quick date chips (this weekend, next long weekend, any 5 days next month), which feed the same store as `/windows`;
  - a party stepper, 1–12 people;
  - home-airport chips.

  "Pokaż moje DNA" computes the result; "Wstecz" undoes the last swipe.
- **No budget question in onboarding.** Price sensitivity comes from DNA q9/q10. A hard limit is optional in Profile (docs/BUDGET.md).
- **"Looks right"** goes to `/trips` if dates were picked, otherwise to `/windows`.

The deck itself is built from the team questionnaire in `docs/TRAVEL_DNA.md`: 12 statements (q1–q12) and 2 yes/no cards
(y1, y2). Copy is Polish first, with an EN toggle.

- **Gestures.** ← left = 1 "Nie ja", ↓ down = 3 "Zależy", → right = 4 "To ja", ↑ up = 5 "Bardzo ja!". Yes/no cards: → Tak, ← Nie.
  The same choices are available as buttons and arrow keys. Backspace undoes the last swipe.
- **Motion.** Cards tilt with the drag, show direction stamps, fly out with spring physics, and fly back in on undo.
  Progress dots track the deck. Progress survives a reload.
- **Result.** Answers are POSTed to `/profile/dna`. **The UI never derives the profile itself.** Until T1b ships the route, `lib/mock/dna.ts`
  implements the spec formulas verbatim and `lib/dna.test.ts` pins them. The result screen renders the returned `reasons`
  ("na podstawie: „Bardzo ja!” przy …" / "because you swiped “So me!” on …").
  - Every answer can be edited on a 1–5 dot scale; 2 "Raczej nie" is only reachable there. Each edit re-POSTs.
  - y2 = No shows "recommendations won't adapt; post-trip feedback won't change your profile". The survey repeats that notice,
    and the mock feedback keeps the profile unchanged.
- **Hand-off.** "Looks right" stores the profile (with airports and party size) and the DNA weights, then continues to free windows.
  "Fine-tune by chat" opens the earlier LLM interview, now at `/onboarding/chat`.
- **Photos.** Card photos live in `public/swipe/` and come from Wikimedia Commons (CC0, public domain, CC BY, CC BY-SA) or Unsplash (CC0). Three cards reuse
  bundled city photos and their credits. The full list is in `public/swipe/CREDITS.md` and on `/credits`.

## Loading and budget on `/trips`
- **Loading.** The backend contract is in issue #18.
  - **Two phases only when the backend says so.** If `/health.phases` includes `fast` and `full`, `POST /recommendations?phase=fast`
    puts cards on screen and `phase=full` then updates and re-orders them in place.
  - **Otherwise one call.** This covers today's backend, an unreachable `/health`, or a failed fast call: the client makes the classic
    single call (`explain_top: 3`). The pipeline never runs twice and explanations are never lost.
  - **Loader:** a plane on a dotted route (SVG `animateMotion`, so it scales to the card), a description of what the pipeline is
    doing, and sheen skeletons. Only real signals get a ✓ (e.g. "Found 7 free windows").
  - **Refining:** a fixed-height slot shows "Refining live prices…" (or "…(demo data)" on fixtures), then a confirmation that stays.
    The push toast floats over the page, so the cards never jump.
  - **Accessibility:** one persistent screen-reader live region. `MotionConfig reducedMotion="user"` app-wide plus a static plane and
    no sheen under `prefers-reduced-motion`.
- **Budget** (only when the optional "Never show trips over…" limit is on in Profile; off by default).
  - A "Budget 1,000 PLN · set in profile" chip links to the profile.
  - Cards show "Over budget +X PLN" from the backend's `over_budget_pln`, falling back to total minus budget.
  - An over-budget #1 is never shown without a banner. Either "Nothing fits {budget} for these dates — closest options" (naming the
    cheapest trip), or "Your top pick is X over your budget · N trips fit · Show those first" (a stable within-budget-first sort).

## Score display
As before #23 (the user found the star ratings noisy): the overall score is a **ring** with the plain 0–100 number
(`components/score-ring.tsx`) on cards, the trip hero and the swipe deck, and **one contribution bar** shows how the four
factors add up (`ContributionBar` in `components/factor-bars.tsx`, no numeric labels). The exact math (factor score ×
weight, the total, the formula, the inputs hash) is one tap away in the receipt's "Audyt". No "%" on cards or above the fold.

## Declutter and money (docs/DECLUTTER.md, docs/BUDGET.md)
- **Less text, same trust.** Every screen keeps its numbers, sources and one primary action visible, and moves explanations
  behind small primitives in `components/declutter.tsx`: `Disclosure` (a collapsed "Evidence · 8 sources ›" row that opens
  itself when a link targets something inside), `InfoTip` (ⓘ expands one line in place) and `Chip` (a compact source or fact).
  The data-source pill moved to `/credits`. The receipt keeps the hero, a two-line AI "why" with More, the score ring and bar, bold fit
  claims and the money lines with one source chip each. Everything else is one tap away.
- **Lines always add up.** Backend semantics: `flight_cost_pln` per traveller, `hotel_cost_pln` the whole stay for all rooms.
  The receipt and confirm show "Loty × n" = flight × n and the stay as-is, and **the total shown is always their sum**;
  `party_total_pln` / `per_person_pln` are only cross-checked (a disagreement sets `mismatch`, the lines win). Party
  headlines read "2 258 zł razem · 1 129 zł/os."; estimates "od ~2 258 zł razem · ~1 129 zł/os. (inne daty)".
  `components/money-consistency.test.tsx` pins lines == total for 1, 2 and 3 travellers plus the Palma case.
- **One money block.** `lib/money.ts` `moneyOf()` is the only place a trip total is computed. Cards (`TripPrice`), the receipt
  and confirm (`MoneyLines`) all render through it, so the same trip shows the same total everywhere, in both loading phases
  and both languages. `components/money-consistency.test.tsx` renders all three for solo, party, exact, partial and estimate
  trips and compares them.
- **Party size.** An "Ile osób?" stepper (1–12) on onboarding's "Kiedy i z kim?" step and in the Trips header writes `adults` (rooms
  default to ceil(people / 2)). Cards say "2 osoby · 2 480 zł razem · 1 240 zł/os." from `party_total_pln` / `per_person_pln`;
  the receipt and confirm show "Loty × 2", "Nocleg, 4 noce × 2 pokoje", "Razem za 3 os." and "na osobę".
- **Hotel line says what was priced:** "Hotel Raphael, 4 noce" for a specific hotel (`rec.hotel.name`), "Nocleg, 4 noce ·
  średnia w mieście" for a city average.
- **Off the user view (Audit at most):** the inputs hash, the AI-check model and confidence line, and data confidence. Stock
  photos (image URLs, `serper:images`) are never listed as evidence. The crowd index reads "Tłum: 12% szczytu sezonu", and
  "what would flip it" names a concrete trigger: "Jeśli Rzym podrożeje o 193 zł, lepszą opcją będzie Lizbona".
- **Price honesty.** `price_status: "estimate"` renders muted as "od ~1 718 zł (inne daty)" with the reason behind ⓘ, never
  styled like a price, and without "vs peak" or "vs typical" comparisons. `"partial"` marks only the estimated leg
  ("≈ 690 zł szac." with ⓘ). Estimate sources read "Szacunek · średnia miasta" / "Google Travel Explore · inne daty".
- **Value badges.** "Świetna cena" / "Warto dopłacić +300 zł" from `value_badge` / `value_reason`; tapping the badge shows the
  reason. In fixture mode `lib/value.ts` derives them with the BUDGET.md rules (never on estimates).
- **Live price honesty:** `moneyOf()` takes the more honest of the declared `price_status` and what the evidence says
  (Travel Explore / "not your exact dates" / Aviasales month median / `estimate:*` sources). An API "exact" never hides an
  other-dates price; `lib/money.test.ts` pins the Nice 11–15 Nov case (358 + 1 292 zł → estimate). Estimates never enter a
  comparison: no "vs runner-up" money delta, no value badge against them, no push.
- **Receipt order (round 3, ≤ 25 words above the fold):** hero (country, city, dates, score ring) → fit badge → money lines
  with one "ⓘ Źródła" toggle for their source chips → contribution bar → collapsed rows: "Dlaczego teraz" (the AI why), "Dlaczego
  pasuje · N" (fit claims), flight, stay + map, "Porównaj" (typical price, runner-up, counterfactuals: every % and "pkt"
  lives here), "Co by to zmieniło", "Dowody", "Audyt". No percentages on cards or above the fold anywhere.
- **Evidence values** go through `lib/evidence-display.ts`: crowds with peak data read "Tłum · 46% szczytu sezonu"; a
  relative scale (`unit: "0-1 rel"`, e.g. London) reads "76/100 (0 = najspokojniejszy miesiąc)", never a percentage.
- **What would flip it** shows only the scorer's plain-language text (`rec.flip.text`, PR #32), e.g. "Jeśli cena będzie dla
  Ciebie ważniejsza (waga z 0,25 na 0,53), lepszą opcją będą Ateny". Fixture mode mirrors that wording (`lib/flip-text.ts`).
- **Ties:** a score gap under 0.5 pts reads "praktycznie remis" / "practically a tie" (`lib/compare.ts`).
- **Country names** go through `lib/country.ts` (`Intl.DisplayNames`), so PL shows "Francja", never "FRANCE".
- **Fit badge** shows only the verdict; the check's confidence is in Audit.
- **Trip cards** are an `<article>` with one stretched link (named "Rzym, 14–19 sty, 1 442 zł"); the value badge and the
  "vs peak" chip are real buttons beside it, never nested inside the link. Money carries `data-testid="trip-total"` /
  `data-line` + `data-amount` hooks for the e2e price invariant.
- **Comparisons name the trip:** "Rzym: wynik wyższy o 3,6 pkt · drożej o 108 zł".

## Quick date filters
"Ten weekend · Najbliższy długi weekend · Dowolne 5 dni…" are radios (`pickQuick` in `lib/date-range.ts`): one quick
filter at a time, tapping the selected one clears it; ranges drawn in the calendar are never touched.

## Pick your dates (`/windows`, T4f)
A mobile-first month calendar at the top of Free time. The user taps a start day, then an end day, to pick a date range.
- **Calendar.** Shows one month at a time, for the next 12 months. Swipe or use the arrows to change month, or tap a month in the strip;
  a dot marks months that already have picked dates. You can add several ranges. Overlapping or touching ranges merge, and the
  × on each one removes it.
- **Highlights.** Polish public holidays are computed locally (including Easter, Corpus Christi and Wigilia) and get a clay dot.
  Long-weekend suggestions show as a dashed sun band: the backend radar where it has an entry, otherwise `localBridges`.
  - If your first tap lands inside a suggestion, the calendar offers "Add the whole long weekend". The month's suggestions are also
    listed under the calendar, with an Add button.
- **Quick chips:** This weekend (on a Sunday: Next weekend), Next long weekend, Any 5 days in &lt;next month&gt;.
- **Exact trips.** Every window sent is a concrete trip, so the scorer prices what the UI says:
  - "Any 5 days" sends 5-day trips starting every 2 days across the month, the last one ending on the month's last day.
  - "I'm flexible ± N" adds the same-length trip shifted 1..N days earlier and later, never into the past.
  - Exact dates go first, then the smallest shifts, capped at the API's 60 windows.
  - Ranges shorter than 2 days are never sent (the backend drops them). Tapping the start day again cancels it instead of picking one day.
- **To the API.** Picked ranges become `FreeWindow(source="manual")` and are sent as `windows` to `POST /recommendations`. They
  replace the calendar and radar windows; with no picks, nothing changes. They are stored in localStorage (`tripai-dates-v1`), and
  every change drops the cached ranking so `/trips` refetches. The cached ranking also remembers which windows it was requested
  for, so a range that ends or gets clipped by a new day refetches too, and a request that was in flight during an edit is dropped.
- **Client-only dates.** `/windows` and `/trips` are prerendered, so anything that depends on today's date renders only after mount
  (`useClientToday`). This avoids a hydration mismatch from the day after a deploy.
- **On `/trips`.** A header reads "For your dates: 11–15 Nov, 22–24 Nov · ± 2 days", with an Edit link. Fixture data only prices
  January 2027, so in fixture mode the sample trips are returned unchanged, never re-dated, and the header says so.
  If the backend finds nothing for the picked dates, Trips shows an empty state with three ways out: "Also try ± N days", "Add the
  next long weekend" and "Edit dates".
- **Accessibility.** The calendar is an ARIA grid with `aria-selected` and a roving tabindex.
  - Keys: arrows, Home/End, PageUp/PageDown to move; Enter/Space to pick; Esc to cancel.
  - Every target is at least 44px, and selections are announced in a live region.
  - With `prefers-reduced-motion`, there are no slide, swipe or ping animations.
- **Code.**
  - `lib/date-range.ts` holds the pure logic, pinned by `lib/date-range.test.ts`.
  - `lib/windows-store.ts` is the store.
  - `components/date-picker/` holds the UI. Its strings live in the `calendar` i18n namespace (`lib/i18n/messages/calendar.ts`),
    so the calendar follows the app-wide PL/EN setting.

## Language (PL / EN)
- **One setting** in the store, shared by every screen, including the swipe deck. If the user hasn't chosen, Polish browsers get PL
  and everyone else EN. A compact PL/EN switch sits in every header: the shared `AppShell`, the home page and the receipt.
- **Copy** lives in typed per-screen dictionaries, `lib/i18n/messages/*.ts`, assembled into `lib/i18n/en.ts` and `pl.ts`.
  - Each namespace declares `pl: Shape<typeof en>`, so a missing or extra key fails `tsc`.
  - `lib/i18n/i18n.test.ts` also checks at runtime that the keys and arities are identical and that no value is empty.
  - Parametrised copy is a function; Polish plurals use `plural()` (`Intl.PluralRules`).
- **Formatting** goes through `useT().fmt` (`lib/i18n/format.ts`, Intl): `1 217 zł` / `1,217 PLN`, `24–27 gru` / `24–27 Dec`,
  weekdays, timestamps, relative times.
- **Backend:** every request sends `Accept-Language`, and POST/PUT bodies carry `lang` (`/interview`, `/recommendations`,
  `/profile/dna`, `/feedback`, notifications), so AI text comes back in the chosen language. The backend side is a separate task. The
  in-browser mocks already answer in the chosen language.

## Swipe on offers (`/trips`, T6)
- **Toggle.** "Lista / Karty" under the slider. **The swipe view ("Karty") opens by default** until the user picks a view;
  after that the choice is remembered (`tripai-swipe-v1`, `viewChosen`). Swipe mode shows the ranked cards you haven't reacted to as a deck (photo, dates, all-in
  PLN, score ring, tags, fit badge). It reuses the Travel DNA deck's swipe physics and stamps (`components/offer-deck.tsx`).
- **Gestures.** → "Chcę tam" (like, and the trip is watched for price drops via T5b `POST /picks`), ← "Nie dla mnie" (hidden), ↑ "Super!"
  (strong like). The same choices are available as buttons and arrow keys. Backspace or the button undoes (`DELETE /reactions/{id}`, and
  the watch is dropped).
- **Toast.** After each swipe a toast says what was learned, built from the backend `diff`: "Zapamiętane: lubisz Rzym: jedzenie, historia ·
  obserwujemy cenę". With personalisation off, it says the profile stays as is.
- **One re-rank.** Learning is buffered while the deck is open and committed when you go back to the list (or leave the page). That
  triggers one `/recommendations` call with the new profile, not one per swipe.
- **Hidden trips.** In list mode they sit under "Ukryte · pokaż", each with "Przywróć".
- **Failures are never hidden.**
  - A swipe the server didn't confirm (5xx, timeout) is not learned locally. The card goes back to the end of the deck with a toast.
  - Undo is disabled while a swipe is still saving.
  - A failed undo keeps the swipe and says so.
  - Only a 404 (the server never stored the card or reaction, e.g. after a session reset) is handled in the browser.
- **Language.** Swipes send the Travel DNA language as `lang`, so the backend's reasons come back in Polish or English.
- **Fixture mode.** `lib/reactions.ts` mirrors the backend rules, and `lib/reactions.test.ts` pins them to the backend test cases. Copy is
  one PL + EN object (`SWIPE_COPY`), ready to move into `lib/i18n`. The language follows the Travel DNA toggle.

## First-run tutorial (T11)
A new user should get what TripAI does in under 30 seconds.
- **Welcome first.** `/` is a real welcome screen (one line, three icon chips, "Zaczynamy"); the intro follows on
  `/onboarding`. Its illustrations are still frames in a dashed "Podgląd" frame that ignore taps (nothing looks like a
  quiz button).
- **Exactly once per device.** The intro opens on its own only on a first visit to `/onboarding` (never over a
  deep link such as `/trips` or a shared `/trips/<id>`), and is marked seen the moment it opens, so Skip, Esc, finishing
  or a reload mid-intro all count. Each screen's coach marks are marked seen as they start.
- **Intro.** Four full-screen steps on the first visit, each with a small looping illustration built from app pieces
  (DNA card, calendar with the long-weekend band, ranked rows with fit badge and source tag, approve button + alert):
  *Powiedz nam, jak lubisz podróżować → Znajdziemy, kiedy masz wolne → Gdzie i kiedy, z dowodami → Ty decydujesz*.
  - Swipe, Next/Back, the dots or ←/→ move between steps. "Pomiń" and Esc close it.
  - The last step opens the Travel DNA deck. If you already have a profile, it just closes.
- **Coach marks.** One-time spotlight tips the first time you open a screen: Trips (slider, fit badge, list/swipe toggle),
  receipt (source tag, "what would flip it"), Free time (calendar), inbox ("Run the scan now", live backend only).
  - Each tip targets `[data-tour="…"]`. Anchors that don't render are skipped. If none render, the tour stays unseen.
  - "Hide tips", ✕ or Esc ends that screen's tour.
- **Replay.** "How it works" on Profile resets every flag and opens the intro again.
- **Flags.** `localStorage["tripai-tutorial-v1"]` holds `{intro, tours}`, mirrored in a `tripai_tutorial` cookie (1 year).
  Seen in either counts as seen, so clearing one never brings the intro back. If both are blocked, the flags live in memory
  for the session.
- **Accessibility.** Both are modal dialogs with a focus trap; focus returns to the opener on close.
  - In the intro, each step's heading takes focus and the step counter is a live region.
  - Targets are at least 40px.
  - With `prefers-reduced-motion`: no loops, slides or drag, and each illustration shows its final frame.
- **Copy.** Follows docs/DECLUTTER.md: a headline of at most 6 words and one line of at most 10, enforced by
  `lib/tutorial-store.test.ts`. PL + EN are in the i18n namespace `tutorial` (`lib/i18n/messages/tutorial.ts`) and follow the
  app-wide language setting.
- **Code.** `lib/tutorial-store.ts` holds the flags, routing and step logic. `components/tutorial/*` holds the UI. Pages only get
  `data-tour` attributes, plus `<TutorialHost />` in the layout and `<HowItWorksButton />` on Profile.

## Which flight, which hotel, where (T10)
The receipt shows the exact flight and stay behind the prices (`Recommendation.flight` / `.hotel`, docs/TRIP_DETAILS.md), following
docs/DECLUTTER.md: numbers and chips first, details one tap away.
- **Only the priced trip.** `trustedDetails(rec)` applies docs/BUDGET.md. A hotel is shown only when `price_status` is `exact`,
  because a city-average estimate is never shown as a hotel. The flight keeps its itinerary only when it is exact or its
  departure dates are the trip's dates; otherwise only the airline is shown. The blocks repeat no prices: under party pricing,
  `FlightDetails.price_pln` covers every traveller and `price_pln_total` is per room, so the receipt line stays the one
  per-person figure.
- **Your flight.** The airline, then one line per direction: "06:25 KRK → 08:30 FCO", plus a chip "direct · 2 h 05" or
  "1 stop". A compact source chip and a "Check flight" link sit under it. "Flight numbers & legs ›" opens each leg's number,
  duration and layover. The layover is the only arithmetic, because both times are at the same airport. Connections get no
  door-to-door duration, since local times sit in different time zones.
- **Your stay.** The name, then chips for "★ 4.6 (1,864 reviews)", the hotel class and "1.2 km from centre", with one source chip.
  "Address & sources ›" holds the address and the straight-line distance, which has its own estimate chip.
- **Where you'll stay.** A Leaflet map with OpenStreetMap tiles and attribution, and no API key.
  - Pins: a hotel teardrop, an airport disc and a city-centre dot, joined by a dashed straight airport → hotel line,
    labelled "straight line, not the route".
  - Each pin's popup links to Google Maps and Apple Maps, as do the "Hotel" and "From airport" rows.
  - Leaflet (with its CSS) loads through `next/dynamic` only when the map nears the viewport.
  - Scroll-wheel zoom is off. On touch screens, one finger scrolls the page until you tap the map.
  - With `prefers-reduced-motion`, there is no zoom, fade or inertia animation. The map is a labelled region, and the
    legend and links are plain text.
- **Airport → hotel.** The first transfer option is visible ("Train · 32 min · 27 km · 34 PLN" plus its note and source); the
  rest sit behind "N more options ›". OSRM and `estimate:*` rows are labelled as estimates. Public transport is never invented.
- **Cards.** Each price gets its compact line, covering both directions: "✈ 262 PLN · Ryanair · direct both ways · 2 h 05"
  (or "there direct, back 1 stop") and "🛏 1,180 PLN · Casa Trastevere
  Suites ★4.6 · 1.2 km from centre". A long hotel name truncates; the rating and distance never do.
- **Null-safe.** Every field is optional in the UI. In the fast phase there is only the airline ("times with live price") and no
  hotel; without details the card looks exactly as before.
- **Code.**
  - Pure helpers are in `lib/trip-details.ts`, pinned by `lib/trip-details.test.ts`.
  - The UI is in `components/trip-details/`.
  - The copy is in `lib/i18n/messages/tripDetails.ts` (PL + EN).
  - The sample data is in `lib/mock/trip-details.ts`: real airport and centre coordinates, fictional hotels on real streets, and
    prices equal to the fixture's `flight_cost_pln` / `hotel_cost_pln`. All of it is labelled "TripAI sample data".

## Data: live vs fixture
`lib/api.ts` implements API v0 exactly as `backend/src/tripai/api/app.py` serves it: `POST /interview`, `GET /windows`,
`GET /windows/long-weekends`, `POST /recommendations` (→ `RankedRecommendation[]`), and `POST /feedback` (→ the profile plus `weights`
and `diff`). It calls the same-origin `/api/*` proxy (`app/api/[...path]/route.ts` → `lib/proxy.ts`), which forwards to the private
backend with `X-TripAI-Internal-Key` (see "Private backend (T12)" in the root README). If `NEXT_PUBLIC_MOCK=1`, or the backend can't be reached, every call is served by
`lib/mock/api.ts`. That is a deterministic in-browser copy of the backend that returns the same shapes (`lib/mock/fixtures.ts`:
KRK → Rome, Lisbon, Athens, Venice and Porto, Jan 2027). The header badge shows **Live API** or **Demo fixtures**. Evidence whose
`source` starts with `fixture:` is a recorded response and is labelled "(recorded)" in the receipt.

The ranking updates instantly on the client. `lib/scoring.ts` recombines the backend's per-factor scores with the slider weights
(normalised weighted sum, the same formula as `tripai.scoring`). In live mode the backend is queried again once the slider settles.
The receipt shows the scorer's counterfactuals (peak season, next-best window), its price-based flip hint and `inputs_hash`. The
runner-up comparison and the weight-based "what would flip it" are computed for the current slider position with exact algebra on the
weighted sum.

## City photos
Every one of the 36 cities in `data/cities.json`, plus Edinburgh from the backend scorer catalogue, has a bundled hero photo in `public/cities/<city id>.jpg`, so the demo works offline.
The photos are landscape Wikimedia Commons images (CC0, public domain, CC BY or CC BY-SA), 1200 px wide and under 250 KB each.
- **Lookup.** `lib/photos.ts` maps every city code and airport code (for example LHR/LGW/STN/LTN → London, PMI → Palma) to a photo
  and its credit (author, license, source URL).
- **Credits.** No inline photo captions anywhere: cards, the receipt hero, the swipe deck, the landing collage and survey
  thumbnails show only the photo. CC BY / BY-SA attribution lives on the `/credits` page (no credits link in the views, per the user). That page lists every city photo and Travel DNA card photo with its author, license link and source. The same list is in
  `public/cities/CREDITS.md`.
- **Landing collage.** The photos are landscape but the frames are 3:4, so each image sets an `object-position` that keeps
  its landmark in frame.
- **Fallback.** Unknown codes, or a file that fails to load (cards, receipt and survey thumbnails), get an illustrated dusk gradient with hills and the city name, never a blank card.
  The hue comes from the city name, so it stays the same across renders.
- **Guard.** `lib/photos.test.ts` reads `data/cities.json` and checks that every city and airport code resolves to an existing file
  under 250 KB that has a credit and a row in `CREDITS.md`. It runs the same check on every code in `scoring/provider.py`. If a city is added without a photo, the test fails.

## Deploy (Railway)
Create a service with root directory `frontend/`. Set the server-only runtime variables `BACKEND_INTERNAL_URL` (the backend's
private-network URL) and `TRIPAI_INTERNAL_KEY` (same value as the backend's). Neither is inlined into the client, and
`NEXT_PUBLIC_API_URL` is not needed in production. `railway.json` runs `npm run build` and then `npm start` (`next start -H 0.0.0.0`, which reads `PORT`).

## Contract
`lib/types.ts` mirrors `models.py` plus the API-level types from `scoring/types.py` (`RankedRecommendation`, `Counterfactual`,
`FlipHint`), `scoring/windows.py` (`BridgeWindow`, `Holiday`), `scoring/feedback.py` (`Change`) and `api/schemas.py`. The UI needs
no contract changes.

## My trips (`/my-trips`, T13)
- **Nav.** "Podróże / My trips" replaces Feedback in the bottom nav, which keeps 4 items. The survey is reached from Past →
  "Oceń wyjazd", and the nav item stays highlighted on `/survey`.
- **Planned.** One card per trip: photo, city, dates and party size. The price is the latest exact-date check, else the price when saved.
  - Money renders through `moneyOf()` / `<PriceInline>`, the same as the card, receipt and confirm: flight × travellers + the stay.
    For a group that reads "1 368 zł razem · 684 zł/os.", and the change chip is per person ("↓ 60 zł/os. od zapisania").
  - A chip shows the change: "↓ 120 zł od zapisania" (pine) or "↑ …" (clay). An estimate shows muted as "od ~X zł (inne daty)"
    and is never compared. There are also states for "jeszcze nie sprawdzono" and "brak ceny na te daty", each with how long ago it was checked.
  - The **target chip** ("Ustaw swoją cenę" / "Powiadom przy 900 zł" / "Twoja cena jest!") opens an inline editor
    (`PUT /trips/{id}/target`). At the watch cap it says so. The editor also has "Przestań obserwować / Stop watching"
    (`DELETE /trips/{id}/watch`), which frees the slot. A saved-only trip then leaves the list.
  - Price honesty: an estimated saved price is never a plain headline number. It renders muted as "od ~X zł" + "inne daty" until an
    exact-date check replaces it ("teraz X zł na Twoje daty", with no "since saved" comparison).
- **Past.** City, dates and "Oceń wyjazd", which opens `/survey?trip=<id>&city=<city>`, prefilled with that trip. A stored survey result
  only shows for the trip it rated.
- **Empty state.** One line and one CTA ("Znajdź wyjazd" → `/trips`).
- **Approve.** The confirm page still approves locally and also calls `POST /trips` (best-effort), so the plan is saved on the server and its price is watched.
- **Fixture mode** (`NEXT_PUBLIC_MOCK=1` or the backend is down): the list is built from the locally approved cards, plus the demo
  past trip, with no price checks. Targets are kept in the store (`tripTargets`), and the header badge switches to "Demo data" (dataset `trips`).
- **Code.** Logic is in `lib/trips.ts`, pinned by `lib/trips.test.ts`; copy is in the i18n namespace `myTrips`; the inbox shows the new
  `target_price` kind.
