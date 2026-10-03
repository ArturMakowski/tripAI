/**
 * The internal key and backend URL must never reach the browser. Runs against a real build made with
 * canary values: `npm run test:bundle` (next build, then this file with CHECK_BUNDLE=1). Skipped in
 * the plain `npm test` run, which has no build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

export const CANARY_KEY = "tripai-canary-internal-key-7f3a9c";
export const CANARY_URL = "http://canary-backend.internal:8123";
const STATIC = join(__dirname, "..", ".next", "static");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe.runIf(process.env.CHECK_BUNDLE === "1")("client bundle", () => {
  it("contains neither the internal key nor the backend URL (names or values)", () => {
    const all = files(STATIC);
    expect(all.some((f) => f.endsWith(".js"))).toBe(true);
    const needles = [CANARY_KEY, CANARY_URL, "canary-backend.internal", "TRIPAI_INTERNAL_KEY", "BACKEND_INTERNAL_URL", "X-TripAI-Internal-Key"];
    const hits = all.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return needles.filter((n) => text.toLowerCase().includes(n.toLowerCase())).map((n) => `${n} in ${f}`);
    });
    expect(hits).toEqual([]);
  });
});
