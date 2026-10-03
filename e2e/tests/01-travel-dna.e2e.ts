import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

// Onboarding order: the 14-card Travel DNA deck first (the engaging part), then "When, and who's coming?"
// (dates + party + airports), then the result. The steps are deterministic (on-screen controls), so
// nothing here needs a recording; only the final judgement calls the model.
test('Travel DNA: the deck first, then dates and party, ending on a result that explains itself with your swipes', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/onboarding');

  // The app-wide PL/EN switch in the header.
  await screen.getByRole('radio', 'English').tap();

  // Step 1: the deck. 12 statements + 2 yes/no cards, answered with the on-screen buttons (same as the
  // arrow gestures): statements alternate "So me! (↑)" / "That's me (→)", the yes/no cards get "Yes (→)".
  await expect(screen.getByRole('heading', /swipe/i, { level: 1 })).toBeVisible();
  for (let i = 0; i < 14; i++) {
    const gesture = i < 12 && i % 2 === 0 ? /\(↑\)/ : /\(→\)/;
    await screen.getByRole('button', gesture).tap();
  }

  // Step 2: "When, and who's coming?" (no budget question anywhere in onboarding).
  await expect(screen.getByRole('heading', /when, and who/i, { level: 1 })).toBeVisible();
  await screen.getByRole('button', /weekend/i).first().tap();
  await screen.getByRole('button', 'One person more').tap();
  await expect(screen.getByText(/^2 people$/)).toBeVisible();
  await screen.getByRole('button', /^Show my DNA/).tap();

  // The result renders the backend's reasons, each citing the swiped cards, one tap away behind the
  // screen's single ⓘ ("Why this result", a bottom sheet; "Why these weights" before T17).
  const why = screen.getByRole('button', /^Why (this result|these weights)$/);
  await expect(why).toBeVisible({ timeout: 30_000 });
  await why.tap();
  await expect(screen.getByText(/because you swiped/i).first()).toBeVisible();
  await agent.assert('the result screen shows a travel profile and explains parts of it by quoting answers the user swiped (e.g. "because you swiped So me! on ...")');
});
