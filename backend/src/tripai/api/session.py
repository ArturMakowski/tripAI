"""Server-issued sessions: the API never trusts a client-sent `user_id`.

Every response carries a signed token `s_<32 hex>.<hmac>` in the `X-TripAI-Session` header and an
HttpOnly cookie. Clients send it back (header preferred: the frontend is on another origin and CORS
is `*`, so cookies may not travel). A missing or tampered token gets a fresh, unguessable session, so
one caller can never read or overwrite another user's profile, weights, recommendations or feedback.
Set TRIPAI_SESSION_SECRET in production; without it a random per-process secret is used and
sessions reset on restart.
"""

import hashlib
import hmac
import logging
import secrets
from functools import cache

from fastapi import Request, Response

from tripai.connectors import config

log = logging.getLogger(__name__)

HEADER = "X-TripAI-Session"
COOKIE = "tripai_session"
MAX_AGE = 365 * 24 * 3600


@cache
def _process_secret() -> bytes:
    log.warning("TRIPAI_SESSION_SECRET not set: sessions are valid for this process only")
    return secrets.token_bytes(32)


def _secret() -> bytes:
    env = config.env("TRIPAI_SESSION_SECRET")
    return env.encode() if env else _process_secret()


def _sign(uid: str) -> str:
    return hmac.new(_secret(), uid.encode(), hashlib.sha256).hexdigest()[:32]


def issue() -> tuple[str, str]:
    uid = "s_" + secrets.token_hex(16)
    return uid, f"{uid}.{_sign(uid)}"


def verify(token: str | None) -> str | None:
    if not token or token.count(".") != 1:
        return None
    uid, sig = token.split(".")
    if not uid.startswith("s_") or not hmac.compare_digest(sig, _sign(uid)):
        return None
    return uid


async def session_user(request: Request, response: Response) -> str:
    """FastAPI dependency: the caller's user id, taken from a valid token or newly issued."""
    token = request.headers.get(HEADER) or request.cookies.get(COOKIE)
    uid = verify(token)
    if uid is None:
        uid, token = issue()
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.headers[HEADER] = token
    response.set_cookie(
        COOKIE,
        token,
        max_age=MAX_AGE,
        httponly=True,
        secure=https,
        samesite="none" if https else "lax",
    )
    return uid
