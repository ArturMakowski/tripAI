"""Pick the data provider and the store from env (used by `tripai.main`)."""

import logging

from tripai.api.state import MemoryStore, Store
from tripai.api.supabase_store import SupabaseStore
from tripai.connectors import config
from tripai.scoring.provider import FixtureProvider, TripDataProvider

log = logging.getLogger(__name__)


def provider_name() -> str:
    """TRIPAI_PROVIDER=live|fixture wins; otherwise fixture when TRIPAI_USE_FIXTURES=1, else live."""
    explicit = (config.env("TRIPAI_PROVIDER") or "").lower()
    if explicit in {"live", "fixture"}:
        return explicit
    if explicit:
        log.warning("unknown TRIPAI_PROVIDER=%r, using the default", explicit)
    return "fixture" if config.use_fixtures() else "live"


def provider_from_env() -> TripDataProvider:
    if provider_name() == "fixture":
        return FixtureProvider()
    from tripai.live.provider import LiveProvider

    return LiveProvider()


def store_from_env() -> Store:
    """Supabase (server-side secret key) when configured, else in-memory. TRIPAI_STORE=memory forces
    the in-memory store."""
    url, key = config.env("SUPABASE_URL"), config.env("SUPABASE_SECRET_KEY")
    if (config.env("TRIPAI_STORE") or "").lower() != "memory" and url and key:
        return SupabaseStore(url, key)
    return MemoryStore()
