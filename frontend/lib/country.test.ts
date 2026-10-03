import { describe, expect, it } from "vitest";
import { localCountry } from "./country";

describe("country names follow the UI language", () => {
  it("names, any case, and ISO codes", () => {
    expect(localCountry("France", "pl-PL")).toBe("Francja");
    expect(localCountry("FRANCE", "pl-PL")).toBe("Francja");
    expect(localCountry("FR", "pl-PL")).toBe("Francja");
    expect(localCountry("Italy", "pl-PL")).toBe("Włochy");
    expect(localCountry("Italy", "en-GB")).toBe("Italy");
    expect(localCountry("Narnia", "pl-PL")).toBe("Narnia");
  });
});
