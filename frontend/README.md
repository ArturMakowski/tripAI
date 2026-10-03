# TripAI frontend (T4)

A mobile-first Next.js 16 app (App Router, TypeScript, Tailwind v4, shadcn/ui, motion, zustand), designed and demoed at phone width.
On desktop it renders inside a phone-sized column.

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000, uses fixtures unless NEXT_PUBLIC_API_URL is set
npm test             # vitest: scoring, flip math, inputs hash, mock backend (no network)
npm run lint && npm run typecheck && npm run build
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
| `/survey` | Post-trip survey (Barcelona, Aug 2026) → weight diff bars and profile diff → animated re-rank → "new top pick" (`POST /feedback`) |

Demo script: interview → windows → trips → drag the slider to **Price** (Athens takes #1) → open the receipt → plan it → survey
→ "Fill demo answers" → crowd weight goes up → Rome goes back to #1.

## Travel DNA swipe onboarding (`/onboarding`)
Profile creation is a swipe deck built from the team questionnaire in `docs/TRAVEL_DNA.md`: 12 statements (q1–q12) and 2 yes/no cards
(y1, y2). Copy is Polish first, with an EN toggle.

- **Gestures.** ← left = 1 "Nie ja", ↓ down = 3 "Zależy", → right = 4 "To ja", ↑ up = 5 "Bardzo ja!". Yes/no cards: → Tak, ← Nie.
  The same choices are available as buttons and arrow keys. Backspace undoes the last swipe.
- **Motion.** Cards tilt with the drag, show direction stamps, fly out with spring physics, and fly back in on undo.
  Progress dots track the deck. Progress survives a reload.
- **Budget and airports.** Two quick tap screens follow the deck: a budget slider and home-airport chips.
- **Result.** Answers are POSTed to `/profile/dna`. **The UI never derives the profile itself.** Until T1b ships the route, `lib/mock/dna.ts`
  implements the spec formulas verbatim and `lib/dna.test.ts` pins them. The result screen renders the returned `reasons`
  ("na podstawie: „Bardzo ja!” przy …" / "because you swiped “So me!” on …").
  - Every answer can be edited on a 1–5 dot scale; 2 "Raczej nie" is only reachable there. Each edit re-POSTs.
  - y2 = No shows "recommendations won't adapt; post-trip feedback won't change your profile". The survey repeats that notice,
    and the mock feedback keeps the profile unchanged.
- **Hand-off.** "Looks right" stores the profile (with budget and airports) and the DNA weights, then continues to free windows.
  "Fine-tune by chat" opens the earlier LLM interview, now at `/onboarding/chat`.
- **Photos.** Card photos live in `public/swipe/` and come from Wikimedia Commons (CC0, public domain, CC BY, CC BY-SA) or Unsplash (CC0). Three cards reuse
  bundled city photos and their credits. Every card shows its photo credit, and the full list is in `public/swipe/CREDITS.md`.

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
- **Budget.**
  - A "Budget 1,000 PLN · set in profile" chip links to the profile.
  - Cards show "Over budget +X PLN" from the backend's `over_budget_pln`, falling back to total minus budget.
  - An over-budget #1 is never shown without a banner. Either "Nothing fits {budget} for these dates — closest options" (naming the
    cheapest trip), or "Your top pick is X over your budget · N trips fit · Show those first" (a stable within-budget-first sort).

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
- **Toggle.** "Lista / Swipe" under the slider. Swipe mode shows the ranked cards you haven't reacted to as a deck (photo, dates, all-in
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
- **Flags.** `localStorage["tripai-tutorial-v1"]` holds `{intro, tours}`. If storage is missing or throws, the flags live in
  memory for the session.
- **Accessibility.** Both are modal dialogs with a focus trap; focus returns to the opener on close.
  - In the intro, each step's heading takes focus and the step counter is a live region.
  - Targets are at least 40px.
  - With `prefers-reduced-motion`: no loops, slides or drag, and each illustration shows its final frame.
- **Copy.** Follows docs/DECLUTTER.md: a headline of at most 6 words and one line of at most 10, enforced by
  `lib/tutorial-store.test.ts`. PL + EN live in `components/tutorial/strings.ts`, ready to move into `lib/i18n` (#22).
  - Until #22 lands, the intro follows the Travel DNA language. Coach marks are EN, like the screens they sit on.
- **Code.** `lib/tutorial-store.ts` holds the flags, routing and step logic. `components/tutorial/*` holds the UI. Pages only get
  `data-tour` attributes, plus `<TutorialHost />` in the layout and `<HowItWorksButton />` on Profile.

## Data: live vs fixture
`lib/api.ts` implements API v0 exactly as `backend/src/tripai/api/app.py` serves it: `POST /interview`, `GET /windows`,
`GET /windows/long-weekends`, `POST /recommendations` (→ `RankedRecommendation[]`), and `POST /feedback` (→ the profile plus `weights`
and `diff`). If `NEXT_PUBLIC_API_URL` is unset, `NEXT_PUBLIC_MOCK=1`, or the backend can't be reached, every call is served by
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
- **Credits.** Recommendation cards show a small "Photo: author · license" line, and the receipt hero shows the same credit as a
  link to the source. Every screen built on `AppShell`, and the landing page, has a "Photo credits" link to `/credits`. That
  page lists every city photo and Travel DNA card photo with its author, license link and source. The same list is in
  `public/cities/CREDITS.md`.
- **Landing collage.** The photos are landscape but the frames are 3:4, so each image sets an `object-position` that keeps
  its landmark in frame.
- **Fallback.** Unknown codes, or a file that fails to load (cards, receipt and survey thumbnails), get an illustrated dusk gradient with hills and the city name, never a blank card.
  The hue comes from the city name, so it stays the same across renders.
- **Guard.** `lib/photos.test.ts` reads `data/cities.json` and checks that every city and airport code resolves to an existing file
  under 250 KB that has a credit and a row in `CREDITS.md`. It runs the same check on every code in `scoring/provider.py`. If a city is added without a photo, the test fails.

## Deploy (Railway)
Create a service with root directory `frontend/`. Set `NEXT_PUBLIC_API_URL` to the backend URL. It is inlined at **build** time, so
redeploy after changing it. `railway.json` runs `npm run build` and then `npm start` (`next start -H 0.0.0.0`, which reads `PORT`).

## Contract
`lib/types.ts` mirrors `models.py` plus the API-level types from `scoring/types.py` (`RankedRecommendation`, `Counterfactual`,
`FlipHint`), `scoring/windows.py` (`BridgeWindow`, `Holiday`), `scoring/feedback.py` (`Change`) and `api/schemas.py`. The UI needs
no contract changes.
