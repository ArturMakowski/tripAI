"""Typed, cached read access to the committed seed data in `data/*.json` (no network).

    from tripai.seed import load
    rome = load.city("FCO")                       # by id, primary IATA or any listed airport
    load.crowd_score("rome", 1)                   # 0.0 (quietest month)
    load.crowd_evidence("rome", 1)                # tripai.models.Evidence with source + fetched_at
    load.holidays_in("IT", date(2027, 4, 1), date(2027, 4, 7))
    load.school_breaks(airport="KRK")             # PL breaks affecting Kraków (małopolskie)
    load.attractions("rome", tags={"art": 0.9})   # ranked by taste match, then popularity

Point TRIPAI_DATA_DIR elsewhere (and call `clear_cache()`) to load another snapshot.
"""

from datetime import date, datetime
from functools import cache
from typing import Any

from pydantic import BaseModel

from tripai import i18n
from tripai.models import Evidence
from tripai.seed._common import read_json

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


class SeedMeta(BaseModel, extra="allow"):
    source: str
    fetched_at: datetime
    generator: str


class City(BaseModel):
    id: str
    name: str
    country: str
    country_name: str
    iata: str
    airports: list[str]
    lat: float
    lon: float
    nuts2: str
    subdivisions: list[str]  # ISO 3166-2 (+ FR school zones), for regional holiday matching
    direct_from: list[str]
    attractions_radius_km: int
    tags: dict[str, float]


class CrowdProfile(BaseModel):
    city_id: str
    iata: str
    geo: str
    geo_level: str  # "nuts2" | "country" | "proxy"
    source: str
    years: list[int]
    nights: list[int] | None  # Jan..Dec, mean nights per month (None for proxies)
    score: list[float]  # Jan..Dec, 0 = quietest month, 1 = busiest
    peak_ratio: list[float] | None  # Jan..Dec, nights / busiest month


class PublicHoliday(BaseModel):
    date: date
    country: str
    name: str
    local_name: str
    nationwide: bool
    regions: list[str]
    types: list[str]


class Period(BaseModel):
    start: date
    end: date

    def overlaps(self, start: date, end: date) -> bool:
        return self.start <= end and start <= self.end


class LongWeekend(Period):
    days: int
    bridge_days: list[date]


class SchoolBreak(Period):
    kind: str  # "ferie" | "christmas" | "easter" | "summer"
    name: str
    voivodeships: list[str]
    source: str
    url: str


class SchoolHoliday(Period):
    country: str
    name: str
    nationwide: bool
    regions: list[str]


class Attraction(BaseModel):
    name: str
    wikidata: str
    lat: float
    lon: float
    tags: list[str]
    types: list[str]
    popularity: int
    url: str
    image: str | None = None


class CityAttractions(BaseModel):
    city_id: str
    iata: str
    source: str
    fetched_at: datetime
    items: list[Attraction]


@cache
def _raw(name: str) -> dict[str, Any]:
    return read_json(name)


def clear_cache() -> None:
    for fn in (
        _raw,
        cities,
        _city_index,
        crowds,
        public_holidays,
        school_breaks,
        _attractions,
        _climate,
        _airports,
    ):
        fn.cache_clear()


def meta(name: str) -> SeedMeta:
    """Provenance of a data file, e.g. meta("crowds.json").source."""
    return SeedMeta.model_validate(_raw(name)["meta"])


# --- cities ---------------------------------------------------------------------------------


@cache
def cities() -> tuple[City, ...]:
    return tuple(City.model_validate(c) for c in _raw("cities.json")["cities"])


@cache
def _city_index() -> dict[str, City]:
    idx: dict[str, City] = {}
    for c in cities():
        for key in (*c.airports, c.iata, c.id):  # id/primary IATA win over secondary airports
            idx[key.lower()] = c
    return idx


def city(key: str) -> City:
    """Look up by city id ("rome"), primary IATA ("FCO") or any listed airport ("CIA")."""
    try:
        return _city_index()[key.lower()]
    except KeyError:
        raise KeyError(f"unknown city {key!r}") from None


# --- crowds ---------------------------------------------------------------------------------


@cache
def crowds() -> dict[str, CrowdProfile]:
    return {r["city_id"]: CrowdProfile.model_validate(r) for r in _raw("crowds.json")["crowds"]}


def crowd(key: str) -> CrowdProfile:
    return crowds()[city(key).id]


def crowd_score(key: str, month: int) -> float:
    """0..1 crowd level for month 1..12 (relative to that city's own year)."""
    if not 1 <= month <= 12:
        raise ValueError(f"month must be 1..12, got {month}")
    return crowd(key).score[month - 1]


EUROSTAT_VIEW = "https://ec.europa.eu/eurostat/databrowser/view/{}/default/table"


def crowd_level(key: str, month: int) -> float:
    """The crowd number we score AND show: the share of the peak month's tourist nights where
    Eurostat has it, else the relative 0..1 score (see `crowd_evidence`)."""
    p = crowd(key)
    if p.peak_ratio is not None and max(p.peak_ratio) > 0:
        return round(p.peak_ratio[month - 1], 3)
    return crowd_score(key, month)


def crowd_evidence(key: str, month: int) -> Evidence:
    c, p = city(key), crowd(key)
    if not 1 <= month <= 12:
        raise ValueError(f"month must be 1..12, got {month}")
    # One number per row (label == value == display). Where Eurostat gives tourist nights vs the
    # peak month, the value IS that share ("Crowds: 88% of peak season"). Otherwise the value is
    # the relative 0..1 scale (0 = quietest month), unit "0-1 rel", never shown as "% of peak".
    has_ratio = p.peak_ratio is not None and max(p.peak_ratio) > 0
    where = {"city": i18n.city(c.name), "month": i18n.month_long(month)}
    if has_ratio:
        value, unit = crowd_level(key, month), "0-1"
        label = i18n.t("crowd.label", pct=round(value * 100)) + i18n.t("crowd.when", **where)
    else:
        value, unit = p.score[month - 1], "0-1 rel"
        label = i18n.t("crowd.relative", **where)
    if p.geo_level == "proxy":
        label += i18n.t("crowd.proxy")
    elif p.geo_level == "country":
        label += i18n.t("crowd.country", country=i18n.country(c.country_name))
    dataset = p.source.split(":", 1)[1].split()[0]  # "eurostat:tour_occ_nim" → "tour_occ_nim"
    return Evidence(
        kind="crowds",
        label=label,
        value=value,
        unit=unit,
        source=p.source,
        fetched_at=meta("crowds.json").fetched_at,
        url=EUROSTAT_VIEW.format(dataset),
    )


# --- holidays -------------------------------------------------------------------------------


@cache
def public_holidays(country: str | None = None) -> tuple[PublicHoliday, ...]:
    rows = (PublicHoliday.model_validate(h) for h in _raw("holidays.json")["public"])
    return tuple(h for h in rows if country is None or h.country == country.upper())


def _applies(nationwide: bool, regions: list[str], subdivisions: list[str] | None) -> bool:
    """Nationwide, or (when the place is known) the holiday's regions include it."""
    if nationwide or subdivisions is None:
        return True
    return any(r in subdivisions for r in regions)


def holidays_in(
    country: str, start: date, end: date, subdivisions: list[str] | None = None
) -> list[PublicHoliday]:
    """Public holidays in [start, end]; pass `subdivisions` to drop other regions' holidays."""
    return [
        h
        for h in public_holidays(country)
        if start <= h.date <= end and _applies(h.nationwide, h.regions, subdivisions)
    ]


def long_weekends(start: date | None = None, end: date | None = None) -> list[LongWeekend]:
    rows = [LongWeekend.model_validate(w) for w in _raw("holidays.json")["pl_long_weekends"]]
    return [w for w in rows if w.overlaps(start or date.min, end or date.max)]


def voivodeship_for_airport(airport: str) -> str:
    """ISO 3166-2 voivodeship of a PL origin airport; KeyError for airports we don't map."""
    try:
        return _raw("holidays.json")["airport_voivodeship"][airport.upper()]
    except KeyError:
        raise KeyError(f"no voivodeship known for origin airport {airport!r}") from None


@cache
def school_breaks(
    voivodeship: str | None = None, airport: str | None = None
) -> tuple[SchoolBreak, ...]:
    """PL school breaks 2026/27; filter by ISO voivodeship ("PL-12") or origin airport ("KRK").

    An unknown airport raises KeyError rather than returning every voivodeship's ferie.
    """
    if airport:
        voivodeship = voivodeship_for_airport(airport)
    rows = (SchoolBreak.model_validate(b) for b in _raw("holidays.json")["pl_school_breaks"])
    return tuple(b for b in rows if voivodeship is None or voivodeship in b.voivodeships)


def school_holidays(
    country: str, start: date, end: date, subdivisions: list[str] | None = None
) -> list[SchoolHoliday]:
    rows = (SchoolHoliday.model_validate(h) for h in _raw("holidays.json")["school_holidays"])
    return [
        h
        for h in rows
        if h.country == country.upper()
        and h.overlaps(start, end)
        and _applies(h.nationwide, h.regions, subdivisions)
    ]


def crowd_flags(key: str, start: date, end: date) -> list[str]:
    """Human-readable reasons a trip window may be busier than the monthly score suggests.

    Only holidays that apply at the destination: nationwide ones, or regional ones whose regions
    include the city's ISO 3166-2 subdivision.
    """
    c = city(key)
    sub = c.subdivisions
    flags = [f"{h.name} ({c.country}, {h.date})" for h in holidays_in(c.country, start, end, sub)]
    for h in school_holidays(c.country, start, end, sub):
        scope = "nationwide" if h.nationwide else "regional, incl. " + ", ".join(sub)
        flags.append(f"{h.name} school holidays ({c.country}, {scope}, {h.start}..{h.end})")
    return flags


# --- attractions ----------------------------------------------------------------------------


@cache
def _attractions() -> dict[str, CityAttractions]:
    return {
        r["city_id"]: CityAttractions.model_validate(r)
        for r in _raw("attractions.json")["attractions"]
    }


def attractions(
    key: str, tags: dict[str, float] | None = None, limit: int | None = None
) -> list[Attraction]:
    """Top attractions; with `tags` (e.g. TasteProfile.interests) ranked by taste match first."""
    entry = _attractions().get(city(key).id)
    items = list(entry.items) if entry else []
    if tags:
        items.sort(key=lambda a: (-sum(tags.get(t, 0.0) for t in a.tags), -a.popularity))
    return items[:limit] if limit else items


# --- climate --------------------------------------------------------------------------------


class MonthClimate(BaseModel):
    month: int
    temp_max_c: float | None
    temp_min_c: float | None
    precipitation_mm: float | None
    rainy_day_share: float | None
    sunshine_h: float | None


class CityClimate(BaseModel):
    city_id: str
    iata: str
    years: list[int]
    months: list[MonthClimate]  # Jan..Dec


@cache
def _climate() -> dict[str, CityClimate]:
    try:
        rows = _raw("climate.json")["climate"]
    except FileNotFoundError:
        return {}
    return {r["city_id"]: CityClimate.model_validate(r) for r in rows}


def climate(key: str) -> CityClimate | None:
    """Monthly climate normals (Open-Meteo ERA5 snapshot), or None if the city has none."""
    return _climate().get(city(key).id)


# --- airports -------------------------------------------------------------------------------


class Airport(BaseModel):
    iata: str
    name: str
    lat: float
    lon: float
    municipality: str | None = None
    country: str
    # PL origins only (tripai.seed.airports.ORIGIN_LABELS): {"pl": ..., "en": ...}
    city: dict[str, str] | None = None  # the city it serves, for grouping (WAW + WMI -> Warszawa)
    label: dict[str, str] | None = None  # how the UI names it ("Warszawa-Modlin")


@cache
def _airports() -> dict[str, Airport]:
    try:
        rows = _raw("airports.json")["airports"]
    except FileNotFoundError:
        return {}
    return {r["iata"]: Airport.model_validate(r) for r in rows}


def airport(iata: str) -> Airport | None:
    """Coordinates of a seed airport (OurAirports snapshot), or None."""
    return _airports().get(iata.upper())


def origin_airports() -> list[Airport]:
    """PL origin airports offered in the app (the ones with a UI label)."""
    return [a for a in _airports().values() if a.label]


def airport_label(iata: str, lang: str = "en") -> str:
    """'Warszawa-Modlin (WMI)' / 'Warsaw Modlin (WMI)'; unknown or non-origin airports: the code."""
    ap = airport(iata)
    if ap is None or not ap.label:
        return iata.upper()
    return f"{ap.label.get(lang) or ap.label['en']} ({ap.iata})"
