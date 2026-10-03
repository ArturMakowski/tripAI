import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

test('Travel DNA: swiping the deck ends on a result that explains itself with your swipes', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/onboarding');

  await agent.act('switch the language of this screen to English');
  await expect(screen.getByRole('heading', /swipe/i, { level: 1 })).toBeVisible();

  // 12 statements + 2 yes/no cards, answered with the on-screen buttons (same as the arrow gestures):
  // statements alternate "So me! (↑)" / "That's me (→)", the yes/no cards get "Yes (→)".
  for (let i = 0; i < 14; i++) {
    const gesture = i < 12 && i % 2 === 0 ? /\(↑\)/ : /\(→\)/;
    await screen.getByRole('button', gesture).tap();
  }

  await agent.act('keep the suggested budget and home airport, and continue until the Travel DNA result is shown');

  // Deterministic: the result renders the backend's reasons, each citing the swiped cards.
  await expect(screen.getByText(/because you swiped/i).first()).toBeVisible({ timeout: 30_000 });
  await agent.assert('the result screen shows a travel profile and explains parts of it by quoting answers the user swiped (e.g. "because you swiped So me! on ...")');
});
