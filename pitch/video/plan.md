# T8 pitch video: plan (paused)

Brief: `docs/PITCH.md` (beat map + banned list). Status: footage capture scripted (`capture.mjs`); paused until
the UI PRs land, then a final re-capture.

## Decisions
- **End card:** "TripAI" + tagline only, optionally the GitHub repo name. **No deployment/live-app URL** anywhere
  in the video or in committed files (public repo).
- **No prices featured:** captions and cursor highlights never point at a price (some are other-date estimates).
- **No SerpApi spend:** demo profile on the default windows only; backend responses recorded once per section
  to HARs and replayed; extra `/recommendations` calls are blocked. Captions use the window the footage
  shows, not a hard-coded one.
- **Language:** the app follows the browser locale, so the PL take is `--lang pl` (Playwright locale pl-PL).

## Resume checklist
1. `E2E_PROD_URL=<frontend-url> NEXT_PUBLIC_API_URL=<backend-url> node capture.mjs --lang en --record` (and `--lang pl`);
   preload the swipe-deck photos first.
2. HTML compositor with `seek(t)`: phone frame on warm white, Inter captions, cursor on one target, header/nav overlays,
   rebuilt no-price push notification, text-only cards, poster end card (above).
3. Gates: beat map here → 5 stills → fresh critic session (≥ 8/10) → animatic → full → audio (Mixkit ~120 BPM,
   SFX, −14 LUFS, `CREDITS.md`).
4. Export `pitch/out/tripai-video-{en,pl}.mp4` in 4K + 1080p; large files go to a gh release; open the PR.
