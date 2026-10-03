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
`lib/api.ts` implements API v0 from `docs/ARCHITECTURE.md`. If `NEXT_PUBLIC_API_URL` is unset, `NEXT_PUBLIC_MOCK=1`, or the backend
can't be reached, every call is served by `lib/mock/api.ts`. That is a deterministic in-browser copy of the backend with realistic fixtures (`lib/mock/fixtures.ts`: KRK → Rome, Lisbon,
Athens, Venice and Porto, Jan 2027). The header badge shows **Live data** or **Demo fixtures**. City photos are bundled in `public/cities/`
(Unsplash) so the demo works offline.

The ranking updates instantly on the client. `lib/scoring.ts` recombines the backend's per-factor scores with the slider weights
(normalised weighted sum). In live mode the backend is queried again once the slider settles, so it stays the source of truth.
The UI never invents numbers. The "what would flip it" weight thresholds are exact algebra on the weighted sum. The inputs hash is
SHA-256 over the canonical evidence and weights. The backend may send its own `inputs_hash` instead.

## Contract
`lib/types.ts` mirrors `backend/src/tripai/models.py` one to one. Fields the UI would like but that `models.py` doesn't have yet are marked
**PROPOSED** and are all optional. The UI falls back when they are missing:
`FreeWindow.bridge`, `Recommendation.photo_url | deltas | flip_conditions | inputs_hash | handoff`, `InterviewResponse.suggestions`,
and `/feedback` returning `{profile, weights}`. A bare `TasteProfile` is also accepted.
