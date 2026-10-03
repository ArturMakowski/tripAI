"""Open-Meteo weather: daily forecast when the window is ≤16 days out, otherwise "climate normals"
computed from the ERA5 archive for the same calendar dates over the last N years. No API key."""

import asyncio
import calendar
import math
import statistics
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from tripai.connectors import config
from tripai.connectors.base import Connector, FixtureNotFound, SourcedResult
from tripai.models import Evidence

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DAILY_VARS = "temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration"
FORECAST_HORIZON_DAYS = 16
ARCHIVE_LAG_DAYS = 7  # ERA5 archive trails real time by ~5 days
RAINY_DAY_MM = 1.0
FIXTURE_MATCH_KM = 75


class DailyWeather(BaseModel):
    date: date
    temp_max_c: float | None
    temp_min_c: float | None
    precipitation_mm: float | None
    sunshine_h: float | None


class WeatherSummary(SourcedResult):
    latitude: float
    longitude: float
    place: str | None = None
    start: date
    end: date
    mode: Literal["forecast", "climate_normal"]
    years: list[int] = Field(default_factory=list)  # archive years averaged (climate_normal only)
    days: list[DailyWeather]
    avg_temp_max_c: float | None
    avg_temp_min_c: float | None
    avg_precipitation_mm: float | None
    rainy_day_share: float | None  # share of days with ≥1 mm (0..1)
    avg_sunshine_h: float | None

    def evidence(self) -> list[Evidence]:
        where = self.place or f"{self.latitude:.2f},{self.longitude:.2f}"
        span = f"{self.start:%d %b}–{self.end:%d %b}"
        basis = (
            "forecast"
            if self.mode == "forecast"
            else f"same dates {min(self.years)}–{max(self.years)} avg"
        )
        out: list[Evidence] = []
        if self.avg_temp_max_c is not None:
            out.append(
                self._ev(
                    "weather", f"Avg max temp {where} {span} ({basis})", self.avg_temp_max_c, "°C"
                )
            )
        if self.rainy_day_share is not None:
            out.append(
                self._ev(
                    "weather", f"Rainy days {where} {span} ({basis})", self.rainy_day_share, "0-1"
                )
            )
        if self.avg_sunshine_h is not None:
            out.append(
                self._ev(
                    "weather",
                    f"Avg sunshine {where} {span} ({basis})",
                    self.avg_sunshine_h,
                    "h/day",
                )
            )
        return out


def _mean(values: list[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    return round(statistics.fmean(clean), 1) if clean else None


def _parse_daily(payload: dict) -> dict[date, DailyWeather]:
    d = payload["daily"]
    out = {}
    for i, day in enumerate(d["time"]):
        sun = d.get("sunshine_duration", [None] * len(d["time"]))[i]
        out[date.fromisoformat(day)] = DailyWeather(
            date=date.fromisoformat(day),
            temp_max_c=d["temperature_2m_max"][i],
            temp_min_c=d["temperature_2m_min"][i],
            precipitation_mm=d["precipitation_sum"][i],
            sunshine_h=None if sun is None else round(sun / 3600, 1),
        )
    return out


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def _coord_name(prefix: str, lat: float, lon: float, suffix: str = "") -> str:
    return f"{prefix}_{lat:.2f}_{lon:.2f}" + (f"_{suffix}" if suffix else "")


def _months(start: date, end: date) -> list[tuple[int, int]]:
    out, (y, m) = [], (start.year, start.month)
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _shift_year(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year + years, day=28)


class OpenMeteo(Connector):
    async def weather(
        self,
        lat: float,
        lon: float,
        start: date,
        end: date,
        *,
        place: str | None = None,
        years: int = 3,
        today: date | None = None,
    ) -> WeatherSummary:
        today = today or datetime.now(UTC).date()
        if today <= start and end <= today + timedelta(days=FORECAST_HORIZON_DAYS - 1):
            return await self.forecast(lat, lon, start, end, place=place)
        return await self.climate_normals(
            lat, lon, start, end, place=place, years=years, today=today
        )

    async def forecast(
        self, lat: float, lon: float, start: date, end: date, *, place: str | None = None
    ) -> WeatherSummary:
        source = "open-meteo:forecast"
        params = {
            "latitude": round(lat, 2),
            "longitude": round(lon, 2),
            "daily": DAILY_VARS,
            "timezone": "auto",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        }
        payload, fetched_at = await self._fetch(
            source, FORECAST_URL, params, fixture=self._fixture_name("forecast", lat, lon)
        )
        days = [d for k, d in sorted(_parse_daily(payload).items()) if start <= k <= end]
        return self._summary(
            source, fetched_at, lat, lon, place, start, end, "forecast", [], days, days
        )

    async def climate_normals(
        self,
        lat: float,
        lon: float,
        start: date,
        end: date,
        *,
        place: str | None = None,
        years: int = 3,
        today: date | None = None,
    ) -> WeatherSummary:
        """Average of the same calendar dates over the latest `years` complete archive years."""
        today = today or datetime.now(UTC).date()
        latest_ok = today - timedelta(days=ARCHIVE_LAG_DAYS)
        offset = -1
        while _shift_year(end, offset) > latest_ok:
            offset -= 1
        offsets = list(range(offset, offset - years, -1))

        jobs = []
        for off in offsets:
            s, e = _shift_year(start, off), _shift_year(end, off)
            jobs += [self._archive_month(lat, lon, y, m) for y, m in _months(s, e)]
        results = await asyncio.gather(*jobs)

        by_day: dict[date, DailyWeather] = {}
        fetched = []
        for days, fetched_at in results:
            by_day.update(days)
            fetched.append(fetched_at)

        per_md: dict[tuple[int, int], list[DailyWeather]] = defaultdict(list)
        raw: list[DailyWeather] = []
        for off in offsets:
            d = start
            while d <= end:
                hist = by_day.get(_shift_year(d, off))
                if hist is not None:
                    per_md[(d.month, d.day)].append(hist)
                    raw.append(hist)
                d += timedelta(days=1)

        normals = []
        d = start
        while d <= end:
            hs = per_md.get((d.month, d.day), [])
            normals.append(
                DailyWeather(
                    date=d,
                    temp_max_c=_mean([h.temp_max_c for h in hs]),
                    temp_min_c=_mean([h.temp_min_c for h in hs]),
                    precipitation_mm=_mean([h.precipitation_mm for h in hs]),
                    sunshine_h=_mean([h.sunshine_h for h in hs]),
                )
            )
            d += timedelta(days=1)
        used_years = sorted({_shift_year(start, off).year for off in offsets})
        return self._summary(
            "open-meteo:archive",
            min(fetched),
            lat,
            lon,
            place,
            start,
            end,
            "climate_normal",
            used_years,
            normals,
            raw,
        )

    async def _archive_month(
        self, lat: float, lon: float, year: int, month: int
    ) -> tuple[dict[date, DailyWeather], datetime]:
        last = calendar.monthrange(year, month)[1]
        params = {
            "latitude": round(lat, 2),
            "longitude": round(lon, 2),
            "daily": DAILY_VARS,
            "timezone": "auto",
            "start_date": f"{year:04d}-{month:02d}-01",
            "end_date": f"{year:04d}-{month:02d}-{last:02d}",
        }
        fixture = self._fixture_name("archive", lat, lon, f"{year:04d}-{month:02d}")
        payload, fetched_at = await self._fetch(
            "open-meteo:archive", ARCHIVE_URL, params, fixture=fixture
        )
        return _parse_daily(payload), fetched_at

    def _fixture_name(self, prefix: str, lat: float, lon: float, suffix: str = "") -> str:
        """Exact name when live (recording); in fixture mode, the nearest recorded location."""
        exact = _coord_name(prefix, lat, lon, suffix)
        if not self.fixtures:
            return exact
        folder = config.fixtures_dir() / "open-meteo" / prefix
        best: tuple[float, str] | None = None
        for path in folder.glob("*.json") if folder.exists() else []:
            parts = path.stem.split("_")
            if len(parts) < 3 or (suffix and parts[-1] != suffix):
                continue
            try:
                flat, flon = float(parts[1]), float(parts[2])
            except ValueError:
                continue
            dist = _haversine_km(lat, lon, flat, flon)
            if dist <= FIXTURE_MATCH_KM and (best is None or dist < best[0]):
                best = (dist, path.stem)
        if best is None:
            raise FixtureNotFound(f"no open-meteo {prefix} fixture near {lat},{lon} {suffix}")
        return best[1]

    def _summary(
        self,
        source: str,
        fetched_at: datetime,
        lat: float,
        lon: float,
        place: str | None,
        start: date,
        end: date,
        mode: Literal["forecast", "climate_normal"],
        years: list[int],
        days: list[DailyWeather],
        raw: list[DailyWeather],
    ) -> WeatherSummary:
        precip = [h.precipitation_mm for h in raw if h.precipitation_mm is not None]
        return WeatherSummary(
            source=source,
            fetched_at=fetched_at,
            latitude=lat,
            longitude=lon,
            place=place,
            start=start,
            end=end,
            mode=mode,
            years=years,
            days=days,
            avg_temp_max_c=_mean([d.temp_max_c for d in days]),
            avg_temp_min_c=_mean([d.temp_min_c for d in days]),
            avg_precipitation_mm=_mean([d.precipitation_mm for d in days]),
            rainy_day_share=(
                round(sum(p >= RAINY_DAY_MM for p in precip) / len(precip), 2) if precip else None
            ),
            avg_sunshine_h=_mean([d.sunshine_h for d in days]),
        )
