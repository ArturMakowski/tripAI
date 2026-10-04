# Pitch deck (T7)

An 8-slide, 16:9 pitch for HackYeah 2026, in English and Polish, from one HTML source. Story, copy, tone and visual style
follow the team's 5-slide baseline (hook · Meet Ola · Free days in, a checkable trip out · Every number has a receipt ·
We earn on bookings, never on ranking). Three slides are added from the earlier 10-slide draft: tech decisions, why us, team.
Persona and dates are shared with the pitch video (T8): Ola, 29, Kraków, free 7–11 Nov, budget 1,800 PLN.

| Output | What |
|---|---|
| `out/tripai-pitch-en.pdf`, `out/tripai-pitch-pl.pdf` | the decks (1920×1080 pages). The repo is public, so the committed copy shows `[app URL / QR]` |
| `out/preview/{en,pl}-NN.png` | a PNG of every slide |
| `out/private/…` (gitignored) | the same decks with the real app URL + QR, for presenting |
| `out/critique-{en,pl}.md` | the last fresh-critic scores (clarity, story, honesty) |

## Rebuild

```bash
cd pitch/deck
npm install                                  # playwright + qrcode
export TRIPAI_APP_URL=<frontend-url>          # or E2E_PROD_URL from the root .env; never committed
npm run shots                                # recapture every phone screenshot from the live app (both languages)
SHOTS_PART=onboarding npm run shots           # only the first run: welcome → 14 swipes → confirm → /trips persona card
SHOTS_PART=trips npm run shots                # only demo profile → ranking, receipt, swipe, inbox
npm run build                                # PDFs + previews (into out/private/ while TRIPAI_APP_URL is set)
npm run critic                               # fresh `claude -p` critic scores every slide
unset TRIPAI_APP_URL E2E_PROD_URL && npm run build   # the committed copy: placeholders instead of URL + QR
```

- `deck.html` + `deck.css`: the slides; `i18n.js`: all EN/PL copy, keyed (`data-t`).
- `shots.mjs` (Playwright, iPhone 14, 390×844 @3x, locale `en-GB` / `pl-PL`; the app follows the browser language):
  - The tutorial counts as already seen.
  - The first run swipes Ola's answers with the arrow keys and takes the pre-filled confirm (next long weekend, 1 person, KRK).
  - The trips part uses the demo profile with Ola's 1,800 PLN budget (the profile's "never show trips over" field) and
    the 7–11 Nov long weekend.
  - Every `/recommendations` call is rewritten to `phase=fast` in the browser, so the capture never triggers exact-date
    (paid) lookups. One inbox scan shows Jev's real push decision; its `p` comes from the scan response.
  - A step whose element is gone after a UI change is skipped with a warning and the script exits 1.
- `build.mjs`: fails on missing copy keys or broken images, warns when something overflows a slide.

## Where the numbers come from
| Number | Source |
|---|---|
| 48 PRs merged | `gh pr list --state merged` (4 Oct 2026) |
| 937 automated tests | `cd backend && uv run pytest` → 599 passed; `cd frontend && npx vitest run` → 338 passed |
| ~2 s to first results | fast phase measured on the live app: 1.3–2.6 s (full ranking ~5 s cold) |
| 16/20 · 14/20 · 14/20 · 10/20, 0.5 s / 6.5 s / ~3 s, 15% escalated | PR #13 / docs/FIT_VERDICT.md, live eval 3 Oct 2026 (20 team-labelled trips) |
| 89% / 12% | Booking.com, Global AI Sentiment Report (2025), 37,000+ consumers, 33 markets |
| ~36 PLN per booking | **assumption**: 2% of a 1,800 PLN trip (labelled on the slide) |
| ~19 PLN/month Premium | **hypothesis** (labelled on the slide) |
| 3 user-testing rounds | docs/USER_TESTING.md |

Placeholders `[Team name]` / `[Members]` and `[app URL / QR]` are left for the team.
