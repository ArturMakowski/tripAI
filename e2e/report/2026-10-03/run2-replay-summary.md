### 🔴 e2e: 5 failed, 9 passed
22 agent steps · 8 replayed from cache · 17 model calls · 71.6k tokens (57% cached)

**🔴 PL/EN toggle switches the visible text on Free time**  
`tests/02-language.e2e.ts:23`

**ASSERTION_FAILED** at step 5 of 5: `agent.act` "switch the app language to the other language (Polish &lt;-&gt; English) using the language switch on this screen; if this screen has no language switch at all, report that instead of navigating away", after 6.5s and 1 model call

> agent.act failed: The /windows screen has no visible language switch; the header only shows TripAI and Inbox, and no language control appears elsewhere in the screen. I did not navigate away or change the language.

- Screen: `<frontend-url>/windows`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Free_20time-8bc9e802/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Free_20time-8bc9e802/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Free_20time-8bc9e802/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Free_time-89fc6c7d-f5a43507.md`

**🔴 PL/EN toggle switches the visible text on Trips**  
`tests/02-language.e2e.ts:30`

**ASSERTION_FAILED** at step 6 of 6: `expect.not.toHaveText getByRole("heading").first()`, after 15.1s

- Expected: not text "Where & when, ranked."
- Observed: text "Where & when, ranked." (1 match)
- Screen: `<frontend-url>/trips`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Trips-1d3a7f3e/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Trips-1d3a7f3e/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Trips-1d3a7f3e/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Trips-e0c596e0-1bfe5085.md`

**🔴 PL/EN toggle switches the visible text on Profile**  
`tests/02-language.e2e.ts:30`

**ASSERTION_FAILED** at step 6 of 6: `expect.not.toHaveText getByRole("heading").first()`, after 15.1s

- Expected: not text "Here's what we heard."
- Observed: text "Here's what we heard." (1 match)
- Screen: `<frontend-url>/profile`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Profile-5ff1d505/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Profile-5ff1d505/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Profile-5ff1d505/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Profile-3e4dc07d-f6f07f15.md`

**🔴 PL/EN toggle switches the visible text on Feedback survey**  
`tests/02-language.e2e.ts:30`

**ASSERTION_FAILED** at step 6 of 6: `expect.not.toHaveText getByRole("heading").first()`, after 15.1s

- Expected: not text "How was Barcelona?"
- Observed: text "How was Barcelona?" (1 match)
- Screen: `<frontend-url>/survey`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Feedback_20survey-40b64fcd/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Feedback_20survey-40b64fcd/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Feedback_20survey-40b64fcd/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Feedback_survey-3c125f7a-4cb7d231.md`

**🔴 PL/EN toggle switches the visible text on Inbox**  
`tests/02-language.e2e.ts:31`

**ASSERTION_FAILED** at step 7 of 7: `agent.assert` "the headings, buttons and labels on this screen are all in the same language: no mix of Polish and English", after 3.9s and 1 model call

> The screen’s headings and controls are mostly in Polish, but the language selector includes the English label “English” alongside Polish labels.

- Screen: `<frontend-url>/inbox`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Inbox-c41e7453/default/attempt-0/screenshots/002-failure.png`, screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Inbox-c41e7453/default/attempt-0/screenshots/001-assert.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Inbox-c41e7453/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Inbox-c41e7453/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Inbox-140c1205-55e6606c.md`

<details>
<summary>All 14 tests in 9 files</summary>

|  | Test | Agent | Time |
| --- | --- | --- | --- |
| 🔴 | **tests/02-language.e2e.ts** · 5 failed, 1 passed | 8 steps · 10 calls | 1m 42s |
| 🟢 | PL/EN toggle switches the visible text on Travel DNA | 2 steps · 1 call | 6.7s |
| 🔴 | PL/EN toggle switches the visible text on Free time | 1 step · 1 call | 8.2s |
| 🔴 | PL/EN toggle switches the visible text on Trips | 1 step · 2 calls | 25.9s |
| 🔴 | PL/EN toggle switches the visible text on Profile | 1 step · 1 call | 20.1s |
| 🔴 | PL/EN toggle switches the visible text on Feedback survey | 1 step · 2 calls | 28.2s |
| 🔴 | PL/EN toggle switches the visible text on Inbox | 2 steps · 3 calls | 12.9s |
| 🟢 | **tests/01-travel-dna.e2e.ts** · 1 passed | 3 steps · 1 call | 9.0s |
| 🟢 | Travel DNA: swiping the deck ends on a result that explains itself with your swipes | 3 steps · 1 call | 9.0s |
| 🟢 | **tests/03-pick-dates.e2e.ts** · 1 passed | 2 steps · 1 call | 6.4s |
| 🟢 | Free time: picking a date range in the calendar carries those dates to the Trips header | 2 steps · 1 call | 6.4s |
| 🟢 | **tests/04-trips-budget.e2e.ts** · 1 passed | 1 step · 1 call | 8.5s |
| 🟢 | Trips: cards show photo, price and fit badge; with a 1,000 PLN budget no over-budget card sits above an in-budget one | 1 step · 1 call | 8.5s |
| 🟢 | **tests/05-receipt.e2e.ts** · 1 passed | 2 steps · 1 call | 8.1s |
| 🟢 | Receipt: every price row shows its source and fetch time, and the inputs hash is shown | 2 steps · 1 call | 8.1s |
| 🟢 | **tests/06-swipe-offers.e2e.ts** · 1 passed | 2 steps | 7.1s |
| 🟢 | Swipe on offers: liking a card shows what was learned, and undo brings it back | 2 steps | 7.1s |
| 🟢 | **tests/07-survey.e2e.ts** · 1 passed | 2 steps · 2 calls | 23.2s |
| 🟢 | Post-trip survey: submitting answers shows how the ranking weights changed | 2 steps · 2 calls | 23.2s |
| 🟢 | **tests/08-inbox.e2e.ts** · 1 passed | 2 steps · 1 call | 37.1s |
| 🟢 | Inbox: "Run the scan now" ends in a notification or a clear "nothing new" state | 2 steps · 1 call | 37.1s |
| 🟢 | **tests/09-console.e2e.ts** · 1 passed |  | 1m 4s |
| 🟢 | No console errors and no hydration errors on any route |  | 1m 4s |
</details>

<sub>e2e 0.16.0 · 1m 45s · iphone14</sub>
