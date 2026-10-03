from datetime import date, timedelta

import httpx
import respx

from tripai.connectors.open_meteo import ARCHIVE_URL, FORECAST_URL, OpenMeteo


def _daily(start: date, n: int, tmax: float, precip: float) -> dict:
    days = [(start + timedelta(days=i)).isoformat() for i in range(n)]
    return {
        "daily_units": {"temperature_2m_max": "°C"},
        "daily": {
            "time": days,
            "temperature_2m_max": [tmax] * n,
            "temperature_2m_min": [tmax - 8] * n,
            "precipitation_sum": [precip] * n,
            "sunshine_duration": [7200.0] * n,
        },
    }


@respx.mock
async def test_far_window_uses_archive_normals(disk_cache):
    def respond(request):
        start = date.fromisoformat(request.url.params["start_date"])
        tmax = {2024: 12.0, 2025: 14.0, 2026: 16.0}[start.year]
        return httpx.Response(200, json=_daily(start, 31, tmax, 2.0 if start.year == 2024 else 0))

    route = respx.get(ARCHIVE_URL).mock(side_effect=respond)
    w = await OpenMeteo(cache=disk_cache).weather(
        41.9, 12.5, date(2027, 1, 14), date(2027, 1, 19), place="Rome", today=date(2026, 10, 3)
    )
    assert route.call_count == 3
    assert w.mode == "climate_normal" and w.years == [2024, 2025, 2026]
    assert w.avg_temp_max_c == 14.0
    assert w.rainy_day_share == 0.33
    assert w.avg_sunshine_h == 2.0
    assert w.days[0].date == date(2027, 1, 14) and len(w.days) == 6
    ev = w.evidence()
    assert ev[0].source == "open-meteo:archive" and ev[0].unit == "°C"

    # second call served from cache
    await OpenMeteo(cache=disk_cache).weather(
        41.9, 12.5, date(2027, 1, 14), date(2027, 1, 19), today=date(2026, 10, 3)
    )
    assert route.call_count == 3


@respx.mock
async def test_near_window_uses_forecast(disk_cache):
    today = date(2026, 10, 3)
    respx.get(FORECAST_URL).mock(
        return_value=httpx.Response(200, json=_daily(date(2026, 10, 5), 3, 25.0, 0.0))
    )
    w = await OpenMeteo(cache=disk_cache).weather(
        41.9, 12.5, date(2026, 10, 5), date(2026, 10, 7), today=today
    )
    assert w.mode == "forecast" and w.avg_temp_max_c == 25.0 and w.rainy_day_share == 0.0


async def test_fixture_mode_matches_nearest_recorded_city(fixtures_mode):
    # Seed coords for Rome differ slightly from the recorded ones; nearest fixture is used.
    w = await OpenMeteo().weather(
        41.8902, 12.4922, date(2027, 1, 14), date(2027, 1, 19), today=date(2026, 10, 3)
    )
    assert w.mode == "climate_normal"
    assert 5 < w.avg_temp_max_c < 20
