"""Private backend: only the frontend's server-side proxy (frontend/app/api/[...path]) may call it.

The proxy adds `X-TripAI-Internal-Key: $TRIPAI_INTERNAL_KEY` to every request; anything else gets 401.
`GET /health` stays open for platform health checks, but callers without the key only learn `{"ok": true}`
(the endpoint reads `internal_caller()`). /docs and /openapi.json are behind the key like every other route.
Without TRIPAI_INTERNAL_KEY (local dev, tests) everything is allowed and a warning is logged at startup,
unless this is a deployment (RAILWAY_ENVIRONMENT set, or TRIPAI_ENV=production): then the app refuses to
start, so a lost or renamed variable fails the deploy instead of silently reopening the API.
The key should be ASCII (e.g. `openssl rand -hex 32`); it is compared as raw bytes.
"""

import hmac
import json
import logging

from tripai.connectors import config

log = logging.getLogger(__name__)

HEADER = "X-TripAI-Internal-Key"
ENV = "TRIPAI_INTERNAL_KEY"
_STATE = "tripai_internal"
_HEADER_B = HEADER.lower().encode()  # ASGI header names are lowercase


def internal_key() -> str | None:
    return config.env(ENV)


def key_matches(sent: bytes | None, expected: str) -> bool:
    """Constant-time compare of the raw header bytes (no early exit on the first differing byte)."""
    return sent is not None and hmac.compare_digest(sent, expected.encode())


def internal_caller(request) -> bool:
    """True when the request carried the key (or no key is configured)."""
    return bool(request.scope.get("state", {}).get(_STATE))


class InternalKeyMiddleware:
    """Pure ASGI middleware; runs outermost so nothing (CORS, routes, docs) answers before it."""

    def __init__(self, app, key: str | None) -> None:
        self.app, self.key = app, key

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self.key is None:
            ok = True
        else:
            ok = key_matches(dict(scope["headers"]).get(_HEADER_B), self.key)
        scope.setdefault("state", {})[_STATE] = ok
        if ok or (scope["method"] == "GET" and scope["path"] == "/health"):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": "unauthorized"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def deployed() -> bool:
    return config.env("RAILWAY_ENVIRONMENT") is not None or config.env("TRIPAI_ENV") == "production"


def require_key_when_deployed(key: str | None) -> None:
    """Fail closed: a deployment without the key must not start (a dev box only gets a warning)."""
    if key is not None:
        return
    if deployed():
        raise RuntimeError(
            f"{ENV} is not set in a deployed environment: refusing to start an open API"
        )
    log.warning(
        "%s not set: the API accepts every caller (fine for local dev/tests, not for prod)", ENV
    )
