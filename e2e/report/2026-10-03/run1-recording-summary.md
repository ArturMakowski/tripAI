### 🔴 e2e: 7 failed, 7 passed
20 agent steps · 44 model calls · 283.2k tokens (74% cached)

**🔴 PL/EN toggle switches the visible text on Free time**  
`tests/02-language.e2e.ts:30`

**ASSERTION_FAILED** at step 6 of 6: `expect.not.toHaveText getByRole("heading").first()`, after 15.1s

- Expected: not text "When you could go."
- Observed: text "When you could go." (1 match)
- Screen: `<frontend-url>/windows`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Free_20time-8bc9e802/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Free_20time-8bc9e802/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Free_20time-8bc9e802/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Free_time-89fc6c7d-f5a43507.md`

**🔴 PL/EN toggle switches the visible text on Trips**  
`tests/02-language.e2e.ts:30`

**ASSERTION_FAILED** at step 6 of 6: `expect.not.toHaveText getByRole("heading").first()`, after 15.0s

- Expected: not text "Where & when, ranked."
- Observed: text "Where & when, ranked." (1 match)
- Screen: `<frontend-url>/trips`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Trips-1d3a7f3e/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Trips-1d3a7f3e/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Trips-1d3a7f3e/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Trips-e0c596e0-1bfe5085.md`

**🔴 PL/EN toggle switches the visible text on Profile**  
`tests/02-language.e2e.ts:23`

**ASSERTION_FAILED** at step 5 of 5: `agent.act` "switch the app language to the other language (Polish &lt;-&gt; English) using the language switch on this screen; if this screen has no language switch at all, report that instead of navigating away", after 5.4s and 2 model calls

> agent.act failed: The current /profile screen has no language switch. The visible header only shows TripAI and Inbox, and the screenshot confirms there is no language control; I did not navigate away.

- Turn 1: `screenshot({})` → \[screenshot\] Screen unchanged since revision b2 (re-observed as revision b4, path /profile); the ids you have stay valid.
- Screen: `<frontend-url>/profile`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Profile-5ff1d505/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Profile-5ff1d505/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Profile-5ff1d505/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Profile-3e4dc07d-f6f07f15.md`

**🔴 PL/EN toggle switches the visible text on Feedback survey**  
`tests/02-language.e2e.ts:30`

**ASSERTION_FAILED** at step 6 of 6: `expect.not.toHaveText getByRole("heading").first()`, after 15.0s

- Expected: not text "How was Barcelona?"
- Observed: text "How was Barcelona?" (1 match)
- Screen: `<frontend-url>/survey`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Feedback_20survey-40b64fcd/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Feedback_20survey-40b64fcd/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Feedback_20survey-40b64fcd/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Feedback_survey-3c125f7a-4cb7d231.md`

**🔴 PL/EN toggle switches the visible text on Inbox**  
`tests/02-language.e2e.ts:30`

**ASSERTION_FAILED** at step 6 of 6: `expect.not.toHaveText getByRole("heading").first()`, after 15.0s

- Expected: not text "We watch. You decide."
- Observed: text "We watch. You decide." (1 match)
- Screen: `<frontend-url>/inbox`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Inbox-c41e7453/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Inbox-c41e7453/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_02-language.e2e.ts__PL_2FEN_20toggle_20switches_20the_20visible_20text_20on_20Inbox-c41e7453/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_02-language.e2e.ts-PL_EN_toggle_switches_the_visible_text_on_Inbox-140c1205-55e6606c.md`

**🔴 Trips: cards show photo, price and fit badge; with a 1,000 PLN budget no over-budget card sits above an in-budget one**  
`tests/04-trips-budget.e2e.ts:34`

**ASSERTION_FAILED**

> broken card photos: expected \["Nice, France","Málaga, Spain","Naples, Italy"\] to equal \[\]

- Screen: `<frontend-url>/trips`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_04-trips-budget.e2e.ts__Trips_3A_20cards_20show_20photo_2C_20price_20and_20fit_20badge_3B_20with_20a_201_-651d72cd/default/attempt-0/screenshots/001-failure.png`, trace `.e2e/artifacts/iphone14/tests_04-trips-budget.e2e.ts__Trips_3A_20cards_20show_20photo_2C_20price_20and_20fit_20badge_3B_20with_20a_201_-651d72cd/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_04-trips-budget.e2e.ts__Trips_3A_20cards_20show_20photo_2C_20price_20and_20fit_20badge_3B_20with_20a_201_-651d72cd/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_04-trips-budget.e2e.ts-Trips__cards_show_photo__price_and_fit_badge__with_a_1_000_PLN_budget_no_over-budg-cd90b359-5ae45cb9.md`

**🔴 Inbox: "Run the scan now" ends in a notification or a clear "nothing new" state**  
`tests/08-inbox.e2e.ts:13`

**ASSERTION_INCONCLUSIVE** at step 6 of 6: `agent.assert` "after the scan the inbox either lists notifications or says clearly that nothing new was found", after 2.6s and 1 model call

> The scan is still marked “Scanning,” so its final inbox result is not yet shown. The status mentions one new notification, but no notification is listed yet.; the judge saw the semantic tree only; if the engine captures pixels, pass vision: true when the answer is in pixels

- Screen: `<frontend-url>/inbox`

Evidence: screenshot `.e2e/artifacts/iphone14/tests_08-inbox.e2e.ts__Inbox_3A_20_22Run_20the_20scan_20now_22_20ends_20in_20a_20notification_20or_20a_20clear_-9c5bfb14/default/attempt-0/screenshots/002-failure.png`, screenshot `.e2e/artifacts/iphone14/tests_08-inbox.e2e.ts__Inbox_3A_20_22Run_20the_20scan_20now_22_20ends_20in_20a_20notification_20or_20a_20clear_-9c5bfb14/default/attempt-0/screenshots/001-assert.png`, trace `.e2e/artifacts/iphone14/tests_08-inbox.e2e.ts__Inbox_3A_20_22Run_20the_20scan_20now_22_20ends_20in_20a_20notification_20or_20a_20clear_-9c5bfb14/default/attempt-0/trace/trace.zip`, log `.e2e/artifacts/iphone14/tests_08-inbox.e2e.ts__Inbox_3A_20_22Run_20the_20scan_20now_22_20ends_20in_20a_20notification_20or_20a_20clear_-9c5bfb14/default/attempt-0/failure/screen.txt` · Details: `.e2e/failures/tests_08-inbox.e2e.ts-Inbox___Run_the_scan_now__ends_in_a_notification_or_a_clear__nothing_new__state-29eb53d9-ef44b4c3.md`

<details>
<summary>All 14 tests in 9 files</summary>

|  | Test | Agent | Time |
| --- | --- | --- | --- |
| 🔴 | **tests/02-language.e2e.ts** · 5 failed, 1 passed | 7 steps · 12 calls | 1m 50s |
| 🟢 | PL/EN toggle switches the visible text on Travel DNA | 2 steps · 3 calls | 10.0s |
| 🔴 | PL/EN toggle switches the visible text on Free time | 1 step · 2 calls | 26.1s |
| 🔴 | PL/EN toggle switches the visible text on Trips | 1 step · 1 call | 22.4s |
| 🔴 | PL/EN toggle switches the visible text on Profile | 1 step · 2 calls | 6.4s |
| 🔴 | PL/EN toggle switches the visible text on Feedback survey | 1 step · 2 calls | 22.7s |
| 🔴 | PL/EN toggle switches the visible text on Inbox | 1 step · 2 calls | 22.5s |
| 🔴 | **tests/04-trips-budget.e2e.ts** · 1 failed |  | 4.1s |
| 🔴 | Trips: cards show photo, price and fit badge; with a 1,000 PLN budget no over-budget card sits above an in-budget one |  | 4.1s |
| 🔴 | **tests/08-inbox.e2e.ts** · 1 failed | 2 steps · 6 calls | 43.1s |
| 🔴 | Inbox: "Run the scan now" ends in a notification or a clear "nothing new" state | 2 steps · 6 calls | 43.1s |
| 🟢 | **tests/01-travel-dna.e2e.ts** · 1 passed | 3 steps · 8 calls | 22.8s |
| 🟢 | Travel DNA: swiping the deck ends on a result that explains itself with your swipes | 3 steps · 8 calls | 22.8s |
| 🟢 | **tests/03-pick-dates.e2e.ts** · 1 passed | 2 steps · 5 calls | 14.7s |
| 🟢 | Free time: picking a date range in the calendar carries those dates to the Trips header | 2 steps · 5 calls | 14.7s |
| 🟢 | **tests/05-receipt.e2e.ts** · 1 passed | 2 steps · 4 calls | 17.1s |
| 🟢 | Receipt: every price row shows its source and fetch time, and the inputs hash is shown | 2 steps · 4 calls | 17.1s |
| 🟢 | **tests/06-swipe-offers.e2e.ts** · 1 passed | 2 steps · 4 calls | 17.3s |
| 🟢 | Swipe on offers: liking a card shows what was learned, and undo brings it back | 2 steps · 4 calls | 17.3s |
| 🟢 | **tests/07-survey.e2e.ts** · 1 passed | 2 steps · 5 calls | 16.7s |
| 🟢 | Post-trip survey: submitting answers shows how the ranking weights changed | 2 steps · 5 calls | 16.7s |
| 🟢 | **tests/09-console.e2e.ts** · 1 passed |  | 53.9s |
| 🟢 | No console errors and no hydration errors on any route |  | 53.9s |
</details>

<sub>e2e 0.16.0 · 1m 51s · iphone14</sub>
