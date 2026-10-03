import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard, pln } from './support/tripai.ts';

test('Trips: cards show photo, price and fit badge; with a 1,000 PLN budget no over-budget card sits above an in-budget one', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);

  // Demo profile, budget lowered to 1,000 PLN with the keyboard (slider 600..5000, step 100).
  await app.open('/profile');
  // The thumb has no accessible name (aria-label sits on the slider root), so take the first slider: Budget.
  const budget = screen.getByRole('slider').first();
  await budget.press('Home');
  for (let i = 0; i < 4; i++) await budget.press('ArrowRight');
  await expect(screen.getByText(/1[,\s ]?000\s*(PLN|zł)/).first()).toBeVisible();

  await screen.getByRole('link', /^(Trips|Podróże|Wyjazdy)$/).tap();
  await expect(screen.getByRole('link', /budget|budżet/i).first()).toContainText(/1[,\s ]?000/);

  const cards = browser.locator('main li:has(a[href^="/trips/"])');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  const texts = await cards.allTextContents();
  expect(texts.length).toBeGreaterThan(0);

  for (const [i, text] of texts.entries()) {
    expect(pln(text), `card ${i + 1} shows a PLN price: ${text.slice(0, 80)}`).not.toBeNull();
    expect(text, `card ${i + 1} shows a fit badge`).toMatch(/(great|good|poor) fit|mixed|świetn|dobr|słab|mieszan/i);
  }
  // Every card photo actually loads. Photos below the fold are lazy, so bring each into view and decode it.
  const broken = await browser.evaluate(async () => {
    const bad: string[] = [];
    for (const img of [...document.querySelectorAll('main li a[href^="/trips/"] img')] as HTMLImageElement[]) {
      img.scrollIntoView({ block: 'center' });
      img.loading = 'eager';
      const ok = await Promise.race([
        img.decode().then(() => img.naturalWidth > 0, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 10_000)),
      ]);
      if (!ok) bad.push(img.alt || img.currentSrc);
    }
    window.scrollTo(0, 0);
    return bad;
  });
  expect(broken, 'card photos that failed to load').toEqual([]);

  // Budget order: once an over-budget card appears, no in-budget card may follow it.
  const over = texts.map((t) => /over budget|ponad budżet|powyżej budżetu/i.test(t) || (pln(t) ?? 0) > 1000);
  const firstOver = over.indexOf(true);
  const inBudgetBelowOver = firstOver === -1 ? [] : over.slice(firstOver).map((o, k) => (!o ? firstOver + k + 1 : 0)).filter(Boolean);
  expect(inBudgetBelowOver, `in-budget cards ranked below an over-budget one (card #${firstOver + 1} is over)`).toEqual([]);

  await agent.assert('each trip card shows a destination photo, a total price in PLN and a fit badge such as "Great fit"', { vision: true });
});
