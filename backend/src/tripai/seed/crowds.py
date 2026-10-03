"""Monthly crowd score per city from Eurostat tourism nights → data/crowds.json.

Primary: `tour_occ_nin2m` (nights spent at tourist accommodation, by NUTS2 region and month).
Fallback 1: `tour_occ_nim` (same, country level) when the region has no data (e.g. IS00 → IS).
Fallback 2: proxy = mean normalised profile of comparable regions (London: no post-Brexit data).

Per city, monthly nights are averaged over the last `YEARS` complete years, then min-max normalised
across the 12 months: score 0 = quietest month, 1 = busiest month (for that region).
`peak_ratio` = nights / peak-month nights, for "−40% vs August" style evidence.

If Eurostat is unreachable the script exits non-zero and leaves the committed file untouched.

    uv run python -m tripai.seed.crowds
"""

import sys
from collections import defaultdict
from itertools import product
from typing import Any

from tripai.seed._common import client, meta, read_json, write_json

API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
YEARS = 3
NACE = "I551-I553"  # hotels + holiday/short-stay + camping
COUNTRY_GEO = {"IS00": "IS"}  # NUTS2 → country code for tour_occ_nim fallback
PROXIES = {"UKI": ["FR10", "NL32", "IE06"]}  # London ≈ other big western city-break regions


def parse_jsonstat(doc: dict[str, Any]) -> list[tuple[dict[str, str], float]]:
    """Flatten a Eurostat JSON-stat 2.0 dataset into (coords, value) records."""
    ids: list[str] = doc["id"]
    cats = []
    for dim in ids:
        index = doc["dimension"][dim]["category"]["index"]
        cats.append([code for code, _ in sorted(index.items(), key=lambda kv: kv[1])])
    values = doc.get("value", {})
    out = []
    for flat, coords in enumerate(product(*cats)):
        v = values.get(str(flat)) if isinstance(values, dict) else values[flat]
        if v is not None:
            out.append((dict(zip(ids, coords, strict=True)), float(v)))
    return out


def monthly_series(
    records: list[tuple[dict[str, str], float]],
) -> dict[str, dict[tuple[int, int], float]]:
    """geo → {(year, month): nights}; handles both `time=YYYY + month=Mxx` and `time=YYYY-MM`."""
    out: dict[str, dict[tuple[int, int], float]] = defaultdict(dict)
    for c, v in records:
        if c.get("nace_r2", NACE) != NACE or c.get("unit", "NR") != "NR":
            continue
        if c.get("c_resid", "TOTAL") != "TOTAL":
            continue
        t = c["time"]
        if "month" in c:
            if c["month"] == "TOTAL":
                continue
            year, month = int(t), int(c["month"].removeprefix("M"))
        else:
            year, month = int(t[:4]), int(t[5:7])
        out[c["geo"]][(year, month)] = v
    return dict(out)


def profile(series: dict[tuple[int, int], float], years: int = YEARS) -> dict[str, Any] | None:
    """Average the last `years` complete years → nights[12], score[12] (min-max), peak_ratio[12]."""
    by_year: dict[int, dict[int, float]] = defaultdict(dict)
    for (y, m), v in series.items():
        by_year[y][m] = v
    complete = sorted(y for y, ms in by_year.items() if len(ms) == 12)[-years:]
    if not complete:
        return None
    nights = [sum(by_year[y][m] for y in complete) / len(complete) for m in range(1, 13)]
    return {"years": complete, **normalise(nights)}


def normalise(nights: list[float]) -> dict[str, list[float]]:
    lo, hi = min(nights), max(nights)
    span = (hi - lo) or 1.0
    return {
        "nights": [round(n) for n in nights],
        "score": [round((n - lo) / span, 3) for n in nights],
        "peak_ratio": [round(n / hi, 3) if hi else 0.0 for n in nights],
    }


def fetch(dataset: str, geos: list[str], since: str) -> dict[str, Any]:
    params: list[tuple[str, str]] = [("geo", g) for g in geos]
    params += [("unit", "NR"), ("c_resid", "TOTAL"), ("nace_r2", NACE)]
    params += [("sinceTimePeriod", since), ("lang", "en")]
    with client(timeout=120) as http:
        r = http.get(f"{API}/{dataset}", params=params)
        r.raise_for_status()
        return r.json()


def build(cities: list[dict[str, Any]], regional: dict, national: dict) -> list[dict[str, Any]]:
    profiles: dict[str, tuple[str, str, dict[str, Any]]] = {}
    for geo, series in regional.items():
        if p := profile(series):
            profiles[geo] = ("nuts2", "eurostat:tour_occ_nin2m", p)
    for nuts2, cc in COUNTRY_GEO.items():  # use country data if regional is missing or staler
        p = profile(national.get(cc, {}))
        if p and (nuts2 not in profiles or profiles[nuts2][2]["years"][-1] < p["years"][-1]):
            profiles[nuts2] = ("country", "eurostat:tour_occ_nim", p)

    out = []
    for city in cities:
        geo = city["nuts2"]
        if geo in profiles:
            level, source, p = profiles[geo]
            entry = {"geo_level": level, "source": source, **p}
        elif geo in PROXIES and all(g in profiles for g in PROXIES[geo]):
            parts = [profiles[g][2]["score"] for g in PROXIES[geo]]
            score = [round(sum(col) / len(col), 3) for col in zip(*parts, strict=True)]
            entry = {
                "geo_level": "proxy",
                "source": "eurostat:tour_occ_nin2m (proxy: " + ", ".join(PROXIES[geo]) + ")",
                "years": profiles[PROXIES[geo][0]][2]["years"],
                "nights": None,
                "score": score,
                "peak_ratio": None,
            }
        else:
            print(f"warning: no crowd data for {city['id']} ({geo})", file=sys.stderr)
            continue
        out.append({"city_id": city["id"], "iata": city["iata"], "geo": geo, **entry})
    return out


def main() -> None:
    cities = read_json("cities.json")["cities"]
    geos = sorted({c["nuts2"] for c in cities} | {g for gs in PROXIES.values() for g in gs})
    try:
        regional = monthly_series(parse_jsonstat(fetch("tour_occ_nin2m", geos, "2021")))
        national = monthly_series(
            parse_jsonstat(fetch("tour_occ_nim", sorted(COUNTRY_GEO.values()), "2021-01"))
        )
    except Exception as e:  # noqa: BLE001 - keep committed data on any network failure
        sys.exit(f"Eurostat fetch failed ({e!r}); keeping existing data/crowds.json")
    rows = build(cities, regional, national)
    payload = {
        "meta": meta(
            "eurostat:tour_occ_nin2m",
            generator="tripai.seed.crowds",
            url=f"{API}/tour_occ_nin2m",
            licence="Eurostat, CC BY 4.0 (https://ec.europa.eu/eurostat/about-us/policies/copyright)",
            notes=(
                f"Nights at tourist accommodation (NACE {NACE}, all residents), monthly mean of the "
                f"last {YEARS} complete years. score = min-max across months per city "
                "(0 quietest, 1 busiest); peak_ratio = nights / busiest month. Arrays are Jan..Dec. "
                "NUTS2 regions are wider than cities (e.g. ES61 = all Andalucía)."
            ),
        ),
        "crowds": rows,
    }
    path = write_json("crowds.json", payload)
    print(f"wrote {len(rows)}/{len(cities)} city crowd profiles → {path}")


if __name__ == "__main__":
    main()
