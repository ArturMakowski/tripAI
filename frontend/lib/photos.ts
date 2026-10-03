/** Bundled city photos (public/cities/, see README for credits), keyed by destination IATA. */
const BY_IATA: Record<string, string> = {
  FCO: "rome",
  CIA: "rome",
  LIS: "lisbon",
  ATH: "athens",
  VCE: "venice",
  TSF: "venice",
  OPO: "porto",
  BCN: "barcelona",
  NAP: "naples",
  MLA: "valletta",
  AGP: "malaga",
  CDG: "paris",
  ORY: "paris",
  BVA: "paris",
  CPH: "copenhagen",
  EDI: "edinburgh",
};

export function cityPhoto(iata: string): string | null {
  const slug = BY_IATA[iata.toUpperCase()];
  return slug ? `/cities/${slug}.jpg` : null;
}
