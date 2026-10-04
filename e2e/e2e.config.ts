import { existsSync } from 'node:fs';
import { openai } from '@ai-sdk/openai';
import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

// OPENAI_API_KEY comes from the environment, or from an env file (never committed).
// Default: the repo-root .env; override with TRIPAI_ENV_FILE=/path/to/.env.
const envFile = process.env.TRIPAI_ENV_FILE ?? '../.env';
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

/** E2E_BASE_URL wins; else the deployed app from E2E_PROD_URL (repo-root .env, not committed); else local. */
export const BASE_URL = process.env.E2E_BASE_URL || process.env.E2E_PROD_URL || 'http://localhost:3000';

// iPhone 14 (Playwright's device descriptor): 390x844 CSS px, Mobile Safari user agent.
const IPHONE_14 = {
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
};

const context = [
  'TripAI is a mobile travel planner. The user never types a destination: it recommends where AND when to go.',
  'Screens: Welcome (/), Travel DNA swipe deck (/onboarding, called "DNA Podróżnika" in Polish), Free time (/windows, a date-range calendar),',
  'Trips (/trips, ranked trip cards; a "Lista"/"List" vs "Swipe" view switch), the receipt "Why this, why now" (/trips/<id>),',
  'Profile (/profile), Feedback (/survey, post-trip survey) and the proactive Inbox (/inbox, bell icon in the header).',
  'Copy can be Polish or English. Polish words you may see: "To ja" (that\'s me), "Bardzo ja!" (so me), "Nie ja" (not me),',
  '"Zależy" (depends), "Cofnij" (undo), "Chcę tam" (I want to go), "Nie dla mnie" (not for me), "Zapamiętane" (learned/remembered).',
  '"My" is also a Polish word (we): "My pilnujemy. Ty decydujesz." (we watch, you decide) is all Polish.',
  'A fit badge reads e.g. "Great fit", "Good fit", "Mixed", "Poor fit". Prices are in PLN (zł).',
].join(' ');

export default {
  targets: [
    {
      name: 'iphone14',
      engine: web({ browser: 'chromium', ...IPHONE_14 }),
      // A stable identity keeps the committed replays valid for prod and local runs alike.
      // E2E_ENVIRONMENT=production lets a local build of a branch record/replay under the same cache key as the
      // deployed app (the key includes the environment; localhost defaults to "test").
      app: {
        url: BASE_URL,
        identity: 'tripai-web',
        ...(process.env.E2E_ENVIRONMENT ? { environment: process.env.E2E_ENVIRONMENT as 'test' | 'staging' | 'production' } : {}),
      },
    },
  ],
  agents: {
    default: {
      // Pinned by the team (no framework default): OpenAI gpt-6-luna, key from OPENAI_API_KEY.
      model: openai('gpt-6-luna'),
      context,
      system:
        'Use only the demo profile and the data already on screen; never type personal data. ' +
        'Prefer the visible buttons over gestures. Dismiss notification toasts you did not ask for.',
      // Cost caps per agent step (the framework has no global run budget).
      maxSteps: 15,
      maxModelCalls: 15,
    },
  },
  // Recordings live in .e2e/cache and are committed: reruns replay agent.act steps without model calls.
  cache: { mode: 'read-write', dir: '.e2e/cache' },
  timeout: 180_000,
  assertionTimeout: 15_000,
  retries: 0,
  workers: 3,
  reporters: ['list', 'markdown', 'junit'],
} satisfies E2EConfig;
