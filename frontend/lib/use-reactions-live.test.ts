import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Live mode (/api proxy, not mocked) with a scripted backend; Node's localStorage stub replaced by a real one.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MOCK = "0";
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
});
import { buildRecommendations, DEMO_PROFILE } from "./mock/fixtures";
import { applyReaction } from "./reactions";
import { setApiLang } from "./api";
import { useTrip } from "./store";
import { capLog, react, unreact, useSwipe, type SwipeEntry } from "./use-reactions";

const [rec] = buildRecommendations();
type Route = (url: string, init: RequestInit) => Response;
let route: Route;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("swipes against the live API", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useSwipe.getState().reset();
    useTrip.getState().reset();
    useTrip.getState().setProfile(DEMO_PROFILE);
    useTrip.getState().setMode("recs", "live");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => route(url, init)));
  });
  afterEach(() => vi.unstubAllGlobals());

  const serverLike = () => {
    const { undo, ...res } = applyReaction(DEMO_PROFILE, useTrip.getState().weights, rec, "like");
    void undo;
    return res;
  };

  it("sends lang, watches the price, and never falls back to local learning on a 5xx/timeout", async () => {
    const seen: { url: string; body: string }[] = [];
    route = (url, init) => {
      seen.push({ url, body: String(init.body ?? "") });
      return url.endsWith("/reactions") ? json(serverLike()) : json({});
    };
    setApiLang("pl"); // what LangSync does when the UI is in Polish
    const entry = await react(rec, "like");
    expect(entry.local).toBe(false);
    expect(entry.watch).toBe("ok");
    expect(JSON.parse(seen[0].body).lang).toBe("pl");
    expect(entry.undo?.interestsBefore).toBeTruthy(); // snapshot kept for a 404 on undo

    route = () => json({ detail: "boom" }, 503);
    await expect(react(buildRecommendations()[1], "dislike")).rejects.toThrow();
    expect(useSwipe.getState().log).toHaveLength(1); // the failed swipe is not recorded as local
  });

  it("a failed undo throws and keeps the swipe; a 404 undo reverts locally", async () => {
    route = (url) => (url.endsWith("/reactions") ? json(serverLike()) : json({}));
    const entry: SwipeEntry = await react(rec, "like");
    const learned = useSwipe.getState().pending?.profile.interests;
    expect(learned).not.toEqual(DEMO_PROFILE.interests);

    route = () => json({ detail: "down" }, 500);
    await expect(unreact(entry)).rejects.toThrow();
    expect(useSwipe.getState().log).toHaveLength(1);
    expect(useSwipe.getState().pending?.profile.interests).toEqual(learned);

    route = (url) => (url.includes("/reactions/") ? json({ detail: "no reaction" }, 404) : json({}));
    await unreact(entry);
    expect(useSwipe.getState().log).toEqual([]);
    expect(useSwipe.getState().pending?.profile.interests).toEqual(DEMO_PROFILE.interests);
  });
});

describe("capLog", () => {
  it("never drops a dislike (it hides a trip until restored)", () => {
    const mk = (i: number, reaction: SwipeEntry["reaction"]) => ({ rec: { ...rec, id: `x${i}` }, reaction }) as SwipeEntry;
    const log = [mk(0, "dislike"), ...Array.from({ length: 80 }, (_, i) => mk(i + 1, "like"))];
    const kept = capLog(log);
    expect(kept[0].reaction).toBe("dislike");
    expect(kept).toHaveLength(61);
  });
});
