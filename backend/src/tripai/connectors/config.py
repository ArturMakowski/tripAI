"""Environment-driven settings for connectors (read lazily so tests can monkeypatch env)."""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPO_DIR = BACKEND_DIR.parent

_TRUTHY = {"1", "true", "yes", "on"}


def env(name: str) -> str | None:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else None


def flag(name: str) -> bool:
    return (env(name) or "").lower() in _TRUTHY


def use_fixtures() -> bool:
    """TRIPAI_USE_FIXTURES=1 → every connector serves recorded fixtures, no network."""
    return flag("TRIPAI_USE_FIXTURES")


def record_fixtures() -> bool:
    """TRIPAI_RECORD_FIXTURES=1 → every live response is also written as a fixture."""
    return flag("TRIPAI_RECORD_FIXTURES")


def fixtures_dir() -> Path:
    return Path(env("TRIPAI_FIXTURES_DIR") or BACKEND_DIR / "tests" / "fixtures")


def cache_dir() -> Path:
    return Path(env("TRIPAI_CACHE_DIR") or BACKEND_DIR / ".cache" / "api")


def cache_disabled() -> bool:
    return flag("TRIPAI_NO_CACHE")


def load_dotenv_files() -> None:
    """Load repo-root and backend .env files (no-op for missing files; env vars win)."""
    from dotenv import load_dotenv

    for path in (REPO_DIR / ".env", BACKEND_DIR / ".env"):
        if path.exists():
            load_dotenv(path, override=False)
