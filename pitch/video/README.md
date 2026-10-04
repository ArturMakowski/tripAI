# TripAI product video (T8)

A 65.5 s, 16:9 product video in EN and PL: a 4K master plus 1080p, 30 fps, captions on, music and SFX at −14 LUFS.
Every app shot is real footage of the live app, composited by code. The renders are in the GitHub release
`t8-video-v1` (not in git). The plan, beat map and rules are in `plan.md`; credits are in `CREDITS.md`.

## Pipeline
```bash
cd pitch/video && npm install && npx playwright install chromium
node capture.mjs --lang en|pl [--part onboarding|trips] [--record]   # footage → footage/<lang>/ (gitignored)
uv run --with numpy python analyze.py --lang en                       # mark black photo-decode frames (jump-cut)
node render.mjs --lang en --stills                                    # 5 gate stills → ../out/stills/
./critic.sh en                                                        # fresh critic session on the stills
node render.mjs --lang en [--scale 2]                                 # frames → 1080p (4K) silent mp4
node render.mjs --lang en --sfx && uv run --with numpy python audio.py --lang en \
  --video frames/tripai-video-en-1080p-silent.mp4 --out ../out/tripai-video-en-1080p.mp4
```
- **Capture** (`capture.mjs`) drives one user session in Playwright (iPhone 14, 390×844, DPR 3) through the frontend's
  `/api` proxy. The frontend URL is read from `E2E_PROD_URL` (env or `.env`); no URL is committed.
  - Persona: Ola (Kraków, 7–11 Nov, budget 1,800 PLN, hates crowds).
  - **Spend guard.** `/api` traffic is recorded to a HAR and replayed on later takes. Every full `/recommendations` is
    sent as `phase=fast`. The only exception is `--allow-one-full`, which lets through one full call per take, and
    only with the president's approval. On replay, `/recommendations` never reaches the backend.
  - **4× slow clock.** While a clip records, the page's clock, timers, frame callbacks and CSS/Web animations run 4×
    slower, and so do the pointer moves. Frames are resampled on the app's timeline, so app motion gets about 4× more
    real frames. Clips are never played below 1× (that repeats frames and looks laggy).
- **Compositor** (`scene.html`): `seek(t)` draws any frame deterministically. It handles the phone frame, springs,
  camera moves, mask-line captions in Playfair/Caveat/Inter, the colour flood, the loupe and the touch marker.
- **Audio** (`audio.py`): Mixkit music starting on a downbeat, SFX placed by their measured peak on the picture's own
  event times, two-pass loudnorm to −14 LUFS.
