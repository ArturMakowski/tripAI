import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendations } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { weightsFromSlider } from "./scoring";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("mock two-phase /recommendations", () => {
  it("fast returns cached estimates, full exact prices, and the order changes", async () => {
    const req = { profile: DEMO_PROFILE, weights: weightsFromSlider(50) };
    const [fast, full] = await Promise.all([recommendations(req, "fast"), recommendations(req, "full")]);
    expect(fast.map((r) => r.id).sort()).toEqual(full.map((r) => r.id).sort());
    const rome = (xs: typeof fast) => xs.find((r) => r.city === "Rome")!;
    expect(rome(fast).total_cost_pln).not.toBe(rome(full).total_cost_pln);
    expect(rome(fast).evidence.find((e) => e.kind === "flight")!.source).toContain("calendar");
    expect(fast.map((r) => r.id)).not.toEqual(full.map((r) => r.id));
  });
});

describe("api.recommendationsPhase never double-spends", () => {
  async function liveApi(phaseHeader: string | null) {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response("[]", { status: 200, headers: phaseHeader ? { "X-TripAI-Phase": phaseHeader } : {} });
      }),
    );
    const { api } = await import("./api");
    return { api, urls };
  }

  it("reports the phase the server confirmed", async () => {
    const { api, urls } = await liveApi("fast");
    const r = await api.recommendationsPhase({ profile: DEMO_PROFILE }, "fast");
    expect(r).toMatchObject({ mode: "live", data: { served: "fast" } });
    expect(urls[0]).toBe("http://backend.test/recommendations?phase=fast");
  });

  it("a backend without phase support yields served=null (caller must not fire full)", async () => {
    const { api } = await liveApi(null);
    const r = await api.recommendationsPhase({ profile: DEMO_PROFILE }, "fast");
    expect(r.data.served).toBeNull();
  });
});
