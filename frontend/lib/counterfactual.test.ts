import { describe, expect, it } from "vitest";
import { peakMonth } from "./counterfactual";

describe("peak-season month from backend labels (EN and PL)", () => {
  it("reads English labels", () => {
    expect(peakMonth("same trip in Jul (peak season)")).toBe(7);
    expect(peakMonth("same trip in Aug (peak season)")).toBe(8);
  });
  it("reads Polish labels in any case form", () => {
    expect(peakMonth("ten sam wyjazd w lipcu (szczyt sezonu)")).toBe(7);
    expect(peakMonth("ten sam wyjazd w sierpniu (szczyt sezonu)")).toBe(8);
    expect(peakMonth("ten sam wyjazd w marcu")).toBe(3);
    expect(peakMonth("ten sam wyjazd w maju")).toBe(5);
    expect(peakMonth("ten sam wyjazd w październiku")).toBe(10);
  });
  it("returns null when there is no month", () => {
    expect(peakMonth("same trip at peak")).toBeNull();
    expect(peakMonth("ten sam wyjazd w szczycie sezonu")).toBeNull();
  });
});
