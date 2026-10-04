import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

// Receipt after the declutter (PR #31, round 3 #41): the money lines sit above the fold; their compact source
// chips ("Source · 3 Oct", full fetch time in the tooltip) are behind one "ⓘ Sources / Źródła" toggle; the
// exact score math (factor bars, the total out of 100, the formula) lives in the collapsed "Audit" row.
test('Receipt: every price row shows its source and fetch time, and the exact score math is one tap away', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/trips');
  // T23: one ranked list (no List/Swipe toggle); wait for it to render.
  await expect(browser.locator('main ul[aria-busy]').first()).toBeVisible({ timeout: 60_000 });
  const top = browser.locator('main li article a[href^="/trips/"]').first();
  await expect(top).toBeVisible({ timeout: 60_000 });
  // Deterministic: open the top-ranked trip (the whole card is one link).
  await browser.goto((await top.getAttribute('href')) ?? '/trips');

  // Each priced line (flight, stay) carries "Source · 3 Oct" with the fetch time in its tooltip, once the
  // section's "Sources / Źródła" toggle is open (the chips only render then).
  const rows = browser.locator('main [data-line]');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await screen.getByRole('button', /^(sources|źródła)$/i).tap();
  const lines = (await browser.evaluate(() =>
    [...document.querySelectorAll('main [data-line]')].map((r) => {
      const chip = r.querySelector('[title]');
      return { text: (r.textContent ?? '').trim(), chip: (chip?.textContent ?? '').trim(), title: chip?.getAttribute('title') ?? '' };
    }),
  )) as { text: string; chip: string; title: string }[];
  expect(lines.length, 'priced lines on the receipt').toBeGreaterThanOrEqual(2);
  for (const l of lines) {
    expect(l.text, `price on: ${l.text}`).toMatch(/\d\s*(PLN|zł)/i);
    // Hand-curated demo data (fixture mode, e.g. a local run without a backend) was never fetched,
    // so it is labelled as such instead of carrying a date; live data always has one.
    if (/^(demo data|dane demo)$/i.test(l.chip)) continue;
    expect(l.chip, `source + fetch date on: ${l.text}`).toMatch(/[A-Za-zÀ-ž][\w .-]+ · \d{1,2} \w{3,4}/);
    expect(l.title, `fetch time in the source tooltip: ${l.text}`).toMatch(/\d{1,2}:\d{2}/);
  }

  // The exact score: collapsed under "Audit" (DECLUTTER: one tap away). Since cda3b78 Audit holds only the
  // factor bars, the total out of 100 and the formula (no inputs hash, engine line or data confidence).
  await screen.getByRole('button', /^(audit|audyt)/i).tap();
  await expect(screen.getByText(/^\d{1,3}([.,]\d)?\s*\/\s*100$/).first()).toBeVisible();
  await expect(screen.getByText(/[0-9a-f]{8,}…[0-9a-f]{6,}/)).toHaveCount(0);
  await agent.assert('on the receipt, the flight and the hotel price lines each name their data source and when it was fetched');
});
