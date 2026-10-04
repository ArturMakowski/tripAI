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

## Beat map (≈ 65 s, 30 fps, 120 BPM → a beat every 0.5 s; cuts on the beat)
| t (s) | Beat | Picture | Caption (EN / PL) |
|---|---|---|---|
| 0–3 | Hook, product mid-action | Phone right, already swiping a trip card ("LOVE IT!"); headline springs in word by word | "You have free days." / *We tell you where and when.* · "Masz wolne dni." / *Powiemy Ci, dokąd i kiedy.* |
| 3–7 | Ola | Persona card pops; hand-written question writes on | "Ola, 29, Kraków · free 7–11 Nov · budget 1,800 PLN · hates crowds" + "Where should I go, and is this even the right weekend?" |
| 7–14 | Travel DNA | Phone slides to centre, push-in on the deck, 5 real drags at 1.3× | "14 swipes." → "Your Travel DNA." |
| 14–18 | Confirm | Tap "Next long weekend · 7–11 Nov" (zoom on the chip, ripple), then the confirm | "Free 7–11 Nov? One tap." |
| 18–25 | Where + when, ranked | Loader → cards (2×), then the list pans; zoom on #1's "2d off → 5d" + score ring | "Where and when. Ranked." → "2 days off. 5 days away." |
| 25–30 | Learns | Trip swipe deck: like, love; zoom on the "Learned: you like …" toast | "Swipe. It learns your taste." |
| 30–41 | Core, slow | Trip page pan: hero → flight + stay → where to eat / what to do; tap Sources → zoom on a source chip; open Evidence (weather, crowds) | "Flight, stay, things to do." → "Every number has a receipt." → "Weather, crowds, prices. All sourced." |
| 41–47 | Text card | Green flood grows out of the phone; four lines land on the beat | "Every number sourced. / A fixed formula ranks. / AI only explains. / You decide." |
| 47–54 | Proactive | Flood shrinks into the phone (home screen); a push notification drops in; My trips | "We watch your free days." → "You get a ping when it's worth it." |
| 54–59 | You book | Tick + Approve → "Approved by you" | "Nothing is booked until you tap." |
| 59–65 | Poster | Headline + TripAI mark + hand-written "HackYeah 2026", slow push-in, held 4 s | (no URL) |

## Gates
1. This beat map. 2. Five stills: opening (0.8 s), main composition (10 s), product shot (34 s), middle of the fastest
transition (41.3 s, the flood), end card (63 s). 3. Fresh critic session (`claude -p`, defaults to reject, ≥ 8/10).
4. Animatic (low fps). 5. Full render 1080p (+4K). 6. Audio: Mixkit ~120 BPM + SFX on taps/swipes/landings,
−14 LUFS, `CREDITS.md`.

## Commands
```bash
node capture.mjs --lang en|pl [--record]   # footage (E2E_PROD_URL from env or ../../.env)
node render.mjs --lang en --stills          # the five gate stills → out/stills/
node render.mjs --lang en --fps 10          # animatic
node render.mjs --lang en [--scale 2]       # full 1080p (4K with --scale 2)
```
