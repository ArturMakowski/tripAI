"""Airport coordinates for every airport in cities.json plus the PL origins → data/airports.json.

Source: OurAirports (public domain), https://ourairports.com/data/. Used for the airport pin and
the airport → hotel transfer estimate (docs/TRIP_DETAILS.md). Exits non-zero (file untouched) if
the download fails or an airport is missing.

    uv run python -m tripai.seed.airports
"""

import csv
import io
import sys

from tripai.seed._common import client, meta, read_json, write_json

URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
# PL origin airports offered in the app, in picker order. `city` groups airports that serve the same
# city (Warszawa: Chopin + Modlin); `label` is how the airport is named everywhere in the UI, so a
# secondary airport never passes for the city itself ("Warszawa-Modlin (WMI)", not "Modlin").
ORIGIN_LABELS: dict[str, dict[str, dict[str, str]]] = {
    "KRK": {"city": {"pl": "Kraków", "en": "Kraków"}, "label": {"pl": "Kraków", "en": "Kraków"}},
    "WAW": {
        "city": {"pl": "Warszawa", "en": "Warsaw"},
        "label": {"pl": "Warszawa-Chopin", "en": "Warsaw Chopin"},
    },
    "WMI": {
        "city": {"pl": "Warszawa", "en": "Warsaw"},
        "label": {"pl": "Warszawa-Modlin", "en": "Warsaw-Modlin"},
    },
    "KTW": {
        "city": {"pl": "Katowice", "en": "Katowice"},
        "label": {"pl": "Katowice-Pyrzowice", "en": "Katowice-Pyrzowice"},
    },
    "GDN": {"city": {"pl": "Gdańsk", "en": "Gdańsk"}, "label": {"pl": "Gdańsk", "en": "Gdańsk"}},
    "WRO": {
        "city": {"pl": "Wrocław", "en": "Wrocław"},
        "label": {"pl": "Wrocław", "en": "Wrocław"},
    },
    "POZ": {"city": {"pl": "Poznań", "en": "Poznań"}, "label": {"pl": "Poznań", "en": "Poznań"}},
    "RZE": {
        "city": {"pl": "Rzeszów", "en": "Rzeszów"},
        "label": {"pl": "Rzeszów-Jasionka", "en": "Rzeszów-Jasionka"},
    },
}
ORIGINS = tuple(ORIGIN_LABELS)


def wanted() -> set[str]:
    codes = set(ORIGINS)
    for c in read_json("cities.json")["cities"]:
        codes.update(c["airports"])
    return codes


def parse(text: str, codes: set[str]) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        if r.get("iata_code") in codes and r.get("type") != "closed":
            rows.append(
                {
                    "iata": r["iata_code"],
                    "name": r["name"],
                    "lat": round(float(r["latitude_deg"]), 5),
                    "lon": round(float(r["longitude_deg"]), 5),
                    "municipality": r.get("municipality") or None,
                    "country": r["iso_country"],
                    **ORIGIN_LABELS.get(r["iata_code"], {}),
                }
            )
    return sorted(rows, key=lambda r: r["iata"])


def main() -> int:
    codes = wanted()
    with client() as http:
        resp = http.get(URL)
    if resp.is_error:
        print(f"ourairports: HTTP {resp.status_code}", file=sys.stderr)
        return 1
    rows = parse(resp.text, codes)
    missing = codes - {r["iata"] for r in rows}
    if missing:
        print(f"ourairports: missing {sorted(missing)}", file=sys.stderr)
        return 1
    write_json(
        "airports.json",
        {
            "meta": meta(
                "ourairports",
                generator="tripai.seed.airports",
                url=URL,
                licence="Public Domain (OurAirports)",
            ),
            "airports": rows,
        },
    )
    print(f"{len(rows)} airports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
