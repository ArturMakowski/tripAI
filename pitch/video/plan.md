# T8 pitch video: plan

Brief: `docs/PITCH.md` (beat map + banned list), deck baseline (cream, deep green, serif headline, hand-written accent),
persona from the deck: **Ola, 29, Kraków, free 7–11 Nov (long weekend), budget 1,800 PLN, hates crowds.**

## Decisions
- **End card:** "TripAI" + tagline only (optionally the GitHub repo name). **No deployment/live-app URL** anywhere
  in the video or in committed files (public repo).
- **No prices featured:** captions, zooms and the cursor never point at a price (most are labelled estimates today).
- **No internals on screen:** no model, engine or infra names; no "beats ChatGPT" claims.
- **No SerpApi spend:** one recorded session per language (`footage/<lang>/api.har`), replayed on re-takes; the first
  full `/recommendations` goes through (the backend caps SerpApi), every later one is sent as `phase=fast`.
- **Language:** the app follows the browser locale; the PL take is `--lang pl`.
- **Flow (t19, pending):** after the 14 swipes, one confirm tap → ranked trips with a compact persona card. No beat
  about accepting a profile. Today's footage still has the separate result screen; it is not used.
- **Motion ("make it pop", user 4 Oct) inside the banned list:** spring physics on everything, camera push-ins and
  zoom-to-element, mask-line text reveals timed to the beat, colour floods that grow out of an element and shrink into
  the next, 2D phone moves (slide, slight tilt), a hand-written write-on accent, tap ripples. Still banned: crossfades,
  blur-ins, 3D, particles, glows, holds > 1 s (holds keep a slow push-in), template looks.

## Look
Canvas `#f9f6ef`, ink `#1c1b19`, deep green `#1d5a45`, dark green `#1f3a30`, clay `#b5452b`.
Headline: Playfair Display 700 (+ italic green second line). Hand-written accent: Caveat (clay). Small text: Inter.
Phone: black bezel, dynamic island, 9:41 status bar; real 1170×2532 footage inside.

## Beat map (≈ 65 s, 30 fps, ~120 BPM; cuts on the beat)
| t (s) | Beat | Picture | Caption (EN / PL) |
|---|---|---|---|
| 0–3 | Hook, product mid-action | Phone right, mid-swipe on the first Travel DNA cards (no prices on screen); headline springs in word by word, hand-written accent writes on | "You have free days." / *We tell you where and when.* + ✍ "free 7–11 Nov" |
| 3–7 | Ola | Persona card grows out of a line; hand-written question writes on; phone on the welcome screen, ends on the real "Let's go" tap | "Ola, 29, Kraków · Free 7–11 Nov · Budget 1,800 PLN · Hates crowds" + ✍ "Where should I go, and is this even the right weekend?" |
| 7–14 | Travel DNA | Phone in the right third, real drags (black photo-decode frames jump-cut) | "14 swipes." / *Your Travel DNA.* |
| 14–18 | Confirm | Zoom on the pre-filled "When · 7–11 Nov" card, tap "Show trips", loader, zoom on the persona card on /trips | "Free 7–11 Nov?" / *One tap.* |
| 18–25 | Where + when, ranked | Loader → cards, then the list; zoom + hand-drawn ring on #1's "2d off → 5d" (price out of frame) | "Where and when." / *Ranked.* → "2 days off." / *5 days away.* |
| 25–30 | Learns | Trip swipe deck: "I want to go", zoom on "Learned: you like …" | "Swipe." / *It learns your taste.* |
| 30–41 | Core, slow | Trip page (Good fit, flight, stay, things to do) → scroll → tap Evidence (0.65×) → a loupe (enlarged crop of the real footage) rings the "Open-Meteo · 3 Oct" source chip | "Flight, stay," / *things to do.* → "The proof," / *one tap away.* → "Every number" / *has a receipt.* |
| 41–46.5 | Text card | Green flood grows out of the ringed source chip and swallows the phone; four lines land on the beat | "Nothing made up. / A fixed formula ranks. / AI only explains. / *You decide.*" |
| 46.5–54 | Proactive | Flood shrinks, phone back on the home screen, a push (no price) drops in; My trips with "Set your price" ringed | "We watch your free days." / *A ping only when it's worth it.* → "Saved trips," / *prices re-checked daily.* |
| 54–59 | You book | Tick + Approve → "Approved by you" | "Nothing is booked" / *until you tap.* |
| 59–65.5 | Poster | Headline + TripAI mark + tagline + ✍ "HackYeah 2026"; phone rises from the bottom edge in the right third, showing the pre-filled "Ready? Check and go · 7–11 Nov" card; slow push-in | (no URL) |

## Gates
1. This beat map. 2. Five stills: opening (1.5 s), main composition (11.4 s), product shot (39.2 s), middle of the fastest
transition (41.12 s, the flood), end card (63 s). 3. Fresh critic session (`claude -p`, defaults to reject, ≥ 8/10).
4. Animatic (low fps). 5. Full render 1080p (+4K). 6. Audio: Mixkit ~120 BPM + SFX on taps/swipes/landings,
−14 LUFS, `CREDITS.md`.

## Commands
```bash
node capture.mjs --lang en|pl [--record]   # footage (E2E_PROD_URL from env or ../../.env)
node render.mjs --lang en --stills          # the five gate stills → out/stills/
node render.mjs --lang en --fps 10          # animatic
node render.mjs --lang en [--scale 2]       # full 1080p (4K with --scale 2)
```
