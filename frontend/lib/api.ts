/**
 * API v0 client (docs/ARCHITECTURE.md). Talks to NEXT_PUBLIC_API_URL when set;
 * otherwise, or if the backend is unreachable, serves the in-browser fixtures
 * so the demo never dead-ends. Every call reports which one answered.
 */
import * as mock from "./mock/api";
import type {
  ChatMessage,
  FeedbackRequest,
  FeedbackResponse,
  FreeWindow,
  InterviewResponse,
  Recommendation,
  RecommendationsRequest,
  TasteProfile,
  Weights,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1" || !API_URL;

export type DataMode = "live" | "fixture";
export interface Result<T> {
  data: T;
  mode: DataMode;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
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

export const api = {
  interview: (messages: ChatMessage[]) =>
    withFallback<InterviewResponse>(
      () => http("/interview", { method: "POST", body: JSON.stringify({ messages }) }),
      () => mock.interview(messages),
    ),

  windows: (from?: string, to?: string) => {
    const qs = new URLSearchParams({ ...(from && { from }), ...(to && { to }) }).toString();
    return withFallback<FreeWindow[]>(
      () => http(`/windows${qs ? `?${qs}` : ""}`),
      () => mock.windows(from, to),
    );
  },

  recommendations: (req: RecommendationsRequest) =>
    withFallback<Recommendation[]>(
      () => http("/recommendations", { method: "POST", body: JSON.stringify(req) }),
      () => mock.recommendations(req),
    ),

  /** Accepts both the v0 shape (bare TasteProfile) and the proposed {profile, weights}. */
  feedback: (req: FeedbackRequest, ctx: { profile: TasteProfile; weights: Weights }) =>
    withFallback<FeedbackResponse>(
      async () => {
        const raw = await http<TasteProfile | FeedbackResponse>("/feedback", {
          method: "POST",
          body: JSON.stringify(req),
        });
        return "user_id" in raw ? { profile: raw } : raw;
      },
      () => mock.feedback(req, ctx),
    ),
};
