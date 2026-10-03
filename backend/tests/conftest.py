import asyncio
from datetime import date

import pytest

from tripai.models import FreeWindow, TasteProfile
from tripai.scoring import FixtureProvider


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """Tests never hit an LLM, even if the developer has a key exported."""
    for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TRIPAI_MODEL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("TRIPAI_LLM", "0")


@pytest.fixture
def profile() -> TasteProfile:
    return TasteProfile(user_id="u1", budget_pln=2500, interests={"food": 0.9, "history": 0.7})


@pytest.fixture
def windows() -> list[FreeWindow]:
    return [
        FreeWindow(start=date(2026, 11, 7), end=date(2026, 11, 11)),
        FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19)),
        FreeWindow(start=date(2027, 7, 10), end=date(2027, 7, 15)),
    ]


@pytest.fixture
def candidates(windows):
    return asyncio.run(FixtureProvider().candidates("KRK", windows))
