import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

test('Swipe on offers: liking a card shows what was learned, and undo brings it back', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/trips');
  // The swipe view ("Karty") is the default on a first visit (no toggle tap needed). Wait for the final
  // ranking first (the deck is aria-busy while loading/refining, like the list in test 10), so the full
  // phase can't land mid-swipe and the step is deterministic.
  await expect(browser.locator('main section[aria-busy="false"]')).toHaveCount(1, { timeout: 90_000 });
  const deck = screen.getByRole('region', 'Swipe');
  const topCard = deck.getByRole('group').first();
  await expect(topCard).toBeVisible({ timeout: 60_000 });
  const city = ((await topCard.getAttribute('aria-label')) ?? '').split(',')[0];

  await agent.act('on the swipe deck, say you want to go to the offer on top (the like / "I want to go" / "Chcę tam" choice)');
  const toast = browser.locator('div[role="status"][aria-live="polite"]').filter({ hasText: /learned|saved|zapamiętane|zapisane/i });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(city);

  await agent.act('undo the last swipe');
  await expect(browser.locator('div[role="status"][aria-live="polite"]').filter({ hasText: /undone|cofnięte/i })).toBeVisible();
  await expect(deck.getByRole('group').first()).toHaveAttribute('aria-label', new RegExp(`^${city},`));
});
