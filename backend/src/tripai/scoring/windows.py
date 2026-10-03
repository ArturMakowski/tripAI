"""Free-window finder + 'długi weekend' radar (PL public holidays + bridge days)."""

import json
import os
from collections.abc import Iterable, Sequence
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from tripai import i18n
from tripai.models import FreeWindow

TZ = ZoneInfo("Europe/Warsaw")
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class BusyInterval(BaseModel):
    start: datetime  # naive = Europe/Warsaw
    end: datetime


class Holiday(BaseModel):
    date: date
    name: str
    source: str = "builtin:pl-holidays"


class BridgeWindow(BaseModel):
    """A long weekend: `window` is fully off if you take `leave_days` off."""

    window: FreeWindow
    total_days: int
    leave_days: list[date] = Field(default_factory=list)
    holidays: list[Holiday] = Field(default_factory=list)
    label: str


# ---------------------------------------------------------------- holidays


def easter_sunday(year: int) -> date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month = (h + m - 7 * n + 114) // 31
    day = (h + m - 7 * n + 114) % 31 + 1
    return date(year, month, day)


def builtin_pl_holidays(year: int) -> list[Holiday]:
    """Polish statutory days off (ustawa o dniach wolnych od pracy), incl. Wigilia since 2025."""
    e = easter_sunday(year)
    days = [
        (date(year, 1, 1), "Nowy Rok"),
        (date(year, 1, 6), "Trzech Króli"),
        (e, "Wielkanoc"),
        (e + timedelta(days=1), "Poniedziałek Wielkanocny"),
        (date(year, 5, 1), "Święto Pracy"),
        (date(year, 5, 3), "Święto Konstytucji 3 Maja"),
        (e + timedelta(days=49), "Zielone Świątki"),
        (e + timedelta(days=60), "Boże Ciało"),
        (date(year, 8, 15), "Wniebowzięcie NMP"),
        (date(year, 11, 1), "Wszystkich Świętych"),
        (date(year, 11, 11), "Narodowe Święto Niepodległości"),
        (date(year, 12, 25), "Boże Narodzenie"),
        (date(year, 12, 26), "Drugi dzień Bożego Narodzenia"),
    ]
    if year >= 2025:
        days.append((date(year, 12, 24), "Wigilia"))
    return sorted((Holiday(date=d, name=n) for d, n in days), key=lambda h: h.date)


def data_dir() -> Path:
    env = os.getenv("TRIPAI_DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[4] / "data"


def _parse_holiday_file(path: Path) -> list[Holiday]:
    raw = json.loads(path.read_text())
    if isinstance(raw, dict):  # {"PL": [...]} or {"holidays": [...]}
        raw = raw.get("PL") or raw.get("pl") or raw.get("holidays") or []
    out = []
    for item in raw:
        if not isinstance(item, dict) or "date" not in item:
            continue
        if item.get("countryCode", "PL") != "PL":
            continue
        name = item.get("localName") or item.get("name") or "Święto"
        out.append(Holiday(date=date.fromisoformat(item["date"][:10]), name=name, source=path.name))
    return out


def pl_holidays(start: date, end: date, base: Path | None = None) -> list[Holiday]:
    """PL holidays in [start, end]: from data/holidays*.json (T3 seed, Nager.Date format) if present,
    else the built-in table."""
    base = base or data_dir()
    found: dict[date, Holiday] = {}
    for name in ("holidays_pl.json", "holidays.json"):
        p = base / name
        if p.is_file():
            try:
                for h in _parse_holiday_file(p):
                    found.setdefault(h.date, h)
            except (ValueError, KeyError, TypeError):
                found = {}
            if found:
                break
    years = range(start.year, end.year + 1)
    covered = {d.year for d in found}
    for y in years:
        if y not in covered:
            for h in builtin_pl_holidays(y):
                found.setdefault(h.date, h)
    return sorted((h for h in found.values() if start <= h.date <= end), key=lambda h: h.date)


# ---------------------------------------------------------------- free windows


def _local(dt: datetime) -> datetime:
    return dt.replace(tzinfo=TZ) if dt.tzinfo is None else dt.astimezone(TZ)


def busy_days(busy: Iterable[BusyInterval], start: date, end: date) -> set[date]:
    out: set[date] = set()
    for b in busy:
        s, e = _local(b.start), _local(b.end)
        d = max(s.date(), start)
        while d <= min(e.date(), end):
            day_start = datetime.combine(d, time.min, TZ)
            if s < day_start + timedelta(days=1) and e > day_start:
                out.add(d)
            d += timedelta(days=1)
    return out


def _runs(days: Iterable[date]) -> list[tuple[date, date]]:
    runs: list[tuple[date, date]] = []
    for d in sorted(days):
        if runs and d == runs[-1][1] + timedelta(days=1):
            runs[-1] = (runs[-1][0], d)
        else:
            runs.append((d, d))
    return runs


def free_windows(
    busy: Iterable[BusyInterval], start: date, end: date, min_days: int = 2, source: str = "manual"
) -> list[FreeWindow]:
    """Maximal runs of whole days in [start, end] with no busy interval touching them."""
    blocked = busy_days(busy, start, end)
    free = (start + timedelta(days=i) for i in range((end - start).days + 1))
    return [
        FreeWindow(start=s, end=e, source=source)
        for s, e in _runs(d for d in free if d not in blocked)
        if (e - s).days + 1 >= min_days
    ]


def work_calendar(
    start: date, end: date, holidays: Sequence[Holiday] = (), hours: tuple[int, int] = (9, 17)
) -> list[BusyInterval]:
    """Demo calendar: busy Mon-Fri 9-17 except public holidays."""
    hol = {h.date for h in holidays}
    out = []
    for i in range((end - start).days + 1):
        d = start + timedelta(days=i)
        if d.weekday() < 5 and d not in hol:
            out.append(
                BusyInterval(
                    start=datetime.combine(d, time(hours[0]), TZ),
                    end=datetime.combine(d, time(hours[1]), TZ),
                )
            )
    return out


def trip_windows(
    windows: Sequence[FreeWindow], length_days: tuple[int, int] = (3, 7), max_per_window: int = 4
) -> list[FreeWindow]:
    """Turn free windows into concrete trip windows: windows longer than the max trip length are
    split into weekly-staggered sub-windows; ones shorter than the min are kept only if nothing else fits."""
    lo, hi = length_days
    out: list[FreeWindow] = []
    short: list[FreeWindow] = []
    for w in windows:
        days = (w.end - w.start).days + 1
        if days < min(2, lo):
            continue
        if days < lo:
            short.append(w)
        elif days <= hi:
            out.append(w)
        else:
            s, n = w.start, 0
            while s + timedelta(days=hi - 1) <= w.end and n < max_per_window:
                out.append(FreeWindow(start=s, end=s + timedelta(days=hi - 1), source=w.source))
                s += timedelta(days=7)
                n += 1
    return out or short


# ---------------------------------------------------------------- długi weekend radar


MAX_LEAVE_DAYS = 4  # span search below covers up to this many leave days


def long_weekends(
    start: date,
    end: date,
    max_leave: int = 2,
    holidays: Sequence[Holiday] | None = None,
    lang: str | None = None,
) -> list[BridgeWindow]:
    """For every PL holiday in range: the longest fully-off stretch around it for 0..max_leave days
    of leave ('take 1 day off -> 4 days'). A stretch is reported only if it gives at least
    3 days off beyond the leave taken."""
    lg = i18n.pick(lang)
    pad = timedelta(days=10)
    hols = list(holidays) if holidays is not None else pl_holidays(start - pad, end + pad)
    hol_by_date = {h.date: h for h in hols}

    def off(d: date) -> bool:
        return d.weekday() >= 5 or d in hol_by_date

    results: dict[tuple[date, date], BridgeWindow] = {}
    for h in hols:
        if not (start <= h.date <= end) or h.date.weekday() >= 5:
            continue  # a holiday on a weekend adds no extra day off
        for k in range(max_leave + 1):
            spans: list[tuple[date, date]] = []
            for left in range(10):
                for right in range(10):
                    s, e = h.date - timedelta(days=left), h.date + timedelta(days=right)
                    if not (off(s) and off(e)):
                        continue  # never start/end on a leave day
                    if off(s - timedelta(days=1)) or off(e + timedelta(days=1)):
                        continue  # not maximal: could extend for free
                    n = (e - s).days + 1
                    if sum(not off(s + timedelta(days=i)) for i in range(n)) == k:
                        spans.append((s, e))
            if not spans:
                continue
            longest = max((e - s).days for s, e in spans)
            for s, e in sorted(sp for sp in spans if (sp[1] - sp[0]).days == longest):
                total = (e - s).days + 1
                if total < k + 3 or (s, e) in results:
                    continue
                span = [s + timedelta(days=i) for i in range(total)]
                leave = [d for d in span if not off(d)]
                # a stretch may start before `start` (or end after `end`) as long as every
                # leave day you'd have to book is still inside the range
                if (s < start or e > end) and not all(start <= d <= end for d in leave):
                    continue
                if not leave and (e < start or s > end):
                    continue
                in_span = [hol_by_date[d] for d in span if d in hol_by_date]
                names = ", ".join(dict.fromkeys(x.name for x in in_span))
                if leave:
                    n = len(leave)
                    label = i18n.t(
                        "radar.leave",
                        lg,
                        n=n,
                        s="s" if n > 1 else "",
                        dni_wolnego=i18n.plural_pl(
                            n, "dzień wolnego", "dni wolnego", "dni wolnego"
                        ),
                        days=", ".join(i18n.fmt_day(d, lg) for d in leave),
                        total=total,
                        start=i18n.fmt_day(s, lg),
                        end=i18n.fmt_day(e, lg),
                        names=names,
                    )
                else:
                    label = i18n.t(
                        "radar.free",
                        lg,
                        total=total,
                        start=i18n.fmt_day(s, lg),
                        end=i18n.fmt_day(e, lg),
                        names=names,
                    )
                results[(s, e)] = BridgeWindow(
                    window=FreeWindow(start=s, end=e, source="manual"),
                    total_days=total,
                    leave_days=leave,
                    holidays=in_span,
                    label=label,
                )
    # drop windows dominated by another with the same/fewer leave days that strictly contains them
    items = list(results.values())
    kept = [
        b
        for b in items
        if not any(
            o is not b
            and o.window.start <= b.window.start
            and b.window.end <= o.window.end
            and len(o.leave_days) <= len(b.leave_days)
            for o in items
        )
    ]
    return sorted(kept, key=lambda b: (b.window.start, len(b.leave_days)))
