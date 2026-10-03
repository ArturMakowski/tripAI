import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

// 1–3 Jan 2027 is a window the live cache already prices, so phase=fast fills Trips with no SerpApi call.
test('Free time: picking a date range in the calendar carries those dates to the Trips header', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/windows');
  await expect(screen.getByRole('heading', /pick your dates|wybierz/i).first()).toBeVisible({ timeout: 60_000 });

  await agent.act('in the "Pick your dates" calendar, go to January 2027 and pick the date range from Friday 1 January 2027 to Sunday 3 January 2027');
  await expect(screen.getByRole('button', /1 January 2027/).first()).toBeVisible();

  await screen.getByRole('link', /^(Trips|Podróże|Wyjazdy)$/).tap();
  const header = screen.getByText(/for your dates|na twoje terminy/i);
  await expect(header).toBeVisible({ timeout: 30_000 });
  // Deterministic: the header names exactly the picked range.
  await expect(screen.getByRole('paragraph').filter({ hasText: /for your dates|na twoje terminy/i })).toContainText(/1\s*[–-]\s*3\s*(Jan|sty)/i);
  await agent.assert('the Trips page says its results are for the dates 1–3 January');
});
