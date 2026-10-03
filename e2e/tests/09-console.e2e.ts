import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard, type PageError, realErrors } from './support/tripai.ts';

const ROUTES = ['/', '/onboarding', '/onboarding/chat', '/windows', '/trips', '/profile', '/survey', '/inbox', '/inbox/settings', '/credits'];

test('No console errors and no hydration errors on any route', { timeout: 300_000 }, async ({ app, screen, browser }) => {
  const g = await guard(browser, app.baseUrl);
  const found: PageError[] = [];

  const visit = async (path: string) => {
    await browser.goto(path, { waitUntil: 'load' });
    await expect(browser.locator('body')).toBeVisible({ timeout: 30_000 });
    await browser.evaluate(() => new Promise<null>((r) => setTimeout(() => r(null), 3000))); // let hydration + first fetches settle
    const errors = await g.errors();
    expect(errors, `error recorder injected on ${path}`).not.toBeNull();
    found.push(...realErrors(errors ?? [], app.baseUrl));
    await expect(screen.getByText(/application error|unhandled runtime error/i)).toHaveCount(0);
  };

  for (const path of ROUTES) await visit(path);

  // The receipt of whatever trip is ranked first right now.
  await browser.goto('/trips');
  // /trips opens on the swipe view until a view is picked; the receipt link is read from the list.
  await screen.getByRole('button', /^(List|Lista)$/).tap();
  const first = browser.locator('main li article a[href^="/trips/"]').first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  const href = await first.getAttribute('href');
  if (href) await visit(href);

  // The SerpApi guard did its job: /trips asked for the full pipeline and got phase=fast instead.
  expect(g.downgraded()).toBeGreaterThan(0);

  const hydration = found.filter((e) => /hydrat|#418|#423|#425|did not match/i.test(e.message));
  expect(hydration, 'hydration errors').toEqual([]);
  expect(found, 'console / page errors').toEqual([]);
});
