import { describe, expect, it } from "vitest";
import { mergeRec, urlBase64ToUint8Array } from "./notify";
import type { RankedRecommendation } from "./types";

const rec = (id: string) => ({ id }) as RankedRecommendation;

describe("notify helpers", () => {
  it("decodes a base64url VAPID key into the 65-byte applicationServerKey", () => {
    // uncompressed P-256 point: 0x04 + 64 bytes, as printed by `python -m tripai.notify.vapid`
    const raw = Uint8Array.from([4, ...Array.from({ length: 64 }, (_, i) => (i * 37) % 256)]);
    const b64url = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(Array.from(urlBase64ToUint8Array(b64url))).toEqual(Array.from(raw));
  });

  it("merges a notification's card into cached recs without duplicates", () => {
    expect(mergeRec([rec("A"), rec("B")], rec("B")).map((r) => r.id)).toEqual(["A", "B"]);
    expect(mergeRec([rec("A")], rec("C")).map((r) => r.id)).toEqual(["A", "C"]);
  });
});
