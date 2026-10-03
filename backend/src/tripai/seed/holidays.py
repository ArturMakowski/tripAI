"""Holidays → data/holidays.json (długi weekend radar + crowd flags).

- `public`: public holidays 2026-2027 for PL and every destination country (Nager.Date).
- `pl_long_weekends`: PL long weekends incl. ones needing a bridge day (Nager.Date).
- `pl_school_breaks`: PL school year 2026/27 breaks incl. winter ferie per voivodeship
  (MEN schedule, hard-coded; cross-checked against OpenHolidays, mismatches are reported in meta).
- `school_holidays`: destination-country school holidays Oct 2026 - Dec 2027 (OpenHolidays API),
  used as "local families travelling" crowd flags.

    uv run python -m tripai.seed.holidays
"""

import sys
from typing import Any

import httpx

from tripai.seed._common import client, meta, read_json, write_json

NAGER = "https://date.nager.at/api/v3"
OPENHOLIDAYS = "https://openholidaysapi.org"
YEARS = (2026, 2027)
SCHOOL_FROM, SCHOOL_TO = "2026-10-01", "2027-12-31"

MEN_SOURCE = (
    "MEN: rozporządzenie MEN z 11.08.2017 w sprawie organizacji roku szkolnego "
    "(Dz.U. 2023 poz. 1211), harmonogram roku szkolnego 2026/2027"
)
MEN_URL = "https://www.gov.pl/web/edukacja/kalendarz-roku-szkolnego"
MEN_PRESS_URL = "https://www.rmf24.pl/fakty/polska/news-jest-kalendarz-roku-szkolnego-20262027-kiedy-ferie-i-przerwy,nId,8082077"

VOIVODESHIPS = {
    "DS": "dolnośląskie", "KP": "kujawsko-pomorskie", "LU": "lubelskie", "LB": "lubuskie",
    "LD": "łódzkie", "MA": "małopolskie", "MZ": "mazowieckie", "OP": "opolskie",
    "PK": "podkarpackie", "PD": "podlaskie", "PM": "pomorskie", "SL": "śląskie",
    "SK": "świętokrzyskie", "WN": "warmińsko-mazurskie", "WP": "wielkopolskie",
    "ZP": "zachodniopomorskie",
}  # fmt: skip
AIRPORT_VOIVODESHIP = {"KRK": "MA", "KTW": "SL", "WAW": "MZ", "GDN": "PM"}

FERIE_2027 = [  # MEN, school year 2026/2027
    ("2027-01-18", "2027-01-31", ["DS", "LD", "OP", "PK", "PD", "SL"]),
    ("2027-02-01", "2027-02-14", ["LU", "MZ", "PM", "SK"]),
    ("2027-02-15", "2027-02-28", ["KP", "LB", "MA", "WN", "WP", "ZP"]),
]
NATIONAL_BREAKS_2026_27 = [
    ("christmas", "Zimowa przerwa świąteczna", "2026-12-23", "2026-12-31"),
    ("easter", "Wiosenna przerwa świąteczna", "2027-03-25", "2027-03-30"),
    ("summer", "Wakacje letnie", "2027-06-26", "2027-08-31"),
]


def pl_school_breaks() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [
        {
            "kind": kind,
            "name": name,
            "start": start,
            "end": end,
            "voivodeships": sorted(VOIVODESHIPS),
            "source": "men",
            "url": MEN_PRESS_URL,
        }
        for kind, name, start, end in NATIONAL_BREAKS_2026_27
    ]
    for start, end, regions in FERIE_2027:
        out.append(
            {
                "kind": "ferie",
                "name": "Ferie zimowe",
                "start": start,
                "end": end,
                "voivodeships": sorted(regions),
                "source": "men",
                "url": MEN_PRESS_URL,
            }
        )
    covered = sorted(v for *_, rs in FERIE_2027 for v in rs)
    assert covered == sorted(VOIVODESHIPS), "every voivodeship must have exactly one ferie slot"
    return sorted(out, key=lambda b: b["start"])


def nager_public(http: httpx.Client, country: str, year: int) -> list[dict[str, Any]]:
    r = http.get(f"{NAGER}/PublicHolidays/{year}/{country}")
    if r.status_code in (204, 404):
        return []
    r.raise_for_status()
    return [
        {
            "date": h["date"],
            "country": country,
            "name": h["name"],
            "local_name": h["localName"],
            "nationwide": h["global"],
            "regions": h["counties"] or [],
            "types": h["types"],
        }
        for h in r.json()
    ]


def nager_long_weekends(http: httpx.Client, year: int) -> list[dict[str, Any]]:
    r = http.get(f"{NAGER}/LongWeekend/{year}/PL")
    r.raise_for_status()
    return [
        {
            "start": w["startDate"],
            "end": w["endDate"],
            "days": w["dayCount"],
            "bridge_days": w.get("bridgeDays") or [],
        }
        for w in r.json()
    ]


def openholidays_countries(http: httpx.Client) -> set[str]:
    r = http.get(f"{OPENHOLIDAYS}/Countries")
    r.raise_for_status()
    return {c["isoCode"] for c in r.json()}


def openholidays_school(http: httpx.Client, country: str) -> list[dict[str, Any]]:
    params = {
        "countryIsoCode": country,
        "languageIsoCode": "EN",
        "validFrom": SCHOOL_FROM,
        "validTo": SCHOOL_TO,
    }
    r = http.get(f"{OPENHOLIDAYS}/SchoolHolidays", params=params)
    r.raise_for_status()
    out = []
    for h in r.json():
        names = {n["language"]: n["text"] for n in h.get("name", [])}
        out.append(
            {
                "country": country,
                "start": h["startDate"],
                "end": h["endDate"],
                "name": names.get("EN") or next(iter(names.values()), ""),
                "nationwide": h.get("nationwide", False),
                "regions": [s["code"] for s in h.get("subdivisions") or []],
            }
        )
    return out


def ferie_mismatches(oh_pl: list[dict[str, Any]]) -> list[str]:
    """Compare MEN ferie with OpenHolidays' PL winter holidays (reported, MEN wins)."""
    men = {(s, e): set(rs) for s, e, rs in FERIE_2027}
    issues = []
    for (s, e), regions in men.items():
        oh = next((h for h in oh_pl if (h["start"], h["end"]) == (s, e)), None)
        if oh is None:
            issues.append(f"{s}..{e}: missing in OpenHolidays")
            continue
        got = {r.removeprefix("PL-") for r in oh["regions"]}
        if got != regions:
            issues.append(f"{s}..{e}: MEN={sorted(regions)} OpenHolidays={sorted(got)} (using MEN)")
    return issues


def main() -> None:
    cities = read_json("cities.json")["cities"]
    countries = sorted({"PL"} | {c["country"] for c in cities})
    try:
        with client() as http:
            public = [h for cc in countries for y in YEARS for h in nager_public(http, cc, y)]
            long_weekends = [w for y in YEARS for w in nager_long_weekends(http, y)]
            supported = openholidays_countries(http)
            school = [
                h for cc in countries if cc in supported for h in openholidays_school(http, cc)
            ]
    except httpx.HTTPError as e:
        sys.exit(f"holiday fetch failed ({e!r}); keeping existing data/holidays.json")

    mismatches = ferie_mismatches([h for h in school if h["country"] == "PL"])
    for m in mismatches:
        print(f"ferie cross-check: {m}", file=sys.stderr)
    payload = {
        "meta": meta(
            "nager.date + openholidaysapi.org + MEN",
            generator="tripai.seed.holidays",
            sources={
                "public": f"{NAGER}/PublicHolidays/{{year}}/{{country}}",
                "pl_long_weekends": f"{NAGER}/LongWeekend/{{year}}/PL",
                "pl_school_breaks": f"{MEN_SOURCE}; {MEN_URL}; {MEN_PRESS_URL}",
                "school_holidays": f"{OPENHOLIDAYS}/SchoolHolidays (ODbL)",
            },
            countries=countries,
            school_holidays_missing=[c for c in countries if c not in supported],
            ferie_crosscheck_vs_openholidays=mismatches,
        ),
        "voivodeships": VOIVODESHIPS,
        "airport_voivodeship": AIRPORT_VOIVODESHIP,
        "public": sorted(public, key=lambda h: (h["date"], h["country"])),
        "pl_long_weekends": long_weekends,
        "pl_school_breaks": pl_school_breaks(),
        "school_holidays": sorted(school, key=lambda h: (h["start"], h["country"])),
    }
    path = write_json("holidays.json", payload)
    print(
        f"wrote {len(public)} public holidays ({len(countries)} countries), "
        f"{len(long_weekends)} PL long weekends, {len(school)} school holiday periods → {path}"
    )


if __name__ == "__main__":
    main()
