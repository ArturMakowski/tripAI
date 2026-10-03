"""Top attractions per city → data/attractions.json.

Source: Wikidata Query Service (CC0). For each city we take items with coordinates within the city's
`attractions_radius_km`, keep those whose "instance of" types look like visitor attractions, map
the types to taste tags, and rank by Wikipedia sitelink count (a popularity proxy). Attribution:
Wikidata item + English Wikipedia article (CC BY-SA) + Wikimedia Commons image when available.

Why not OSM Overpass / OpenTripMap: Overpass mirrors timed out from our network and OSM has no
popularity signal; OpenTripMap requires an API key and is itself built on OSM + Wikidata.
A city whose query fails keeps its previous entry from the committed file.

    uv run python -m tripai.seed.attractions
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from tripai.seed._common import client, data_dir, meta, now_iso, read_json, write_json

SPARQL = "https://query.wikidata.org/sparql"
TOP_N = 8
MIN_SITELINKS = 8

QUERY = """
SELECT ?item ?itemLabel ?lat ?lon ?sl ?article ?image
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types) WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(%(lon)s %(lat)s)"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "%(radius)s" .
  }
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= %(min_sl)s)
  ?item wdt:P31 ?type . ?type rdfs:label ?typeLabel . FILTER(lang(?typeLabel) = "en")
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  OPTIONAL { ?item wdt:P18 ?image . }
  BIND(geof:latitude(?loc) AS ?lat) BIND(geof:longitude(?loc) AS ?lon)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?item ?itemLabel ?lat ?lon ?sl ?article ?image
ORDER BY DESC(?sl) LIMIT 500
"""

# keyword in an English P31 label → taste tag (see cities.TAGS)
TAG_KEYWORDS: dict[str, tuple[str, ...]] = {
    "history": (
        "castle", "palace", "fortress", "fortification", "fort", "ruin", "archaeological",
        "amphitheatre", "amphitheater", "temple", "monument", "memorial", "cathedral",
        "basilica", "church", "chapel", "monastery", "abbey", "synagogue", "mosque",
        "historic", "tower", "city gate", "city wall", "mausoleum", "triumphal arch",
        "acropolis", "citadel", "old town", "heritage", "tomb", "necropolis", "aqueduct",
        "bridge", "lighthouse", "history museum", "archaeological museum",
    ),
    "art": (
        "art museum", "museum", "gallery", "opera", "theatre", "theater", "concert hall",
        "sculpture", "fountain", "cultural centre", "cultural center",
    ),
    "nature": (
        "park", "garden", "botanical", "mountain", "volcano", "stratovolcano", "hill", "lake",
        "waterfall",
        "nature reserve", "national park", "island", "cave", "cape", "glacier", "geyser",
        "valley", "gorge", "canyon", "lagoon", "cliff", "zoo", "aquarium", "forest", "bay",
        "hot spring", "protected area",
    ),
    "hiking": (
        "mountain", "volcano", "stratovolcano", "national park", "trail", "gorge", "canyon", "peak",
        "mountain range", "nature reserve", "glacier",
    ),
    "beach": ("beach", "cove", "seaside"),
    "food": ("market", "food hall", "winery", "brewery", "restaurant", "café", "cafe"),
    "nightlife": ("nightclub", "bar", "pub", "entertainment district", "street", "boulevard"),
    "ski": ("ski resort", "ski area", "ski jumping hill", "ski"),
}  # fmt: skip
GENERIC = (
    "tourist attraction", "square", "plaza", "observation", "viewpoint", "landmark",
    "amusement park", "promenade", "pier", "harbour", "harbor", "neighbourhood",
)  # fmt: skip
EXCLUDE = (
    "city", "country", "municipality", "comune", "commune", "capital", "settlement",
    "historical country", "university", "school", "college", "hospital", "company",
    "business", "organization", "organisation", "airport", "railway station", "metro station",
    "stadium", "arena", "sports", "administrative", "province", "region", "state", "polity",
    "diocese", "parish", "ministry", "government", "embassy", "library", "archive",
    "event", "battle", "war", "film", "treaty", "road", "motorway", "highway", "street",
    "district of", "quarter", "borough", "electoral", "metropolitan area", "urban area",
    "human settlement", "island nation", "archipelago", "sea", "ocean", "river", "strait",
    "town", "area of", "historical period", "civilization", "academy", "summit", "congress",
    "traditional geographic divisions",
)  # fmt: skip
# movable objects (statues, paintings) live inside museums: drop items that are only these
OBJECTS = {
    "statue", "sculpture", "artistic type", "archaeological artefact", "archaeological artifact",
    "painting", "fresco", "artwork", "work of art",
}  # fmt: skip
# "street"/"quarter" are excluded on purpose: they dominate results but are rarely bucket-list items.


def _match(label: str, keyword: str) -> bool:
    """Whole-word (or whole-phrase) match, tolerating a plural 's'."""
    words = label.replace("-", " ").replace(",", " ").split()
    kw = keyword.split()
    n = len(kw)
    for i in range(len(words) - n + 1):
        window = words[i : i + n]
        if window[:-1] == kw[:-1] and window[-1] in (kw[-1], kw[-1] + "s"):
            return True
    return False


def classify(types: list[str]) -> list[str] | None:
    """Map P31 labels to tags; None if the item is not an attraction."""
    labels = [t.lower() for t in types]
    if all(lab in OBJECTS for lab in labels):
        return None
    if any(_match(lab, ex) for lab in labels for ex in EXCLUDE):
        return None
    tags = [
        tag
        for tag, kws in TAG_KEYWORDS.items()
        if any(_match(lab, kw) for lab in labels for kw in kws)
    ]
    if not tags and not any(_match(lab, g) for lab in labels for g in GENERIC):
        return None
    return tags


def own_names(city: dict[str, Any]) -> set[str]:
    """The destination itself (city, island, country) is not an attraction of itself."""
    raw = f"{city['name']} {city.get('country_name', '')}".replace("(", " ").replace(")", " ")
    return {w.lower() for w in raw.split() if len(w) > 3}


def parse(
    bindings: list[dict[str, Any]], city: dict[str, Any], top_n: int = TOP_N
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    skip = own_names(city)
    for b in bindings:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        name = b.get("itemLabel", {}).get("value", qid)
        if qid in seen or name == qid:  # skip duplicates and items without an English label
            continue
        if name.lower().removesuffix(" island") in skip:
            continue
        types = b.get("types", {}).get("value", "").split("|")
        tags = classify(types)
        if tags is None:
            continue
        seen.add(qid)
        image = b.get("image", {}).get("value")
        out.append(
            {
                "name": name,
                "wikidata": qid,
                "lat": round(float(b["lat"]["value"]), 5),
                "lon": round(float(b["lon"]["value"]), 5),
                "tags": tags,
                "types": types[:5],
                "popularity": int(b["sl"]["value"]),
                "url": b.get("article", {}).get("value") or f"https://www.wikidata.org/wiki/{qid}",
                "image": image.replace("http://", "https://") if image else None,
            }
        )
    out.sort(key=lambda a: -a["popularity"])
    return out[:top_n]


def fetch_city(http: httpx.Client, city: dict[str, Any]) -> list[dict[str, Any]]:
    q = QUERY % {
        "lat": city["lat"],
        "lon": city["lon"],
        "radius": city["attractions_radius_km"],
        "min_sl": MIN_SITELINKS,
    }
    for attempt in range(3):
        r = http.post(
            SPARQL,
            data={"query": q},
            headers={"Accept": "application/sparql-results+json"},
        )
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 5 * (attempt + 1))))
            continue
        r.raise_for_status()
        return parse(r.json()["results"]["bindings"], city)
    r.raise_for_status()
    raise RuntimeError(f"Wikidata kept failing for {city['id']}")


def main() -> None:
    cities = read_json("cities.json")["cities"]
    previous: dict[str, dict[str, Any]] = {}
    if (data_dir() / "attractions.json").exists():
        previous = {c["city_id"]: c for c in read_json("attractions.json")["attractions"]}

    def job(city: dict[str, Any]) -> dict[str, Any] | None:
        try:
            with client(timeout=90) as http:
                items = fetch_city(http, city)
        except Exception as e:  # noqa: BLE001 - keep previous entry for this city
            print(f"warning: {city['id']} failed ({e!r}); keeping previous", file=sys.stderr)
            return previous.get(city["id"])
        print(f"{city['id']}: " + ", ".join(a["name"] for a in items))
        return {
            "city_id": city["id"],
            "iata": city["iata"],
            "source": "wikidata",
            "fetched_at": now_iso(),
            "items": items,
        }

    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = [r for r in pool.map(job, cities) if r]
    payload = {
        "meta": meta(
            "wikidata",
            generator="tripai.seed.attractions",
            url=SPARQL,
            licence="Wikidata CC0; Wikipedia text CC BY-SA 4.0; images: see Wikimedia Commons page",
            attribution="Data from Wikidata (wikidata.org) and Wikipedia contributors",
            notes=(
                f"Items within attractions_radius_km of the city centre, filtered by P31 type, "
                f"ranked by Wikipedia sitelink count (popularity), top {TOP_N}. "
                "tags map to cities.TAGS; popularity is a proxy, not visitor numbers."
            ),
        ),
        "attractions": rows,
    }
    path = write_json("attractions.json", payload)
    print(f"wrote attractions for {len(rows)}/{len(cities)} cities → {path}")


if __name__ == "__main__":
    main()
