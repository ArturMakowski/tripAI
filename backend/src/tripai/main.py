"""Entrypoint: `uv run uvicorn tripai.main:app --reload` (from backend/)."""

from dotenv import load_dotenv

from tripai.api import create_app

load_dotenv()  # env is read lazily (per request), so loading after import is fine
app = create_app()
