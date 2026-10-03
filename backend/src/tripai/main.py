"""Entrypoint: `uv run uvicorn tripai.main:app --reload` (from backend/).

TRIPAI_PROVIDER=live|fixture picks the data provider (default: fixture when TRIPAI_USE_FIXTURES=1,
else live); TRIPAI_FIXTURE_SOURCES=travelpayouts,gcal,... pins single sources to fixtures (sources
without credentials use fixtures automatically); SUPABASE_URL + SUPABASE_SECRET_KEY switch the store to Supabase."""

from dotenv import load_dotenv

from tripai.api import create_app
from tripai.api.notify import enable_durable_scans
from tripai.live import calendar_from_env, provider_from_env, store_from_env
from tripai.notify.store import notify_store_from_env

load_dotenv()  # before the provider/store are chosen; connectors read env lazily per request
app = create_app(
    provider=provider_from_env(),
    calendar=calendar_from_env(),
    store=store_from_env(),
    notify_store=notify_store_from_env(),
)
enable_durable_scans(app, app.state.scan_deps)  # DBOS when DATABASE_URL is set
