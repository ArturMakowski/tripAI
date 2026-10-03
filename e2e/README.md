# TripAI end-to-end tests (T9)

Agentic E2E tests for the TripAI web app, built on [TesterArmy e2e](https://github.com/tester-army/e2e) (`e2e` and `@e2e-dev/web`; the docs ship in
`node_modules/e2e/docs`). They run in Playwright Chromium at the iPhone 14 viewport (390×844, Mobile Safari UA). Each test pairs
`agent.act` / `agent.assert` for intent ("switch the language", "like the top offer") with deterministic `expect()` checks for the facts
(totals, sources, timestamps, toasts). If the copy or layout moves, the tests keep working.

```bash
cd e2e
npm install && npx playwright install chromium
npm run e2e          # whole suite except @live, against E2E_BASE_URL (default: the live Railway app)
npm run e2e:prod     # whole suite incl. @live, against $E2E_PROD_URL (set in ../.env)
npm run e2e:local    # against http://localhost:3000 (frontend from ../frontend), except @live
npm run e2e:replay   # strict replay, except @live: fails (REPLAY_STALE) instead of paying for a model call when a recording went stale
npm run e2e:replay:live  # the same incl. @live (runs the real inbox scan: SerpApi; only with budget to spare)
npx e2e run tests/05-receipt.e2e.ts --headed   # one file, watch it
```

- **Model:** OpenAI `gpt-6-luna`, pinned in `e2e.config.ts` (no framework default). The key is `OPENAI_API_KEY` from the environment. If that is
  unset, the config loads `../.env`, or the file named by `TRIPAI_ENV_FILE`. Never commit a key.
- **Caps:** each agent step is capped at `maxSteps: 15` and `maxModelCalls: 15`. The i18n steps are capped lower (5 actions, 6 calls).
  The framework has no global run budget.
- **Telemetry off:** every script sets `E2E_TELEMETRY_DISABLED=1`.
- **Replays:** `.e2e/cache/` is committed. A rerun replays recorded `agent.act` steps without model calls. `agent.assert` always calls the
  model (one call each, by design of the framework). After a UI change, a replay that no longer fits hands over to the agent and re-records.
  Commit the changed cache files. Recordings are keyed by app identity *and* environment, so prod (`production`) and local (`test`) runs
  keep separate entries.
- **Demo profile only.** No test types personal data. The budget test changes only the demo profile's budget.

## SerpApi budget: what the tests may call
SerpApi is paid and capped (30/day). `tests/support/tripai.ts` → `guard()` re-sends every `POST /recommendations` that is not
`phase=fast` as `phase=fast` (cache + Travelpayouts + seed only, never SerpApi). This covers the trips page's full phase, the survey re-rank
and the swipe re-rank. The console test checks that the guard fired. Only tests tagged **`live`** skip the guard: today that is the
inbox scan, which runs the real proactive workflow. `npm run e2e` excludes them, so run `e2e:prod` sparingly (at most twice a day).

`guard()` also marks the first-run tutorial as seen (pass `{ tutorial: true }` to test it), so its overlay never covers the flow
under test. It also injects a small error recorder into every HTML page. It captures `console.error`, uncaught errors (React hydration
errors land here in production) and unhandled rejections. The framework has no console hook yet.

## Tests
| File | Flow | Agent | Deterministic checks |
|---|---|---|---|
| `01-travel-dna` | Dates + party + airports (step 1) → swipe all 14 Travel DNA cards → result | none (deterministic steps) | step 1 comes first; "2 people"; the deck follows; the result's single ⓘ ("Why this result" sheet) shows "because you swiped" reasons |
| `02-language` | PL/EN switch on each main screen (one test per screen) | judge "no PL/EN mix" | taps the unselected language in the header switch; page title text actually changes |
| `03-pick-dates` | Pick 1–3 Jan 2027 in the Free time calendar → Trips | pick the range | Trips header "For your dates: 1–3 Jan" |
| `04-trips-budget` | Profile: switch on "Never show trips over…" (off by default) and set 1,000 PLN → trip cards | judge photo/price/badge (vision) | every card: PLN price, fit badge, photo decodes; no in-budget card below an over-budget one |
| `05-receipt` | Open the top trip's receipt | none (deterministic) | after "Sources / Źródła", each money line has a `Source · 3 Oct` chip with the time in its tooltip (demo data excepted); "Audit" shows the total out of 100 and no inputs hash |
| `06-swipe-offers` | Swipe mode → like → undo | like; undo | "Learned: … {city}" toast; "Undone" toast; the same card is back on top |
| `07-survey` | Post-trip survey → profile update | answer + submit | "Ranking weights" with `x% → y%` lines |
| `08-inbox` `@live` | Run the proactive scan | none (taps "Run scan now") | scan finishes; "N new notifications" or "Nothing new worth a ping" |
| `09-console` | Every route + a receipt | none | no console/page/hydration errors; no "Application error" |
| `10-price-invariant` | Top 3 trips, EN and PL | none | waits for the final ranking (list not `aria-busy`); exact or honest-estimate prices alike: card total = receipt total = confirm total = flight + hotel, and an estimate ("~… · szacunek") is labelled one on all three screens; read from the `data-testid="trip-total"` / `data-line` hooks (and checked against the visible text); nights shown = nights from the dates; screenshots on mismatch |

Run output (report, screenshots, traces) goes to `.e2e/` and is not committed. `report/2026-10-03/` keeps the first runs' summaries and the
screenshots attached to the T9 PR.
