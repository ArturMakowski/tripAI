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
