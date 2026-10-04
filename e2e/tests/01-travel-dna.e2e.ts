import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

// Time to value (T19, docs/USER_TESTING.md): welcome → the 14-card Travel DNA deck → one pre-filled confirm
// (next long weekend, 1 person, default airport) → ranked trips. No intro before the deck and no "accept your
// profile" stop: the persona is a compact card on /trips, the full result (with the swipes behind it) is in
// Profile. Every tap on that path is counted. The steps are deterministic (on-screen controls), so nothing here
// needs a recording; only the final judgement calls the model.
const FIRST_RUN_TAPS = 16; // 1 (welcome) + 14 (deck) + 1 (confirm); before T19: 19–22 (intro + result stop)

test('First run: welcome → 14 swipes → one confirm → ranked trips in 16 taps; persona on /trips, full result in Profile', async ({ app, agent, screen, browser }) => {
  // A real first run: the tutorial is NOT pre-marked as seen, so an intro in the way would show up here.
  await guard(browser, app.baseUrl, { tutorial: true });
  await app.open('/');
  // Language for the assertions below (setup, not part of the counted path).
  await screen.getByRole('radio', 'English').tap();

  let taps = 0;
  const tap = async (target: { tap(): Promise<unknown> }) => {
    await target.tap();
    taps++;
  };

  // Welcome → straight into the deck: no intro dialog in between.
  await tap(screen.getByRole('link', /^Let’s go/));
  await expect(screen.getByRole('heading', /swipe/i, { level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(browser.locator('[role="dialog"]')).toHaveCount(0);

  // The deck: 12 statements + 2 yes/no cards, answered with the on-screen buttons (same as the arrow
  // gestures): statements alternate "So me! (↑)" / "That's me (→)", the yes/no cards get "Yes (→)".
  for (let i = 0; i < 14; i++) {
    const gesture = i < 12 && i % 2 === 0 ? /\(↑\)/ : /\(→\)/;
    await tap(screen.getByRole('button', gesture));
  }

  // One confirm, pre-filled: the next long weekend, 1 person, the default airport; each value editable in place.
  const confirm = browser.locator('[data-testid="trip-confirm"]');
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  await expect(confirm).toContainText('Next long weekend');
  await expect(confirm).toContainText('1 person');
  await expect(confirm).toContainText('KRK');
  await expect(screen.getByRole('button', /^Change$/).first()).toBeVisible();
  await tap(screen.getByRole('button', /^Show trips/));

  // Ranked trips: the fast results show at once (two-phase load), with the persona card on top.
  await browser.waitForURL(/\/trips$/, { timeout: 30_000 });
  await expect(browser.locator('main [data-testid="trip-total"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(browser.locator('[data-testid="persona-card"]')).toBeVisible();
  expect(taps, 'taps from the welcome screen to ranked trips').toBe(FIRST_RUN_TAPS);

  // The full result lives in Profile: the persona plus every reason citing the swiped cards, one tap away
  // behind the single ⓘ ("Why this result", a bottom sheet).
  await browser.goto('/profile');
  await expect(browser.locator('[data-testid="dna-persona"]')).toBeVisible({ timeout: 30_000 });
  const why = screen.getByRole('button', /^Why this result$/);
  await why.tap();
  await expect(screen.getByText(/because you swiped/i).first()).toBeVisible();
  await agent.assert('the open "Why this result" sheet explains the travel profile by quoting answers the user swiped (e.g. "because you swiped So me! on ...")');
});
