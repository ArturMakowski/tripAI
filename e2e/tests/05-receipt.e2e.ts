import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

test('Receipt: every price row shows its source and fetch time, and the inputs hash is shown', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/trips');
  await expect(browser.locator('main li:has(a[href^="/trips/"])').first()).toBeVisible({ timeout: 60_000 });

  await agent.act('open the "why this, why now" details of the top-ranked trip');
  await expect(screen.getByRole('heading', /^receipt$|^paragon$/i)).toBeVisible();

  // Deterministic: each priced line of the receipt (flight, hotel, deal baseline) carries "Source · 3 Oct, 16:57".
  // (receipt rows are <div id="ev-N">; the evidence list below reuses the same ids on <li>)
  const rows = browser.locator('main div[id^="ev-"]');
  await expect(rows.first()).toBeVisible();
  const texts = await rows.allTextContents();
  expect(texts.length, 'priced rows on the receipt').toBeGreaterThanOrEqual(2);
  for (const t of texts) {
    expect(t, `price row: ${t}`).toMatch(/\d\s*(PLN|zł)/i);
    expect(t, `source + fetch time on: ${t}`).toMatch(/[A-Za-z][\w .-]+ · \d{1,2} \w{3,4},? \d{1,2}:\d{2}/);
  }

  await expect(screen.getByRole('heading', /inputs hash|hash danych/i)).toBeVisible();
  await expect(screen.getByText(/^[0-9a-f]{8,}…[0-9a-f]{6,}$/)).toBeVisible();
  await agent.assert('on the receipt, the flight and the hotel price lines each name their data source and when it was fetched');
});
