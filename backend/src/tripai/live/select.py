"""Pick the data provider and the store from env (used by `tripai.main`)."""

import logging

from tripai.api.state import MemoryStore, Store
from tripai.api.supabase_store import SupabaseStore
from tripai.connectors import config
from tripai.live import sources
from tripai.scoring.provider import (
    CalendarProvider,
    FixtureCalendar,
    FixtureProvider,
    TripDataProvider,
)

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


def calendar_from_env() -> CalendarProvider:
    """Live Google Calendar free/busy when the live provider runs and gcal is not on fixtures
    (OAuth client + token present, not listed in TRIPAI_FIXTURE_SOURCES); else the demo calendar."""
    if provider_name() == "live" and sources.mode("gcal") == "live":
        from tripai.live.calendar import GCalCalendar

        return GCalCalendar()
    return FixtureCalendar()
