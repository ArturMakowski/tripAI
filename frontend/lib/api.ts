/**
 * API v0 client (backend/src/tripai/api/app.py). Talks to NEXT_PUBLIC_API_URL
 * when set; otherwise, or if the backend is unreachable, serves the in-browser
 * fixtures so the demo never dead-ends. Every call reports which one answered.
 */
import * as mock from "./mock/api";
import type {
  BridgeWindow,
  ChatMessage,
  FeedbackRequest,
  FeedbackResponse,
  FreeWindow,
  Health,
  InterviewResult,
  RankedRecommendation,
  RecommendationsRequest,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1" || !API_URL;
export const USER_ID = "demo";

export type DataMode = "live" | "fixture";
export interface Result<T> {
  data: T;
  mode: DataMode;
}

async function http<T>(path: string, init?: RequestInit, timeoutMs = 25_000): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function withFallback<T>(live: () => Promise<T>, fixture: () => Promise<T>): Promise<Result<T>> {
  if (FORCE_MOCK) return { data: await fixture(), mode: "fixture" };
  try {
    return { data: await live(), mode: "live" };
  } catch (err) {
    console.warn("[tripai] backend unavailable, using fixtures:", err);
    return { data: await fixture(), mode: "fixture" };
  }
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
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

  recommendations: (req: RecommendationsRequest) =>
    withFallback<RankedRecommendation[]>(
      () => http("/recommendations", post({ limit: 10, explain_top: 3, ...req }), 45_000),
      () => mock.recommendations(req),
    ),

  feedback: (req: FeedbackRequest) =>
    withFallback<FeedbackResponse>(
      () => http("/feedback", post({ user_id: USER_ID, ...req })),
      () => mock.feedback(req),
    ),
};
