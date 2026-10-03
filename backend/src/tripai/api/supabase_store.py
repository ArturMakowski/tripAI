"""Supabase-backed `Store` (PostgREST + server-side SUPABASE_SECRET_KEY; tables in
supabase/migrations/0001_init.sql). Memory is the primary copy: reads hit memory first and fall
back to Supabase, writes go to memory immediately and to Supabase on one background thread
(order preserved, so the `profiles` row exists before rows that reference it). Any Supabase
error is logged and ignored, so persistence can never break a request."""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

import httpx

from tripai.api.state import MemoryStore
from tripai.models import TasteProfile, Weights
from tripai.scoring.types import RankedRecommendation

log = logging.getLogger(__name__)


class SupabaseStore(MemoryStore):
    def __init__(
        self,
        url: str,
        secret_key: str,
        client: httpx.Client | None = None,
        background: bool = True,
    ) -> None:
        super().__init__()
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"}
        self._client = client or httpx.Client(timeout=5)
        self._pool = (
            ThreadPoolExecutor(1, thread_name_prefix="supabase-store") if background else None
        )

    # ---------------------------------------------------------------- plumbing

    def _write(self, fn, *args: Any) -> None:
        if self._pool is None:
            self._safe(fn, *args)
        else:
            self._pool.submit(self._safe, fn, *args)

    @staticmethod
    def _safe(fn, *args: Any) -> None:
        try:
            fn(*args)
        except Exception as exc:  # noqa: BLE001 - persistence is best effort
            log.warning("supabase store write failed: %s", exc)

    def flush(self) -> None:
        """Wait for queued writes (tests, shutdown)."""
        if self._pool is not None:
            self._pool.submit(lambda: None).result()

    def _upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        resp = self._client.post(
            f"{self.base}/{table}",
            params={"on_conflict": on_conflict},
            headers={
                **self.headers,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json=rows,
        )
        resp.raise_for_status()

    def _insert(self, table: str, row: dict) -> None:
        resp = self._client.post(
            f"{self.base}/{table}",
            headers={
                **self.headers,
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=row,
        )
        resp.raise_for_status()

    def _patch(self, table: str, match: dict[str, str], row: dict) -> None:
        resp = self._client.patch(
            f"{self.base}/{table}",
            params={k: f"eq.{v}" for k, v in match.items()},
            headers={
                **self.headers,
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=row,
        )
        resp.raise_for_status()

    def _select(self, table: str, params: dict[str, str]) -> list[dict]:
        try:
            resp = self._client.get(f"{self.base}/{table}", params=params, headers=self.headers)
            resp.raise_for_status()
            rows = resp.json()
            return rows if isinstance(rows, list) else []
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("supabase store read failed: %s", exc)
            return []

    def _load_profile_row(self, user_id: str) -> None:
        rows = self._select(
            "profiles", {"user_id": f"eq.{user_id}", "select": "profile,weights", "limit": "1"}
        )
        if not rows:
            return
        try:
            self.profiles[user_id] = TasteProfile.model_validate(rows[0]["profile"])
            if rows[0].get("weights"):
                self.weights[user_id] = Weights.model_validate(rows[0]["weights"])
        except (ValueError, KeyError) as exc:
            log.warning("supabase profile row for %s unreadable: %s", user_id, exc)

    # ---------------------------------------------------------------- Store

    def get_profile(self, user_id: str) -> TasteProfile | None:
        if user_id not in self.profiles:
            self._load_profile_row(user_id)
        return super().get_profile(user_id)

    def save_profile(self, profile: TasteProfile) -> None:
        super().save_profile(profile)
        row = {
            "user_id": profile.user_id,
            "profile": profile.model_dump(mode="json"),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self._write(self._upsert, "profiles", [row], "user_id")

    def get_weights(self, user_id: str) -> Weights | None:
        if user_id not in self.weights and user_id not in self.profiles:
            self._load_profile_row(user_id)
        return super().get_weights(user_id)

    def save_weights(self, user_id: str, weights: Weights) -> None:
        super().save_weights(user_id, weights)
        w = weights.model_dump(mode="json")
        profile = self.profiles.get(user_id)
        if profile is not None:
            row = {"user_id": user_id, "profile": profile.model_dump(mode="json"), "weights": w}
            self._write(self._upsert, "profiles", [row], "user_id")
        else:  # no profile row to attach to (profiles.profile is NOT NULL): update if it exists
            self._write(self._patch, "profiles", {"user_id": user_id}, {"weights": w})

    def save_recommendations(self, user_id: str, recs: list[RankedRecommendation]) -> None:
        super().save_recommendations(user_id, recs)
        rows = [
            {
                "id": r.id,
                "user_id": user_id,
                "inputs_hash": r.inputs_hash,
                "rank": r.rank,
                "payload": r.model_dump(mode="json"),
            }
            for r in recs
        ]
        if rows:
            self._write(self._upsert, "recommendations", rows, "user_id,inputs_hash,id")

    def get_recommendation(self, rec_id: str) -> RankedRecommendation | None:
        hit = super().get_recommendation(rec_id)
        if hit is not None:
            return hit
        rows = self._select(
            "recommendations",
            {"id": f"eq.{rec_id}", "select": "payload", "order": "created_at.desc", "limit": "1"},
        )
        if not rows:
            return None
        try:
            rec = RankedRecommendation.model_validate(rows[0]["payload"])
        except (ValueError, KeyError) as exc:
            log.warning("supabase recommendation %s unreadable: %s", rec_id, exc)
            return None
        self.recs[rec.id] = rec
        return rec

    def save_feedback(self, user_id: str, trip_id: str, answers: dict, diff: list) -> None:
        super().save_feedback(user_id, trip_id, answers, diff)
        row = {
            "user_id": user_id,
            "trip_id": trip_id,
            "answers": answers,
            "diff": [d.model_dump(mode="json") if hasattr(d, "model_dump") else d for d in diff],
        }
        self._write(self._insert, "feedback", row)
