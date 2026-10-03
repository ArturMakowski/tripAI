# Pitch deck (T7)

10-slide, 16:9 investor/jury deck for HackYeah 2026, in English and Polish, built from one HTML source.
The brief is [docs/PITCH.md](../docs/PITCH.md).

| Output | What |
|---|---|
| `out/tripai-deck-en.pdf`, `out/tripai-deck-pl.pdf` | the decks (10 pages each, 1920×1080). The repo is public, so the committed copy shows `<frontend-url>` and a placeholder instead of the app URL and QR code |
| `out/private/…` (gitignored) | the same decks with the real URL + QR, built with `TRIPAI_APP_URL` set: present these |
| `out/preview/{en,pl}-NN.png` | a PNG of every slide (used by the quality gate) |
| `out/critique-{en,pl}.md` | the last fresh-critic scores, per slide |

## Rebuild (one command)

```bash
cd pitch/deck
npm install                # playwright + qrcode
export TRIPAI_APP_URL=<frontend-url>   # the live app; never committed (public repo)
npm run deck               # recapture screenshots of the LIVE app, then render both PDFs + previews
npm run build              # re-render only (reuse deck/shots/)
npm run critic             # quality gate: a fresh `claude -p` session scores every slide 1-10
unset TRIPAI_APP_URL && npm run build   # the committed copy: same deck, URL + QR as placeholders
```

- `deck.html` + `deck.css`: the slides. `i18n.js`: all EN/PL copy, keyed (`data-t`). Nothing user-visible is hard-coded in the HTML
  except brand/source names and the eval numbers.
- `shots.mjs`: Playwright, iPhone 14 (390×844 @3x), against `$TRIPAI_APP_URL` with the
  **demo profile**, locale `en-GB` / `pl-PL` (the app follows the browser language), the next long weekend (7–11 Nov) picked on
  the calendar. It also runs one inbox scan (the same DBOS workflow as the daily run) to show Jev's real push decision.
  Element positions it records (`shots/meta.json`) drive the zoomed crops in the deck, so they follow the UI. A step whose
  element is gone after a UI change is skipped with a warning and the script exits 1, so you can see which shot needs a look.
- `build.mjs`: writes the QR code (to `$TRIPAI_APP_URL`, if set), renders the PDFs and previews, and fails on missing copy keys or broken
  images; it warns when anything overflows a slide.
- `critic.sh`: the quality gate. A fresh Claude session (no shared context) reads the previews and scores clarity, design and
  judge-criteria fit per slide. We iterated until every slide scored at least 8 on all three.

**SerpApi:** the capture only uses what the live backend serves. The backend's own daily cap (`TRIPAI_SERPAPI_DAILY_CAP`) bounds
any paid lookups, and the deck story avoids quoting specific prices (some cached prices are other-date estimates).

## Where the numbers come from
| Number | Source |
|---|---|
| 21 PRs merged | `gh pr list --state merged` (3 Oct 2026) |
| 365 backend tests | `cd backend && uv run pytest` → 365 passed |
| 147 frontend tests | `cd frontend && npx vitest run` → 147 passed |
| Eval table (16/20, 14/20, 14/20, 10/20; p50; cost) | PR #13 / docs/FIT_VERDICT.md, live run 3 Oct 2026 |
| 89% / 12% | Booking.com, Global AI Sentiment Report (2025), 37,000+ consumers, 33 markets |
| ≈ 36 PLN per booking | **assumption**: a 2% commission on a 1,800 PLN trip (labelled as such on the slide) |
| ≈ 0.004 PLN AI cost per ranking | 5 fit verdicts × $0.00022 (PR #13), ≈ 3.7 PLN/USD |
| p in the inbox caption | read from the captured scan (`shots/meta.json`) |

Placeholders `[Team name]` / `[Members]` on slide 10 are left for the team to fill in.
