import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DNA_DECK, licenseUrl } from "./dna";

const PUBLIC = join(__dirname, "..", "public");

/** Width/height from a baseline or progressive JPEG's SOF marker. */
function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("no SOF marker");
}

describe("Travel DNA deck photos", () => {
  const own = DNA_DECK.filter((c) => c.image.startsWith("/swipe/"));

  it("every card has its own photo (no photo illustrates two statements)", () => {
    expect(new Set(DNA_DECK.map((c) => c.image)).size).toBe(DNA_DECK.length);
  });

  it.each(own.map((c) => [c.id, c.image]))("%s: %s is a 900x1200 JPEG under 250 KB", (_id, src) => {
    const path = join(PUBLIC, src);
    expect(statSync(path).size).toBeLessThan(250_000);
    expect(jpegSize(readFileSync(path))).toEqual({ w: 900, h: 1200 });
  });

  it("is license-safe: CC0, public domain or CC BY (no SA/NC/ND), with author and source, listed in CREDITS.md", () => {
    const credits = readFileSync(join(PUBLIC, "swipe", "CREDITS.md"), "utf8");
    for (const c of own) {
      expect(c.credit.license).toMatch(/^(CC0|Public domain|CC BY \d\.\d( [A-Z]{2})?)$/);
      expect(c.credit.author).not.toBe("");
      expect(c.credit.source).toMatch(/^https:\/\/(commons\.wikimedia\.org|www\.flickr\.com|unsplash\.com)\//);
      expect(credits).toContain(`| ${c.id} | \`${c.image}\``);
    }
  });

  it("links every licence (CC BY asks for a link to the licence)", () => {
    expect(licenseUrl("CC0")).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
    expect(licenseUrl("CC BY 2.0 DE")).toBe("https://creativecommons.org/licenses/by/2.0/de/");
    expect(licenseUrl("Public domain")).toBeUndefined();
    for (const c of own) if (c.credit.license !== "Public domain") expect(licenseUrl(c.credit.license)).toMatch(/^https:\/\/creativecommons\.org\//);
  });
});
