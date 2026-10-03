"""Entrypoint: `uv run uvicorn tripai.main:app --reload` (from backend/).

TRIPAI_PROVIDER=live|fixture picks the data provider (default: fixture when TRIPAI_USE_FIXTURES=1,
else live); SUPABASE_URL + SUPABASE_SECRET_KEY switch the store to Supabase."""

from dotenv import load_dotenv

from tripai.api import create_app
from tripai.live import provider_from_env, store_from_env

load_dotenv()  # before the provider/store are chosen; connectors read env lazily per request
app = create_app(provider=provider_from_env(), store=store_from_env())
