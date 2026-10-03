import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

// Onboarding order (docs/USER_TESTING.md, PR #31): dates + party + airports first, then the
// 14-card deck (its price questions come only here), then the result. The steps are deterministic
// (on-screen controls), so nothing here needs a recording; only the final judgement calls the model.
test('Travel DNA: dates and party first, then the deck, ending on a result that explains itself with your swipes', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/onboarding');

  // The app-wide PL/EN switch in the header.
  await screen.getByRole('radio', 'English').tap();

  // Step 1: "When, and who's coming?" — before any price question.
  await expect(screen.getByRole('heading', /when, and who/i, { level: 1 })).toBeVisible();
  await screen.getByRole('button', /weekend/i).first().tap();
  await screen.getByRole('button', 'One person more').tap();
  await expect(screen.getByText(/^2 people$/)).toBeVisible();
  await screen.getByRole('button', 'Next').tap();

  // Step 2: the deck. 12 statements + 2 yes/no cards, answered with the on-screen buttons (same as the
  // arrow gestures): statements alternate "So me! (↑)" / "That's me (→)", the yes/no cards get "Yes (→)".
  await expect(screen.getByRole('heading', /swipe/i, { level: 1 })).toBeVisible();
  for (let i = 0; i < 14; i++) {
    const gesture = i < 12 && i % 2 === 0 ? /\(↑\)/ : /\(→\)/;
    await screen.getByRole('button', gesture).tap();
  }

  // The result follows the last card directly (no budget step). It renders the backend's reasons, each
  // citing the swiped cards; since the declutter they sit one tap away behind "Why these weights" (ⓘ).
  const why = screen.getByRole('button', 'Why these weights');
  await expect(why).toBeVisible({ timeout: 30_000 });
  await why.tap();
  await expect(screen.getByText(/because you swiped/i).first()).toBeVisible();
  await agent.assert('the result screen shows a travel profile and explains parts of it by quoting answers the user swiped (e.g. "because you swiped So me! on ...")');
});
