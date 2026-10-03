"""Monthly climate normals per seed city from the Open-Meteo ERA5 archive → data/climate.json.

For each city in cities.json: daily max/min temperature, precipitation and sunshine for the last
`YEARS` complete calendar years (one archive request per city), aggregated per calendar month:
mean daily max/min (°C), share of days with ≥ 1 mm rain, mean sunshine hours, mean precipitation.

Used by the live provider's fast phase (no network) and as a fallback when Open-Meteo is down.
If Open-Meteo is unreachable the script exits non-zero and leaves the committed file untouched.

    uv run python -m tripai.seed.climate
"""

import statistics
import sys
import time
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from tripai.seed._common import client, meta, read_json, write_json

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
DAILY = "temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration"
YEARS = 3
RAINY_DAY_MM = 1.0
PACE_S = 1.5


def _mean(xs: list[float]) -> float | None:
    return round(statistics.fmean(xs), 1) if xs else None


def monthly_normals(daily: dict[str, list]) -> list[dict[str, Any]]:
    """Aggregate an Open-Meteo `daily` block into 12 calendar-month records."""
    by_month: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for i, day in enumerate(daily["time"]):
        m = by_month[int(day[5:7])]
        for key, src in (("tmax", "temperature_2m_max"), ("tmin", "temperature_2m_min"),
                         ("precip", "precipitation_sum"), ("sun", "sunshine_duration")):  # fmt: skip
            v = daily.get(src, [None] * len(daily["time"]))[i]
            if v is not None:
                m[key].append(v / 3600 if key == "sun" else v)
    out = []
    for month in range(1, 13):
        m = by_month[month]
        out.append(
            {
                "month": month,
                "temp_max_c": _mean(m["tmax"]),
                "temp_min_c": _mean(m["tmin"]),
                "precipitation_mm": _mean(m["precip"]),
                "rainy_day_share": (
                    round(sum(p >= RAINY_DAY_MM for p in m["precip"]) / len(m["precip"]), 2)
                    if m["precip"]
                    else None
                ),
                "sunshine_h": _mean(m["sun"]),
            }
        )
    return out


def main() -> int:
    cities = read_json("cities.json")["cities"]
    last = datetime.now(UTC).year - 1
    years = list(range(last - YEARS + 1, last + 1))
    rows = []
    with client() as http:
        for c in cities:
            params = {
                "latitude": round(c["lat"], 2),
                "longitude": round(c["lon"], 2),
                "start_date": f"{years[0]}-01-01",
                "end_date": f"{years[-1]}-12-31",
                "daily": DAILY,
                "timezone": "auto",
            }
            for attempt in range(6):  # multi-year requests weigh several calls in the rate limit
                resp = http.get(ARCHIVE, params=params)
                if resp.status_code != 429:
                    break
                time.sleep(15 * (attempt + 1))
            time.sleep(PACE_S)
            if resp.is_error:
                print(f"open-meteo {c['id']}: HTTP {resp.status_code}", file=sys.stderr)
                return 1
            rows.append({"city_id": c["id"], "iata": c["iata"], "years": years,
                         "months": monthly_normals(resp.json()["daily"])})  # fmt: skip
            print(f"{c['id']}: ok")
    write_json(
        "climate.json",
        {
            "meta": meta(
                "open-meteo:archive",
                generator="tripai.seed.climate",
                notes=f"ERA5 reanalysis via Open-Meteo, daily values {years[0]}-{years[-1]} "
                "averaged per calendar month at the city centre (cities.json lat/lon).",
                url=ARCHIVE,
                years=years,
            ),
            "climate": rows,
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
