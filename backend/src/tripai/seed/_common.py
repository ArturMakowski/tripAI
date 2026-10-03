"""Shared helpers for seed scripts: data dir, JSON writing with provenance metadata, HTTP client."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

USER_AGENT = "TripAI-seed/0.1 (HackYeah 2026; https://github.com/ArturMakowski/tripAI)"


def data_dir() -> Path:
    """Repo-level `data/` (override with TRIPAI_DATA_DIR)."""
    if env := os.environ.get("TRIPAI_DATA_DIR"):
        return Path(env)
    return Path(__file__).resolve().parents[4] / "data"


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def meta(source: str, *, generator: str, notes: str | None = None, **extra: Any) -> dict[str, Any]:
    m: dict[str, Any] = {
        "source": source,
        "fetched_at": now_iso(),
        "generator": f"uv run python -m {generator}",
    }
    if notes:
        m["notes"] = notes
    m.update(extra)
    return m


def write_json(name: str, payload: dict[str, Any]) -> Path:
    path = data_dir() / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def read_json(name: str) -> dict[str, Any]:
    return json.loads((data_dir() / name).read_text(encoding="utf-8"))


def client(timeout: float = 60.0) -> httpx.Client:
    return httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
