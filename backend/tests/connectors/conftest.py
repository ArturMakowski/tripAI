import pytest

from tripai.connectors.cache import DiskCache


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch, tmp_path):
    """No real keys, no shared cache, no accidental fixture recording."""
    for var in (
        "TRIPAI_USE_FIXTURES",
        "TRIPAI_RECORD_FIXTURES",
        "TRIPAI_FIXTURES_DIR",
        "SUPABASE_URL",
        "SUPABASE_KEY",
        "SUPABASE_SECRET_KEY",
        "SERPAPI_API_KEY",
        "SERPER_API_KEY",
        "TRAVELPAYOUTS_TOKEN",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TRIPAI_GCAL_TOKEN", str(tmp_path / "gcal_token.json"))


@pytest.fixture
def disk_cache(tmp_path):
    return DiskCache(tmp_path / "cache")


@pytest.fixture
def fixtures_mode(monkeypatch):
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "1")
