"""Google Calendar `freebusy.query` → busy intervals → free day windows.

Auth: OAuth installed-app (loopback + PKCE) flow, no extra deps. Run once:
    uv run python -m tripai.connectors.gcal_freebusy login
Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (Desktop OAuth client). The token (with refresh token)
is cached at TRIPAI_GCAL_TOKEN or ~/.config/tripai/gcal_token.json.
"""

import asyncio
import base64
import hashlib
import json
import secrets
import sys
import time
import webbrowser
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
from pydantic import BaseModel, Field

from tripai.connectors import config
from tripai.connectors.base import Connector, ConnectorError, MissingCredentials, SourcedResult
from tripai.models import Evidence, FreeWindow

FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/calendar.freebusy"


def token_path() -> Path:
    return Path(config.env("TRIPAI_GCAL_TOKEN") or Path.home() / ".config/tripai/gcal_token.json")


def _client_creds() -> tuple[str, str]:
    cid, secret = config.env("GOOGLE_CLIENT_ID"), config.env("GOOGLE_CLIENT_SECRET")
    if not cid or not secret:
        raise MissingCredentials("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set")
    return cid, secret


def _save_token(token: dict) -> None:
    path = token_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    token["expires_at"] = time.time() + float(token.get("expires_in", 3600)) - 60
    path.write_text(json.dumps(token))
    path.chmod(0o600)


def login(open_browser: bool = True) -> Path:
    """Interactive installed-app flow: opens the consent page, receives the code on localhost."""
    cid, secret = _client_creds()
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    state = secrets.token_urlsafe(16)
    received: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            qs = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            if "code" in qs or "error" in qs:
                received.update(qs)
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h3>TripAI: calendar connected. You can close this tab.</h3>")

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    redirect = f"http://127.0.0.1:{server.server_port}/"
    url = (
        AUTH_URL
        + "?"
        + urlencode(
            {
                "client_id": cid,
                "redirect_uri": redirect,
                "response_type": "code",
                "scope": SCOPE,
                "access_type": "offline",
                "prompt": "consent",
                "state": state,
                "code_challenge": challenge.decode(),
                "code_challenge_method": "S256",
            }
        )
    )
    thread = Thread(
        target=lambda: [server.handle_request() for _ in range(5) if not received], daemon=True
    )
    thread.start()
    print(f"Open this URL to authorise Google Calendar (free/busy only):\n{url}")
    if open_browser:
        webbrowser.open(url)
    thread.join(timeout=300)
    server.server_close()
    if received.get("state") != state or "code" not in received:
        raise ConnectorError(f"OAuth failed: {received.get('error', 'no code received')}")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "code": received["code"],
            "client_id": cid,
            "client_secret": secret,
            "redirect_uri": redirect,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        },
        timeout=30,
    )
    if resp.is_error:
        raise ConnectorError(f"token exchange failed: {resp.text[:300]}")
    _save_token(resp.json())
    return token_path()


async def access_token(client: httpx.AsyncClient | None = None) -> str:
    """Cached access token, refreshed with the stored refresh token when expired."""
    path = token_path()
    if not path.exists():
        raise MissingCredentials(
            f"no Google token at {path}; run `uv run python -m tripai.connectors.gcal_freebusy login`"
        )
    token = json.loads(path.read_text())
    if token.get("expires_at", 0) > time.time():
        return token["access_token"]
    if "refresh_token" not in token:
        raise MissingCredentials("Google token expired and has no refresh_token; log in again")
    cid, secret = _client_creds()
    data = {
        "client_id": cid,
        "client_secret": secret,
        "refresh_token": token["refresh_token"],
        "grant_type": "refresh_token",
    }
    if client is not None:
        resp = await client.post(TOKEN_URL, data=data)
    else:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(TOKEN_URL, data=data)
    if resp.is_error:
        raise ConnectorError(f"token refresh failed: {resp.text[:300]}")
    new = {**token, **resp.json()}
    _save_token(new)
    return new["access_token"]


class BusyInterval(BaseModel):
    calendar: str
    start: datetime
    end: datetime


class FreeBusyResult(SourcedResult):
    time_min: datetime
    time_max: datetime
    timezone: str
    busy: list[BusyInterval]
    errors: dict[str, list[dict]] = Field(default_factory=dict)

    def free_days(self) -> list[date]:
        """Calendar days (in `timezone`) with no busy interval at all."""
        tz = ZoneInfo(self.timezone)
        busy_days: set[date] = set()
        for b in self.busy:
            d, last = b.start.astimezone(tz).date(), (b.end - timedelta(seconds=1)).astimezone(tz)
            while d <= last.date():
                busy_days.add(d)
                d += timedelta(days=1)
        d, last = self.time_min.astimezone(tz).date(), self.time_max.astimezone(tz).date()
        out = []
        while d < last:
            if d not in busy_days:
                out.append(d)
            d += timedelta(days=1)
        return out

    def free_windows(self, min_days: int = 2, max_days: int | None = None) -> list[FreeWindow]:
        """Maximal runs of consecutive free days, length ≥ min_days (split if > max_days)."""
        days = self.free_days()
        runs: list[list[date]] = []
        for d in days:
            if runs and runs[-1][-1] + timedelta(days=1) == d:
                runs[-1].append(d)
            else:
                runs.append([d])
        out = []
        for run in runs:
            chunks = (
                [run]
                if not max_days
                else [run[i : i + max_days] for i in range(0, len(run), max_days)]
            )
            out += [
                FreeWindow(start=c[0], end=c[-1], source="gcal")
                for c in chunks
                if len(c) >= min_days
            ]
        return out

    def evidence(self) -> list[Evidence]:
        return [
            self._ev(
                "calendar",
                f"Free {w.start:%d %b}–{w.end:%d %b}",
                (w.end - w.start).days + 1,
                "days",
            )
            for w in self.free_windows()
        ]


def parse_freebusy(payload: dict, fetched_at: datetime, tz: str) -> FreeBusyResult:
    busy, errors = [], {}
    for cal_id, cal in payload.get("calendars", {}).items():
        if cal.get("errors"):
            errors[cal_id] = cal["errors"]
        busy += [
            BusyInterval(
                calendar=cal_id,
                start=datetime.fromisoformat(b["start"]),
                end=datetime.fromisoformat(b["end"]),
            )
            for b in cal.get("busy", [])
        ]
    return FreeBusyResult(
        source="gcal:freebusy",
        fetched_at=fetched_at,
        time_min=datetime.fromisoformat(payload["timeMin"]),
        time_max=datetime.fromisoformat(payload["timeMax"]),
        timezone=tz,
        busy=sorted(busy, key=lambda b: b.start),
        errors=errors,
    )


class GCalFreeBusy(Connector):
    async def query(
        self,
        start: date,
        end: date,
        calendars: list[str] | None = None,
        timezone: str = "Europe/Warsaw",
    ) -> FreeBusyResult:
        """Busy intervals for [start, end] (inclusive days) across `calendars` (default primary)."""
        tz = ZoneInfo(timezone)
        body = {
            "timeMin": datetime.combine(start, dtime.min, tz).isoformat(),
            "timeMax": datetime.combine(end + timedelta(days=1), dtime.min, tz).isoformat(),
            "timeZone": timezone,
            "items": [{"id": c} for c in calendars or ["primary"]],
        }
        headers = None
        if not self.fixtures:
            headers = {"Authorization": f"Bearer {await access_token(self._client)}"}
        payload, fetched_at = await self._fetch(
            "gcal:freebusy",
            FREEBUSY_URL,
            {},
            fixture="primary",
            method="POST",
            json_body=body,
            headers=headers,
        )
        return parse_freebusy(payload, fetched_at, timezone)


if __name__ == "__main__":
    config.load_dotenv_files()
    if sys.argv[1:2] == ["login"]:
        print(f"token saved to {login()}")
    else:
        today = datetime.now(UTC).date()
        res = asyncio.run(GCalFreeBusy(fixtures=False).query(today, today + timedelta(days=90)))
        for w in res.free_windows():
            print(w.start, w.end)
