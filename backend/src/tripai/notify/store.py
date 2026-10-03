"""Notification state: prefs, push subscriptions, inbox, scan runs, watched picks.

`MemoryNotifyStore` is the default (tests, local). `SupabaseNotifyStore` writes through to the
tables in supabase/migrations/0003_notifications.sql via PostgREST with the server-only
SUPABASE_SECRET_KEY (RLS on, no anon policies). Reads go to Supabase first so several backend
replicas agree; any Supabase error is logged and the in-memory copy answers instead.
"""

import logging
import os
from datetime import datetime
from typing import Any, Protocol

import httpx
from pydantic import BaseModel

from tripai.notify.models import (
    Notification,
    NotificationPrefs,
    PushSubscription,
    SavedPick,
    ScanRun,
    now_utc,
)

log = logging.getLogger(__name__)


class NotifyStore(Protocol):
    def get_prefs(self, user_id: str) -> NotificationPrefs: ...
    def save_prefs(self, prefs: NotificationPrefs) -> None: ...
    def add_subscription(self, sub: PushSubscription) -> None: ...
    def remove_subscription(self, user_id: str, endpoint: str) -> bool: ...
    def subscriptions(self, user_id: str) -> list[PushSubscription]: ...
    def add_notification(self, n: Notification) -> None: ...
    def update_notification(self, n: Notification) -> None: ...
    def notifications(self, user_id: str, limit: int = 50) -> list[Notification]: ...
    def get_notification(self, notification_id: str) -> Notification | None: ...
    def count_since(self, user_id: str, since: datetime) -> int: ...
    def has_dedupe(self, user_id: str, dedupe_key: str) -> bool: ...
    def save_scan_run(self, run: ScanRun) -> None: ...
    def last_scan_run(self, user_id: str) -> ScanRun | None: ...
    def save_pick(self, pick: SavedPick) -> None: ...
    def remove_pick(self, user_id: str, recommendation_id: str) -> bool: ...
    def picks(self, user_id: str) -> list[SavedPick]: ...
    def user_ids(self) -> list[str]: ...


class MemoryNotifyStore:
    def __init__(self) -> None:
        self.prefs: dict[str, NotificationPrefs] = {}
        self.subs: dict[tuple[str, str], PushSubscription] = {}
        self.items: dict[str, Notification] = {}
        self.runs: list[ScanRun] = []
        self.saved: dict[tuple[str, str], SavedPick] = {}

    def get_prefs(self, user_id: str) -> NotificationPrefs:
        return self.prefs.get(user_id) or NotificationPrefs(user_id=user_id)

    def save_prefs(self, prefs: NotificationPrefs) -> None:
        self.prefs[prefs.user_id] = prefs

    def add_subscription(self, sub: PushSubscription) -> None:
        self.subs[(sub.user_id, sub.endpoint)] = sub

    def remove_subscription(self, user_id: str, endpoint: str) -> bool:
        return self.subs.pop((user_id, endpoint), None) is not None

    def subscriptions(self, user_id: str) -> list[PushSubscription]:
        return [s for (u, _), s in self.subs.items() if u == user_id]

    def add_notification(self, n: Notification) -> None:
        self.items[n.id] = n

    def update_notification(self, n: Notification) -> None:
        self.items[n.id] = n

    def notifications(self, user_id: str, limit: int = 50) -> list[Notification]:
        mine = [n for n in self.items.values() if n.user_id == user_id]
        return sorted(mine, key=lambda n: n.created_at, reverse=True)[:limit]

    def get_notification(self, notification_id: str) -> Notification | None:
        return self.items.get(notification_id)

    def count_since(self, user_id: str, since: datetime) -> int:
        return sum(1 for n in self.items.values() if n.user_id == user_id and n.created_at >= since)

    def has_dedupe(self, user_id: str, dedupe_key: str) -> bool:
        return any(n.user_id == user_id and n.dedupe_key == dedupe_key for n in self.items.values())

    def save_scan_run(self, run: ScanRun) -> None:
        self.runs = [r for r in self.runs if r.id != run.id] + [run]

    def last_scan_run(self, user_id: str) -> ScanRun | None:
        done = [r for r in self.runs if r.user_id == user_id and r.finished_at and not r.error]
        return max(done, key=lambda r: r.finished_at, default=None)

    def save_pick(self, pick: SavedPick) -> None:
        self.saved[(pick.user_id, pick.recommendation_id)] = pick

    def remove_pick(self, user_id: str, recommendation_id: str) -> bool:
        return self.saved.pop((user_id, recommendation_id), None) is not None

    def picks(self, user_id: str) -> list[SavedPick]:
        return [p for (u, _), p in self.saved.items() if u == user_id]

    def user_ids(self) -> list[str]:
        ids = set(self.prefs) | {u for u, _ in self.subs} | {u for u, _ in self.saved}
        ids |= {r.user_id for r in self.runs}
        return sorted(ids)


def _row(model: BaseModel, **extra: Any) -> dict:
    return {**model.model_dump(mode="json"), **extra}


class SupabaseNotifyStore(MemoryNotifyStore):
    """Write-through to Supabase; reads prefer Supabase and fall back to memory."""

    def __init__(self, url: str, secret_key: str, client: httpx.Client | None = None) -> None:
        super().__init__()
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"}
        self._client = client or httpx.Client(timeout=5)

    # ---------------------------------------------------------------- plumbing

    def _req(self, method: str, table: str, *, params=None, json=None, prefer=None) -> Any:
        headers = {**self.headers, "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        resp = self._client.request(
            method, f"{self.base}/{table}", params=params, json=json, headers=headers
        )
        resp.raise_for_status()
        return resp.json() if resp.content else None

    def _try(self, what: str, fn, *args, **kwargs) -> Any:
        try:
            return fn(*args, **kwargs)
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("supabase notify store %s failed: %s", what, exc)
            return None

    def _upsert(self, table: str, row: dict, on_conflict: str) -> None:
        self._try(
            f"upsert {table}",
            self._req,
            "POST",
            table,
            params={"on_conflict": on_conflict},
            json=[row],
            prefer="resolution=merge-duplicates,return=minimal",
        )

    def _select(self, table: str, params: dict[str, str]) -> list[dict] | None:
        rows = self._try(f"select {table}", self._req, "GET", table, params=params)
        return rows if isinstance(rows, list) else None

    def _delete(self, table: str, params: dict[str, str]) -> None:
        self._try(f"delete {table}", self._req, "DELETE", table, params=params)

    # ---------------------------------------------------------------- prefs

    def get_prefs(self, user_id: str) -> NotificationPrefs:
        rows = self._select("notification_prefs", {"user_id": f"eq.{user_id}", "limit": "1"})
        if rows:
            try:
                self.prefs[user_id] = NotificationPrefs.model_validate(rows[0])
            except ValueError as exc:
                log.warning("bad notification_prefs row for %s: %s", user_id, exc)
        return super().get_prefs(user_id)

    def save_prefs(self, prefs: NotificationPrefs) -> None:
        super().save_prefs(prefs)
        self._upsert("notification_prefs", _row(prefs), "user_id")

    # ---------------------------------------------------------------- push subscriptions

    def add_subscription(self, sub: PushSubscription) -> None:
        super().add_subscription(sub)
        row = {
            "user_id": sub.user_id,
            "endpoint": sub.endpoint,
            "p256dh": sub.keys.p256dh,
            "auth": sub.keys.auth,
            "created_at": sub.created_at.isoformat(),
        }
        self._upsert("push_subscriptions", row, "user_id,endpoint")

    def remove_subscription(self, user_id: str, endpoint: str) -> bool:
        had = super().remove_subscription(user_id, endpoint)
        self._delete(
            "push_subscriptions", {"user_id": f"eq.{user_id}", "endpoint": f"eq.{endpoint}"}
        )
        return had

    def subscriptions(self, user_id: str) -> list[PushSubscription]:
        rows = self._select("push_subscriptions", {"user_id": f"eq.{user_id}"})
        if rows is None:
            return super().subscriptions(user_id)
        out = []
        for r in rows:
            try:
                out.append(
                    PushSubscription(
                        user_id=r["user_id"],
                        endpoint=r["endpoint"],
                        keys={"p256dh": r["p256dh"], "auth": r["auth"]},
                        created_at=r.get("created_at") or now_utc(),
                    )
                )
            except (KeyError, ValueError) as exc:
                log.warning("bad push_subscriptions row: %s", exc)
        return out

    # ---------------------------------------------------------------- notifications

    @staticmethod
    def _notification_row(n: Notification) -> dict:
        d = n.model_dump(mode="json")
        return {
            "id": d["id"],
            "user_id": d["user_id"],
            "kind": d["kind"],
            "title": d["title"],
            "body": d["body"],
            "recommendation_id": d["recommendation_id"],
            "inputs_hash": d["inputs_hash"],
            "dedupe_key": d["dedupe_key"],
            "scan_run_id": d["scan_run_id"],
            "payload": d,
            "created_at": d["created_at"],
            "read_at": d["read_at"],
            "pushed_at": d["pushed_at"],
        }

    def _from_rows(self, rows: list[dict]) -> list[Notification]:
        out = []
        for r in rows:
            try:
                n = Notification.model_validate(
                    {**r["payload"], "read_at": r.get("read_at"), "pushed_at": r.get("pushed_at")}
                )
            except (KeyError, ValueError) as exc:
                log.warning("bad notifications row: %s", exc)
                continue
            self.items[n.id] = n
            out.append(n)
        return out

    def add_notification(self, n: Notification) -> None:
        super().add_notification(n)
        self._upsert("notifications", self._notification_row(n), "id")

    def update_notification(self, n: Notification) -> None:
        super().update_notification(n)
        self._upsert("notifications", self._notification_row(n), "id")

    def notifications(self, user_id: str, limit: int = 50) -> list[Notification]:
        rows = self._select(
            "notifications",
            {"user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": str(limit)},
        )
        return super().notifications(user_id, limit) if rows is None else self._from_rows(rows)

    def get_notification(self, notification_id: str) -> Notification | None:
        rows = self._select("notifications", {"id": f"eq.{notification_id}", "limit": "1"})
        found = self._from_rows(rows) if rows else []
        return found[0] if found else super().get_notification(notification_id)

    def count_since(self, user_id: str, since: datetime) -> int:
        rows = self._select(
            "notifications",
            {"user_id": f"eq.{user_id}", "created_at": f"gte.{since.isoformat()}", "select": "id"},
        )
        return super().count_since(user_id, since) if rows is None else len(rows)

    def has_dedupe(self, user_id: str, dedupe_key: str) -> bool:
        rows = self._select(
            "notifications",
            {"user_id": f"eq.{user_id}", "dedupe_key": f"eq.{dedupe_key}", "select": "id"},
        )
        return super().has_dedupe(user_id, dedupe_key) if rows is None else bool(rows)

    # ---------------------------------------------------------------- scan runs

    def save_scan_run(self, run: ScanRun) -> None:
        super().save_scan_run(run)
        d = run.model_dump(mode="json")
        row = {
            "id": d["id"],
            "user_id": d["user_id"],
            "mode": d["mode"],
            "workflow_id": d["workflow_id"],
            "top_id": d["top_id"],
            "inputs_hash": d["inputs_hash"],
            "payload": d,
            "started_at": d["started_at"],
            "finished_at": d["finished_at"],
            "error": d["error"],
        }
        self._upsert("scan_runs", row, "id")

    def last_scan_run(self, user_id: str) -> ScanRun | None:
        rows = self._select(
            "scan_runs",
            {
                "user_id": f"eq.{user_id}",
                "finished_at": "not.is.null",
                "error": "is.null",
                "order": "finished_at.desc",
                "limit": "1",
            },
        )
        if rows:
            try:
                return ScanRun.model_validate(rows[0]["payload"])
            except (KeyError, ValueError) as exc:
                log.warning("bad scan_runs row: %s", exc)
        return super().last_scan_run(user_id)

    # ---------------------------------------------------------------- watched picks

    def save_pick(self, pick: SavedPick) -> None:
        super().save_pick(pick)
        self._upsert("saved_picks", _row(pick), "user_id,recommendation_id")

    def remove_pick(self, user_id: str, recommendation_id: str) -> bool:
        had = super().remove_pick(user_id, recommendation_id)
        self._delete(
            "saved_picks",
            {"user_id": f"eq.{user_id}", "recommendation_id": f"eq.{recommendation_id}"},
        )
        return had

    def picks(self, user_id: str) -> list[SavedPick]:
        rows = self._select("saved_picks", {"user_id": f"eq.{user_id}"})
        if rows is None:
            return super().picks(user_id)
        out = []
        for r in rows:
            try:
                out.append(SavedPick.model_validate(r))
            except ValueError as exc:
                log.warning("bad saved_picks row: %s", exc)
        return out

    def user_ids(self) -> list[str]:
        """Users the daily scan visits: anyone who set prefs, subscribed, watches a pick or ran a scan."""
        ids = set(super().user_ids())
        for table in ("notification_prefs", "push_subscriptions", "saved_picks", "scan_runs"):
            rows = self._select(table, {"select": "user_id"}) or []
            ids |= {r["user_id"] for r in rows if r.get("user_id")}
        return sorted(ids)


def notify_store_from_env() -> NotifyStore:
    """Supabase when SUPABASE_URL + SUPABASE_SECRET_KEY are set (TRIPAI_NOTIFY_STORE=memory
    forces memory), else in-memory."""
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if url and key and os.environ.get("TRIPAI_NOTIFY_STORE", "").lower() != "memory":
        return SupabaseNotifyStore(url, key)
    return MemoryNotifyStore()
