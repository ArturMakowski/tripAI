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

# All region codes in holidays.json are ISO 3166-2 (OpenHolidays' own codes are translated).
VOIVODESHIPS = {
    "PL-02": "dolnośląskie", "PL-04": "kujawsko-pomorskie", "PL-06": "lubelskie",
    "PL-08": "lubuskie", "PL-10": "łódzkie", "PL-12": "małopolskie", "PL-14": "mazowieckie",
    "PL-16": "opolskie", "PL-18": "podkarpackie", "PL-20": "podlaskie", "PL-22": "pomorskie",
    "PL-24": "śląskie", "PL-26": "świętokrzyskie", "PL-28": "warmińsko-mazurskie",
    "PL-30": "wielkopolskie", "PL-32": "zachodniopomorskie",
}  # fmt: skip
# every PL origin airport offered in the app (tripai.seed.airports.ORIGINS)
AIRPORT_VOIVODESHIP = {
    "KRK": "PL-12",
    "KTW": "PL-24",
    "WAW": "PL-14",
    "WMI": "PL-14",  # Warszawa-Modlin: mazowieckie, same school breaks as Chopin
    "GDN": "PL-22",
    "WRO": "PL-02",
    "POZ": "PL-30",
    "RZE": "PL-18",
}

FERIE_2027 = [  # MEN, school year 2026/2027
    # I: dolnośląskie, łódzkie, opolskie, podkarpackie, podlaskie, śląskie
    ("2027-01-18", "2027-01-31", ["PL-02", "PL-10", "PL-16", "PL-18", "PL-20", "PL-24"]),
    # II: lubelskie, mazowieckie, pomorskie, świętokrzyskie
    ("2027-02-01", "2027-02-14", ["PL-06", "PL-14", "PL-22", "PL-26"]),
    # III: kujawsko-pomorskie, lubuskie, małopolskie, warmińsko-mazurskie, wielkopolskie,
    # zachodniopomorskie
    ("2027-02-15", "2027-02-28", ["PL-04", "PL-08", "PL-12", "PL-28", "PL-30", "PL-32"]),
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


def openholidays_iso_codes(http: httpx.Client, country: str) -> dict[str, str]:
    """OpenHolidays subdivision code → ISO 3166-2 (e.g. PL-SK → PL-24 śląskie, AT-WI → AT-9).

    Codes without an ISO equivalent (FR school zones, NL municipalities) map to themselves.
    """
    r = http.get(
        f"{OPENHOLIDAYS}/Subdivisions", params={"countryIsoCode": country, "languageIsoCode": "EN"}
    )
    r.raise_for_status()
    out: dict[str, str] = {}

    def walk(nodes: list[dict[str, Any]]) -> None:
        for n in nodes:
            out[n["code"]] = n.get("isoCode") or n["code"]
            walk(n.get("children") or [])

    walk(r.json())
    return out


def openholidays_school(http: httpx.Client, country: str) -> list[dict[str, Any]]:
    params = {
        "countryIsoCode": country,
        "languageIsoCode": "EN",
        "validFrom": SCHOOL_FROM,
        "validTo": SCHOOL_TO,
    }
    r = http.get(f"{OPENHOLIDAYS}/SchoolHolidays", params=params)
    r.raise_for_status()
    iso = openholidays_iso_codes(http, country)
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
                "regions": [iso.get(s["code"], s["code"]) for s in h.get("subdivisions") or []],
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
        got = set(oh["regions"])
        if got != regions:
            extra = ", ".join(VOIVODESHIPS.get(r, r) for r in sorted(got - regions)) or "-"
            missing = ", ".join(VOIVODESHIPS.get(r, r) for r in sorted(regions - got)) or "-"
            issues.append(
                f"{s}..{e}: OpenHolidays adds [{extra}], lacks [{missing}] vs MEN (using MEN)"
            )
    return issues


def main() -> None:
    cities = read_json("cities.json")["cities"]
    countries = sorted({"PL"} | {c["country"] for c in cities})
    try:
        with client() as http:
            by_country = {
                cc: [h for y in YEARS for h in nager_public(http, cc, y)] for cc in countries
            }
            public = [h for hs in by_country.values() for h in hs]
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
            public_holidays_missing=[c for c, hs in by_country.items() if not hs],
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
