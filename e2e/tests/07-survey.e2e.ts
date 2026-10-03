import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

test('Post-trip survey: submitting answers shows how the ranking weights changed', async ({ app, agent, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/survey');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });

  await agent.act('answer the post-trip survey with the demo answers and submit it to update my profile');

  await expect(screen.getByRole('heading', /ranking weights|wagi/i)).toBeVisible({ timeout: 60_000 });
  // Deterministic: at least one "before% → after%" weight line.
  await expect(screen.getByText(/\d+%\s*→\s*\d+%/).first()).toBeVisible();
  await agent.assert('the screen shows which ranking weights changed after the survey, with before and after values, and why');
});
