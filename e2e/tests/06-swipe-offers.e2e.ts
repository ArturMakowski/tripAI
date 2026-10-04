import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

/**
 * T23: one ranked list whose rows are swipeable (mail-app style). A real pointer swipe on a row:
 * right = "I want to go" (the learned toast names the city), left = "Not for me" (the row collapses
 * out; the toast's Undo brings it back in the same place). Deterministic: no agent steps.
 */
test('Swipe on offers: swiping a row right shows what was learned; left hides it and Undo brings it back in place', async ({ agent, app, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/trips');
  // Wait for the final ranking (the list is aria-busy while loading/refining, as in test 10), so the full
  // phase can't land mid-swipe.
  await expect(browser.locator('main ul[aria-busy]').first()).toBeVisible({ timeout: 60_000 });
  await expect(browser.locator('main ul[aria-busy="true"]')).toHaveCount(0, { timeout: 90_000 });

  const rowIds = async () =>
    (await browser.evaluate(() =>
      [...document.querySelectorAll('main ul > li article a[href^="/trips/"]')].map((a) => a.getAttribute('href') ?? ''),
    )) as string[];
  /** A horizontal pointer swipe across row `i` (scrolled into view), by `dx` CSS px. */
  const swipeRow = async (i: number, dx: number) => {
    const box = (await browser.evaluate((n) => {
      const li = document.querySelectorAll('main ul > li')[n] as HTMLElement;
      li.scrollIntoView({ block: 'center' });
      const r = li.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, i)) as { x: number; y: number; w: number; h: number };
    const y = box.y + Math.min(140, box.h / 2);
    const from = { x: dx > 0 ? box.x + 40 : box.x + box.w - 40, y };
    await screen.swipe({ from, to: { x: from.x + dx, y: y + 4 } });
  };
  const toast = (re: RegExp) => browser.locator('div[role="status"][aria-live="polite"]').filter({ hasText: re });

  const before = await rowIds();
  expect(before.length, 'trips in the list').toBeGreaterThanOrEqual(2);
  const city = async (href: string) =>
    ((await browser.locator(`main ul > li article a[href="${href}"]`).getAttribute('aria-label')) ?? '').split(',')[0];

  // right: like
  const likedCity = await city(before[0]);
  await swipeRow(0, 260);
  await expect(toast(/learned|saved|zapamiętane|zapisane/i)).toContainText(likedCity);
  expect(await rowIds(), 'a like keeps the row in the list').toEqual(before);

  // left: the row collapses out, Undo restores it in place
  const target = before[1];
  const hiddenCity = await city(target);
  await swipeRow(1, -260);
  await expect(browser.locator(`main ul > li article a[href="${target}"]`)).toHaveCount(0);
  await expect(toast(/zapamiętane|learned/i)).toContainText(hiddenCity);
  await toast(/zapamiętane|learned/i).getByRole('button', /^(undo|cofnij)$/i).tap();
  await expect(toast(/undone|cofnięte/i)).toContainText(hiddenCity);
  await expect(browser.locator(`main ul > li article a[href="${target}"]`)).toHaveCount(1);
  expect(await rowIds(), 'back in the same place').toEqual(before);
  await agent.assert('the trips list shows trip cards, and a status message says the last swipe was undone');
});
