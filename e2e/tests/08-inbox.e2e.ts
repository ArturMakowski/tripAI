import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

// @live: the scan runs the real proactive workflow (provider calls), so it is excluded from `npm run e2e`.
test('Inbox: "Run the scan now" ends in a notification or a clear "nothing new" state', { tags: ['live'] }, async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl, { live: true });
  await app.open('/inbox');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });

  await agent.act('run the proactive scan now');
  // The scan is done when its button is back (it reads "Scanning" and is disabled meanwhile).
  await expect(screen.getByRole('button', /^(Scan|Skan)$/)).toBeEnabled({ timeout: 150_000 });
  await expect(screen.getByText(/new notification|nothing new|nic nowego|nowe powiadomieni/i).first()).toBeVisible();
  await agent.assert('after the scan the inbox either lists notifications or says clearly that nothing new was found');
});
