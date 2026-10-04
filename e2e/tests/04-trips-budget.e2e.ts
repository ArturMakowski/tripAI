import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard, pln } from './support/tripai.ts';

test('Trips: cards show photo, price and (once judged) a fit badge; with a 1,000 PLN budget no over-budget card sits above an in-budget one', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);

  // Demo profile: switch on the optional "Never show trips over…" limit (off by default since PR #31),
  // then set it to 1,000 PLN with the keyboard (slider 600..5000, step 100). The thumb carries the name.
  await app.open('/profile');
  await screen.getByRole('switch', /never show trips over|nie pokazuj wyjazdów/i).tap();
  const budget = screen.getByRole('slider', /maximum price per person|maksymalna cena na osobę/i);
  await budget.press('Home');
  for (let i = 0; i < 4; i++) await budget.press('ArrowRight');
  await expect(screen.getByText(/1[,\s ]?000\s*(PLN|zł)/).first()).toBeVisible();

  await screen.getByRole('link', /^(Trips|Podróże|Wyjazdy)$/).tap();
  // T23: one ranked list (no List/Swipe toggle); wait for it to render.
  await expect(browser.locator('main ul[aria-busy]').first()).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole('link', /budget|budżet/i).first()).toContainText(/1[,\s ]?000/);

  const cards = browser.locator('main li:has(article a[href^="/trips/"])');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  const texts = await cards.allTextContents();
  expect(texts.length).toBeGreaterThan(0);

  for (const [i, text] of texts.entries()) {
    expect(pln(text), `card ${i + 1} shows a PLN price: ${text.slice(0, 80)}`).not.toBeNull();
  }
  // A fit badge appears only once the backend has judged the trip (fit = null in the fast phase means
  // "not judged yet": no badge, still in the main list). Every badge shown must be a real verdict.
  const badges = (await browser.evaluate(() =>
    [...document.querySelectorAll('main li article [data-tour="fit"]')].map((b) => (b.textContent ?? '').trim()),
  )) as string[];
  for (const b of badges) expect(b, 'fit badge text').toMatch(/(great|good|poor) fit|mixed|not your style|świetn|dobr|słab|mieszan|częściowo|nie w twoim/i);
  // Every card photo actually loads. Photos below the fold are lazy, so bring each into view and decode it.
  const broken = await browser.evaluate(async () => {
    const bad: string[] = [];
    for (const img of [...document.querySelectorAll('main li article img')] as HTMLImageElement[]) {
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

  await agent.assert('each trip card shows a destination photo and a total price in PLN; a fit badge such as "Great fit" may be missing on trips that are not judged yet', { vision: true });
});
