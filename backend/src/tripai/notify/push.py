"""Web push (VAPID) via pywebpush. Keys come from env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
VAPID_SUBJECT (mailto:...). Generate a pair with `uv run python -m tripai.notify.vapid`."""

import base64
import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from tripai.notify.models import Notification, PushSubscription

log = logging.getLogger(__name__)
DEFAULT_SUBJECT = "mailto:armak58@gmail.com"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def generate_vapid_keys() -> tuple[str, str]:
    """(public, private): public = uncompressed P-256 point (the browser's applicationServerKey),
    private = raw 32-byte scalar; both base64url without padding (what pywebpush accepts)."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64url(public), _b64url(private)


@dataclass(frozen=True)
class VapidConfig:
    public_key: str
    private_key: str
    subject: str

    @classmethod
    def from_env(cls) -> "VapidConfig | None":
        pub, priv = os.environ.get("VAPID_PUBLIC_KEY"), os.environ.get("VAPID_PRIVATE_KEY")
        if not (pub and priv):
            return None
        return cls(pub, priv, os.environ.get("VAPID_SUBJECT") or DEFAULT_SUBJECT)


def push_payload(n: Notification) -> dict:
    """Small (<4 KB) payload for the service worker; the full card stays in the inbox."""
    return {
        "id": n.id,
        "title": n.title,
        "body": n.body,
        "url": n.url,
        "recommendation_id": n.recommendation_id,
        "inputs_hash": n.inputs_hash,
        "kind": n.kind,
    }


@dataclass
class PushOutcome:
    sent: int = 0
    gone: list[str] | None = None  # endpoints the push service says are expired (404/410)
    errors: list[str] | None = None

    @property
    def status(self) -> str:
        if self.errors and not self.sent:
            return "error:" + "; ".join(self.errors)[:200]
        return f"sent:{self.sent}"


# (subscription_info, data, vapid_private_key, vapid_claims) -> None; injectable for tests
Sender = Callable[..., object]


def _default_sender(**kwargs) -> object:
    from pywebpush import webpush

    return webpush(**kwargs)


class WebPusher:
    def __init__(self, vapid: VapidConfig | None, sender: Sender | None = None) -> None:
        self.vapid = vapid
        self._send = sender or _default_sender

    @property
    def enabled(self) -> bool:
        return self.vapid is not None

    def send(self, subs: list[PushSubscription], n: Notification) -> PushOutcome:
        out = PushOutcome(gone=[], errors=[])
        if self.vapid is None:
            out.errors.append("VAPID keys not configured")
            return out
        data = json.dumps(push_payload(n), ensure_ascii=False)
        for s in subs:
            try:
                self._send(
                    subscription_info={"endpoint": s.endpoint, "keys": s.keys.model_dump()},
                    data=data,
                    vapid_private_key=self.vapid.private_key,
                    vapid_claims={"sub": self.vapid.subject},
                    ttl=24 * 3600,
                )
                out.sent += 1
            except Exception as exc:  # noqa: BLE001 - one bad endpoint must not stop the rest
                code = getattr(getattr(exc, "response", None), "status_code", None)
                if code in (404, 410):
                    out.gone.append(s.endpoint)
                else:
                    log.warning("web push to %s failed: %s", s.endpoint[:60], exc)
                    out.errors.append(f"{code or type(exc).__name__}")
        return out
