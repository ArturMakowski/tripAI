/** English country names from the backend -> ISO 3166 codes, so Intl can name them in the UI language. */
export const COUNTRY_CODE: Record<string, string> = {
  Italy: "IT", Portugal: "PT", Greece: "GR", Spain: "ES", France: "FR", Malta: "MT", Denmark: "DK",
  "United Kingdom": "GB", Croatia: "HR", Germany: "DE", Austria: "AT", Netherlands: "NL", Czechia: "CZ",
  "Czech Republic": "CZ", Hungary: "HU", Cyprus: "CY", Montenegro: "ME", Albania: "AL", Turkey: "TR",
  Türkiye: "TR", Morocco: "MA", Egypt: "EG", Georgia: "GE", Ireland: "IE", Belgium: "BE", Switzerland: "CH",
  Norway: "NO", Sweden: "SE", Finland: "FI", Iceland: "IS", Bulgaria: "BG", Romania: "RO", Slovenia: "SI",
  Slovakia: "SK", Poland: "PL", "Canary Islands": "IC", Tunisia: "TN", Israel: "IL", Jordan: "JO",
};

/**
 * "Italy" / "ITALY" / "IT" -> "Włochy" in PL, "Italy" in EN (Intl.DisplayNames); unknown names pass
 * through unchanged. Every screen that shows a country goes through this, so PL never shows "FRANCE".
 */
export function localCountry(name: string, locale: string): string {
  const key = name.trim();
  const byName = Object.entries(COUNTRY_CODE).find(([n]) => n.toLowerCase() === key.toLowerCase())?.[1];
  const code = byName ?? (/^[A-Za-z]{2}$/.test(key) ? key.toUpperCase() : undefined);
  if (!code) return name;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? name;
  } catch {
    return name;
  }
}
