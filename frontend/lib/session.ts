/**
 * Server-issued session (backend tripai.api.session): the API ignores client `user_id`s and
 * identifies this browser by the signed `X-TripAI-Session` token it hands out. We keep the token
 * in localStorage and send it on every request, so each browser has its own profile, inbox,
 * notification prefs and push subscription (one judge can never ping another's phone).
 */
export const SESSION_HEADER = "X-TripAI-Session";
const KEY = "tripai-session";

let memory: string | null = null;
let bootstrap: Promise<void> | null = null;

function read(): string | null {
  if (memory) return memory;
  try {
    memory = localStorage.getItem(KEY);
  } catch {
    /* SSR or storage blocked: memory only */
  }
  return memory;
}

export function rememberSession(res: Response): void {
  const token = res.headers.get(SESSION_HEADER);
  if (!token || token === memory) return;
  memory = token;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* ignore */
  }
}

export function sessionHeaders(): Record<string, string> {
  const t = read();
  return t ? { [SESSION_HEADER]: t } : {};
}

/**
 * Get a token before the first parallel requests go out; otherwise each of them would be issued
 * a different session and the profile and inbox would end up split across them.
 */
export function ensureSession(apiUrl: string): Promise<void> {
  if (read() || typeof window === "undefined") return Promise.resolve();
  bootstrap ??= fetch(`${apiUrl}/session`, { signal: AbortSignal.timeout(10_000) })
    .then(rememberSession)
    .catch(() => {})
    .finally(() => {
      bootstrap = null;
    });
  return bootstrap;
}
