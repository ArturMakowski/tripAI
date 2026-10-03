import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

// One test per main screen, so the report says exactly which screens lack a working PL/EN switch.
const SCREENS = [
  { name: 'Travel DNA', path: '/onboarding' },
  { name: 'Free time', path: '/windows' },
  { name: 'Trips', path: '/trips' },
  { name: 'Profile', path: '/profile' },
  { name: 'Feedback survey', path: '/survey' },
  { name: 'Inbox', path: '/inbox' },
];

for (const s of SCREENS) {
  test(`PL/EN toggle switches the visible text on ${s.name}`, { tags: ['i18n'] }, async ({ app, agent, screen, browser }) => {
    await guard(browser, app.baseUrl);
    await app.open(s.path);
    const heading = screen.getByRole('heading', { level: 1 }).first();
    await expect(heading).toBeVisible({ timeout: 60_000 });
    const before = (await heading.textContent())?.trim() ?? '';

    // Deterministic: tap the language that isn't selected in the header switch (an agent step here kept
    // re-tapping the already-checked language, and /profile has a second switch in the page body).
    const other = (await browser.evaluate(() => {
      const r = document.querySelector('header [role="radiogroup"] [role="radio"][aria-checked="false"]');
      return r?.getAttribute('aria-label') ?? null;
    })) as string | null;
    expect(other, `no language switch in the header of ${s.name}`).not.toBeNull();
    await screen.getByRole('banner').getByRole('radio', other!).tap();

    // Deterministic: the page title text actually changed language.
    await expect(heading, `no working language switch on ${s.name}: the title still reads "${before}"`).not.toHaveText(before);
    await agent.assert(
      'apart from the language switch itself (which may name both languages), the headings, buttons and labels on this screen are all in the same language: no mix of Polish and English',
    );
  });
}
