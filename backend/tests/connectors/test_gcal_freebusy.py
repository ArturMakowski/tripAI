import json
import time
from datetime import date

import httpx
import respx

from tripai.connectors.gcal_freebusy import FREEBUSY_URL, TOKEN_URL, GCalFreeBusy, token_path

PAYLOAD = {
    "kind": "calendar#freeBusy",
    "timeMin": "2027-01-04T23:00:00.000Z",
    "timeMax": "2027-01-14T23:00:00.000Z",
    "calendars": {
        "primary": {
            "busy": [
                {"start": "2027-01-05T08:00:00Z", "end": "2027-01-05T16:00:00Z"},
                {"start": "2027-01-11T08:00:00Z", "end": "2027-01-12T16:00:00Z"},
            ]
        }
    },
}


@respx.mock
async def test_query_refreshes_token_and_finds_windows(disk_cache, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "sec")
    token_path().write_text(
        json.dumps({"access_token": "old", "refresh_token": "r", "expires_at": 0})
    )
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "new", "expires_in": 3600})
    )
    fb = respx.post(FREEBUSY_URL).mock(return_value=httpx.Response(200, json=PAYLOAD))

    res = await GCalFreeBusy(cache=disk_cache).query(date(2027, 1, 5), date(2027, 1, 14))
    assert fb.calls.last.request.headers["Authorization"] == "Bearer new"
    assert json.loads(fb.calls.last.request.content)["items"] == [{"id": "primary"}]
    assert json.loads(token_path().read_text())["expires_at"] > time.time()

    assert date(2027, 1, 5) not in res.free_days()
    assert date(2027, 1, 12) not in res.free_days()
    windows = [(w.start, w.end) for w in res.free_windows(min_days=3)]
    assert windows == [(date(2027, 1, 6), date(2027, 1, 10))]
    assert res.free_windows(min_days=2, max_days=3)[0].end == date(2027, 1, 8)
    assert res.evidence()[0].source == "gcal:freebusy"


async def test_fixture_mode_needs_no_token(fixtures_mode):
    res = await GCalFreeBusy().query(date(2027, 1, 1), date(2027, 1, 31))
    assert any(w.start.month == 1 for w in res.free_windows())
