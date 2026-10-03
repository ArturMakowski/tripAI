/**
 * API v0 client (backend/src/tripai/api/app.py). Talks to the same-origin `/api`
 * proxy (app/api/[...path], lib/proxy.ts), which forwards to the private backend.
 * With NEXT_PUBLIC_MOCK=1, or if the backend is unreachable, serves the in-browser
 * fixtures so the demo never dead-ends. Every call reports which one answered.
 */
import type { Lang } from "./i18n/types";
import * as mock from "./mock/api";
import { profileDna as mockDna } from "./mock/dna";
import type {
  BridgeWindow,
  ChatMessage,
  DnaRequest,
  DnaResponse,
  FeedbackRequest,
  FeedbackResponse,
  FreeWindow,
  Health,
  InterviewResult,
  RankedRecommendation,
  RecommendationsRequest,
  RecPhase,
} from "./types";

export const API_URL = "/api";
export const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
export const USER_ID = "demo";

export type DataMode = "live" | "fixture";
export interface Result<T> {
  data: T;
  mode: DataMode;
}

/**
 * Server-issued session (backend tripai.api.session): every response carries a signed
 * token in X-TripAI-Session (passed through by the proxy); we keep it and send it back on every
 * call, so the backend ties profile/weights/recs/feedback to this browser.
 */
export const SESSION_HEADER = "X-TripAI-Session";
const SESSION_KEY = "tripai-session";
let session: string | null = null;

export function readSession(): string | null {
  if (session) return session;
  try {
    session = localStorage.getItem(SESSION_KEY);
  } catch {
    session = null;
  }
  return session;
}

export function rememberSession(res: Pick<Response, "headers">) {
  const token = res.headers.get(SESSION_HEADER);
  if (!token || token === session) return;
  session = token;
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    /* private mode: keep it in memory */
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let caps: Promise<{ phases: boolean }> | null = null;

/**
 * UI language, mirrored here by <LangSync/> so every request carries it: an
 * Accept-Language header on all calls and a `lang` field in POST bodies, so AI text
 * (interview, explanations, fit verdicts, notifications) comes back in that language.
 */
let apiLang: Lang = "en";
export const setApiLang = (l: Lang) => {
  apiLang = l;
};
export const getApiLang = () => apiLang;
export const acceptLanguage = (l: Lang = apiLang) => (l === "pl" ? "pl-PL,pl;q=0.9,en;q=0.5" : "en-GB,en;q=0.9");

async function http<T>(path: string, init?: RequestInit, timeoutMs = 25_000): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const token = readSession();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "accept-language": acceptLanguage(),
      ...(token ? { [SESSION_HEADER]: token } : {}),
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  rememberSession(res);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(res.status, `${init?.method ?? "GET"} ${path} -> ${res.status} ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function withFallback<T>(live: () => Promise<T>, fixture: () => Promise<T>, signal?: AbortSignal): Promise<Result<T>> {
  if (FORCE_MOCK) return { data: await fixture(), mode: "fixture" };
  try {
    return { data: await live(), mode: "live" };
  } catch (err) {
    // Superseded by a newer request: never resolve (callers ignore it anyway).
    if (signal?.aborted) return new Promise<Result<T>>(() => {});
    // Missing route / server down / network: expected while lanes land, so fall back quietly.
    // Any other 4xx means our request doesn't match the backend contract: shout about it.
    if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 404)
      console.error("[tripai] CONTRACT MISMATCH, falling back to fixtures:", err.message);
    else console.warn("[tripai] backend unavailable, using fixtures:", err);
    return { data: await fixture(), mode: "fixture" };
  }
}

const withLang = (body: unknown) => (body && typeof body === "object" && !Array.isArray(body) ? { lang: apiLang, ...body } : body);
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(withLang(body)) });
const qs = (p: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

export const api = {
  health: () => http<Health>("/health", undefined, 5_000),

  interview: (messages: ChatMessage[]) =>
    withFallback<InterviewResult>(
      () => http("/interview", post({ messages, user_id: USER_ID }), 45_000),
      () => mock.interview(messages),
    ),

  windows: (from: string, to: string) =>
    withFallback<FreeWindow[]>(
      () => http(`/windows?${qs({ from, to })}`),
      () => mock.windows(from, to),
    ),

  longWeekends: (from: string, to: string, maxLeave = 2) =>
    withFallback<BridgeWindow[]>(
      () => http(`/windows/long-weekends?${qs({ from, to, max_leave: String(maxLeave) })}`),
      () => mock.longWeekends(from, to),
    ),

  recommendations: (req: RecommendationsRequest, signal?: AbortSignal) =>
    withFallback<RankedRecommendation[]>(
      () => http("/recommendations", { ...post({ limit: 10, explain_top: 3, ...req }), signal }, 45_000),
      () => mock.recommendations(req),
      signal,
    ),

  /**
   * Two-phase load. The server confirms the phase it served in X-TripAI-Phase; a backend
   * without phase support ignores the query and answers in full, so `served` is null and
   * the caller must NOT fire a second (expensive) full request.
   */
  /**
   * Does the backend support two-phase /recommendations? Asked once per page load via the
   * proposed `/health.phases` flag. Fixture mode always does (mocked); anything else, including
   * an unreachable /health, means "no": the client then makes the single classic call.
   */
  capabilities: (): Promise<{ phases: boolean }> => {
    if (FORCE_MOCK) return Promise.resolve({ phases: true });
    caps ??= http<Health>("/health", undefined, 5_000)
      .then((h) => ({ phases: Array.isArray(h.phases) && h.phases.includes("fast") && h.phases.includes("full") }))
      .catch(() => ({ phases: false }));
    return caps;
  },

  /**
   * One phase of a two-phase load. Only call after `capabilities().phases`. In live mode a
   * failure THROWS (never a fixture "fast" result): the caller then degrades to the single
   * classic `recommendations()` call, so the backend runs the pipeline at most once more.
   */
  recommendationsPhase: async (
    req: RecommendationsRequest,
    phase: RecPhase,
    signal?: AbortSignal,
  ): Promise<Result<RankedRecommendation[]>> => {
    if (FORCE_MOCK) return { data: await mock.recommendations(req, phase), mode: "fixture" };
    const body = phase === "fast" ? { limit: 10, explain_top: 0, ...req } : { limit: 10, explain_top: 3, ...req };
    const data = await http<RankedRecommendation[]>(`/recommendations?phase=${phase}`, { ...post(body), signal }, phase === "fast" ? 8_000 : 60_000);
    return { data, mode: "live" };
  },

  /** Travel DNA swipes -> profile + weights + reasons (backend: tripai.profile.dna). */
  profileDna: (req: DnaRequest) =>
    withFallback<DnaResponse>(
      () => http("/profile/dna", post(req)),
      async () => mockDna(req),
    ),

  feedback: (req: FeedbackRequest) =>
    withFallback<FeedbackResponse>(
      () => http("/feedback", post({ user_id: USER_ID, ...req })),
      () => mock.feedback(req),
    ),
};
