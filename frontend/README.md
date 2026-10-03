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
- **Photos.** Card photos live in `public/swipe/` and come from Wikimedia Commons (CC0, public domain, CC BY, CC BY-SA) or Unsplash (CC0). Three cards reuse the
  bundled Unsplash city photos. Every card shows its photo credit, and the full list is in `public/swipe/CREDITS.md`.

## Loading and budget on `/trips`
- **Two-phase loading.** `POST /recommendations?phase=fast` (cached and calendar prices, under 2 s) puts cards on screen. Then
  `phase=full` (exact live prices plus explanations) updates and re-orders them in place, using layout animation.
  - **Cost safety:** the client only fires `full` when the fast response confirms `X-TripAI-Phase: fast`. A backend without phase
    support answers in full straight away, so it is never called twice.
  - **Loader:** while nothing is on screen there is a plane on a dotted route, staged pipeline steps and filling skeletons. The last
    step of each phase stays "in progress" until that response actually arrives.
  - **Refining:** while estimates are on screen, a "Refining live prices…" strip shows and prices carry a sheen. "Live prices in"
    confirms when the full response lands.
  - **Reduced motion:** with `prefers-reduced-motion` the plane is static, steps don't tick, and the sheen is off.
  - **Mock:** `lib/mock/api.ts` mocks both phases, and fast estimates differ from exact prices so the reorder is visible.
- **Budget.**
  - A "Budget 1,000 PLN · set in profile" chip links to the profile.
  - Cards show "Over budget +X PLN" from the backend's `over_budget_pln`, falling back to total minus budget.
  - An over-budget #1 is never shown without a banner. Either "Nothing fits {budget} for these dates — closest options" (naming the
    cheapest trip), or "Your top pick is X over your budget · N trips fit · Show those first" (a stable within-budget-first sort).

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

City photos are bundled in `public/cities/`, so the demo works offline. Rome, Lisbon, Athens, Venice, Porto and Barcelona come from
Unsplash. Naples, Valletta, Málaga, Paris, Copenhagen and Edinburgh are lead images from Wikimedia Commons (CC BY-SA).

## Deploy (Railway)
Create a service with root directory `frontend/`. Set `NEXT_PUBLIC_API_URL` to the backend URL. It is inlined at **build** time, so
redeploy after changing it. `railway.json` runs `npm run build` and then `npm start` (`next start -H 0.0.0.0`, which reads `PORT`).

## Contract
`lib/types.ts` mirrors `models.py` plus the API-level types from `scoring/types.py` (`RankedRecommendation`, `Counterfactual`,
`FlipHint`), `scoring/windows.py` (`BridgeWindow`, `Holiday`), `scoring/feedback.py` (`Change`) and `api/schemas.py`. The UI needs
no contract changes.
