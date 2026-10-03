import json
from datetime import date, datetime

from tripai.models import FreeWindow
from tripai.scoring.windows import (
    TZ,
    BusyInterval,
    builtin_pl_holidays,
    easter_sunday,
    free_windows,
    long_weekends,
    pl_holidays,
    trip_windows,
    work_calendar,
)


def test_easter():
    assert easter_sunday(2026) == date(2026, 4, 5)
    assert easter_sunday(2027) == date(2027, 3, 28)


def test_builtin_holidays_2026():
    days = {h.date for h in builtin_pl_holidays(2026)}
    assert date(2026, 6, 4) in days  # Boże Ciało
    assert date(2026, 12, 24) in days  # Wigilia (since 2025)
    assert date(2026, 11, 11) in days
    assert len(days) == 14


def test_holidays_from_data_dir(tmp_path):
    (tmp_path / "holidays.json").write_text(
        json.dumps([{"date": "2026-11-11", "localName": "Niepodległość", "countryCode": "PL"}])
    )
    hols = pl_holidays(date(2026, 11, 1), date(2026, 11, 30), base=tmp_path)
    assert [h.name for h in hols] == ["Niepodległość"]
    assert hols[0].source == "holidays.json"
    # years not covered by the file fall back to the builtin table
    assert pl_holidays(date(2027, 11, 1), date(2027, 11, 30), base=tmp_path)[0].source.startswith(
        "builtin"
    )


def test_free_windows_from_busy():
    busy = [
        BusyInterval(
            start=datetime(2026, 11, 2, 9, tzinfo=TZ), end=datetime(2026, 11, 6, 17, tzinfo=TZ)
        ),
        BusyInterval(
            start=datetime(2026, 11, 9, 9, tzinfo=TZ), end=datetime(2026, 11, 9, 10, tzinfo=TZ)
        ),
    ]
    ws = free_windows(busy, date(2026, 11, 1), date(2026, 11, 12))
    assert ws == [
        FreeWindow(start=date(2026, 11, 7), end=date(2026, 11, 8)),
        FreeWindow(start=date(2026, 11, 10), end=date(2026, 11, 12)),
    ]


def test_work_calendar_frees_holidays():
    start, end = date(2026, 11, 1), date(2026, 11, 15)
    busy = work_calendar(start, end, pl_holidays(start, end))
    ws = free_windows(busy, start, end, min_days=1)
    assert FreeWindow(start=date(2026, 11, 11), end=date(2026, 11, 11)) in ws


def test_long_weekend_radar():
    radar = long_weekends(date(2026, 10, 1), date(2027, 6, 30), max_leave=2)
    labels = [b.label for b in radar]
    nov = [b for b in radar if b.window.start.month == 11]
    assert {(b.window.start, b.window.end) for b in nov} == {
        (date(2026, 11, 7), date(2026, 11, 11)),
        (date(2026, 11, 11), date(2026, 11, 15)),
    }
    assert all(len(b.leave_days) == 2 and b.total_days == 5 for b in nov)
    corpus = next(b for b in radar if b.window.start == date(2027, 5, 27))
    assert corpus.leave_days == [date(2027, 5, 28)] and corpus.total_days == 4
    assert any(lbl.startswith("Take 1 day off (Fri 28 May) -> 4 days") for lbl in labels)
    xmas = next(b for b in radar if b.window.start == date(2026, 12, 24))
    assert xmas.leave_days == [] and xmas.total_days == 4


def test_trip_windows():
    long = FreeWindow(start=date(2026, 7, 1), end=date(2026, 7, 31))
    out = trip_windows([long], (3, 7))
    assert len(out) == 4 and all((w.end - w.start).days == 6 for w in out)
    weekend = FreeWindow(start=date(2026, 7, 4), end=date(2026, 7, 5))
    assert trip_windows([weekend], (3, 7)) == [weekend]  # only option -> kept
    assert trip_windows([weekend, long], (3, 7)) == out


def test_radar_keeps_bridge_that_started_before_range():
    # from Mon 9 Nov: the 7-11 Nov bridge still needs leave on 9-10 Nov, so it is still actionable
    radar = long_weekends(date(2026, 11, 9), date(2026, 11, 30))
    assert (date(2026, 11, 7), date(2026, 11, 11)) in {
        (b.window.start, b.window.end) for b in radar
    }
    # ...but from 11 Nov the leave days are in the past
    radar = long_weekends(date(2026, 11, 11), date(2026, 11, 30))
    assert (date(2026, 11, 7), date(2026, 11, 11)) not in {
        (b.window.start, b.window.end) for b in radar
    }


def test_one_day_trips_allowed_when_profile_allows():
    day = FreeWindow(start=date(2026, 7, 4), end=date(2026, 7, 4))
    assert trip_windows([day], (1, 3)) == [day]
    assert trip_windows([day], (3, 7)) == []
