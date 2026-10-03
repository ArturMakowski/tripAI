import { afterEach, describe, expect, it, vi } from "vitest";
import { interestsParam, placeFacts, placeSections, placesPath, type DestinationPlaces, type PlaceItem } from "./places";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function liveApi() {
  vi.stubEnv("NEXT_PUBLIC_MOCK", "0");
  return (await import("./api")).api;
}

const place = (over: Partial<PlaceItem> = {}): PlaceItem => ({
  kind: "restaurant",
  name: "Tonnarello",
  rating: 4.6,
  rating_count: 2100,
  price_level: "€20–30",
  category: "Italian",
  tags: ["food"],
  matches: [],
  address: null,
  maps_url: "https://maps.google.com/?cid=1",
  lat: null,
  lon: null,
  source: "serper:places",
  fetched_at: "2026-10-03T12:00:00Z",
  ...over,
});

const dest = (over: Partial<DestinationPlaces> = {}): DestinationPlaces => ({
  iata: "FCO",
  city: "Rome",
  country: "Italy",
  lang: "en",
  restaurants: [place()],
  things_to_do: [place({ kind: "activity", name: "Colosseum", price_level: null })],
  food_first: false,
  mode: "live",
  notes: {},
  ...over,
});

describe("places", () => {
  it("formats only what Google gave: rating, compact count, price level, category", () => {
    const price = (l: string) => `${l} (Google)`;
    expect(placeFacts(place(), "en-GB", price)).toEqual(["★4.6", "2.1k", "€20–30 (Google)", "Italian"]);
    expect(placeFacts(place({ price_level: null, category: null, rating_count: null }), "pl-PL", price)).toEqual(["★4,6"]);
  });

  it("puts where-to-eat first for food lovers and drops empty lists", () => {
    expect(placeSections(dest()).map((s) => s.key)).toEqual(["do", "eat"]);
    expect(placeSections(dest({ food_first: true })).map((s) => s.key)).toEqual(["eat", "do"]);
    expect(placeSections(dest({ things_to_do: [] })).map((s) => s.key)).toEqual(["eat"]);
  });

  it("sends the strongest interests, language and limit", () => {
    expect(interestsParam({ art: 0.2, food: 0.9, hiking: 0.66666 })).toBe("food:0.9,hiking:0.67");
    expect(interestsParam({})).toBeUndefined();
    expect(placesPath("LIS", "pl", { food: 0.9 })).toBe("/destinations/LIS/places?lang=pl&limit=5&interests=food%3A0.9");
  });

  it("goes through the same-origin proxy, memoises, and degrades to null (never mock places)", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(dest()), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const api = await liveApi();
    const a = await api.places("FCO", "en", { food: 1 });
    await api.places("FCO", "en", { food: 1 });
    expect(a?.city).toBe("Rome");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("/api/destinations/FCO/places?lang=en&limit=5&interests=food%3A1");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await api.places("OPO", "en")).toBeNull();
  });

  it("concurrent calls share one request; empty or partial answers are never memoised", async () => {
    let n = 0;
    const fetch = vi.fn(async () => {
      n += 1;
      const body = n === 1 ? dest({ restaurants: [], notes: { restaurants: "budget" } }) : dest();
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const api = await liveApi();
    const [a, b] = await Promise.all([api.places("BCN", "en"), api.places("BCN", "en")]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a?.restaurants).toEqual([]);
    const c = await api.places("BCN", "en"); // partial answer was dropped: asked again
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(c?.restaurants.length).toBe(1);
    await api.places("BCN", "en"); // complete answer is kept
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("mock mode shows no places at all", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api"); // NEXT_PUBLIC_MOCK=1 (vitest.config.mts)
    expect(await api.places("FCO", "en")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
