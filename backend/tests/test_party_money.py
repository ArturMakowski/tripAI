"""Party money model (docs/BUDGET.md "Party pricing"), as properties over party sizes 1..12:

    flight_cost_pln  = per traveller
    hotel_cost_pln   = TOTAL for the room(s) for the stay (rooms default ceil(n / 2))
    party_total_pln  = flight_cost_pln x travellers + hotel_cost_pln
    per_person_pln   = party_total_pln / travellers == total_cost_pln
Regression: Palma, 2 adults, flight 428 + hotel 964 must be 1,820 for the group (910 pp), not
2,784 (the hotel counted twice)."""

import asyncio
import math
from datetime import date

import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.live import LiveProvider
from tripai.models import FreeWindow, TasteProfile
from tripai.notify.rules import cost_line
from tripai.scoring import FixtureProvider, rank
from tripai.scoring.engine import shown_party_total, shown_total
from tripai.scoring.types import Candidate

WINDOWS = [
    {"start": "2027-01-14", "end": "2027-01-19"},
    {"start": "2026-11-07", "end": "2026-11-11"},
]
PARTIES = sorted({(n, 0) for n in range(1, 13)} | {(1, n - 1) for n in range(2, 13)}
                 | {(math.ceil(n / 2), n // 2) for n in range(1, 13)})  # fmt: skip


def check(r: dict | object, n: int, room_hotel: dict[str, float] | None = None, rooms: int = 0):
    g = r if isinstance(r, dict) else r.model_dump()
    assert g["travelers"] == n
    assert g["party_total_pln"] == g["flight_cost_pln"] * n + g["hotel_cost_pln"]
    assert g["per_person_pln"] * n == pytest.approx(g["party_total_pln"], abs=1e-6)
    assert g["total_cost_pln"] == g["per_person_pln"]
    if room_hotel is not None:  # the hotel is the solo (one-room) price x rooms
        assert g["hotel_cost_pln"] == pytest.approx(room_hotel[g["id"]] * rooms, abs=1)


@pytest.fixture(scope="module")
def solo_hotels() -> dict[str, float]:
    c = TestClient(create_app())
    recs = c.post("/recommendations", json={"profile": {"user_id": "s"}, "windows": WINDOWS,
                                            "limit": 50, "explain_top": 0}).json()  # fmt: skip
    return {r["id"]: r["hotel_cost_pln"] for r in recs}


@pytest.mark.parametrize("adults,children", PARTIES)
def test_api_money_properties(adults, children, solo_hotels):
    n = adults + children
    c = TestClient(create_app())
    body = {"profile": {"user_id": "x", "adults": adults, "children": children},
            "windows": WINDOWS, "limit": 50, "explain_top": 0}  # fmt: skip
    recs = c.post("/recommendations", json=body).json()
    assert recs
    for r in recs:
        check(r, n, solo_hotels, math.ceil(n / 2))


@pytest.mark.parametrize("n,rooms", [(1, 1), (2, 2), (3, 1), (4, 4), (5, 3), (12, 6), (7, 7)])
def test_explicit_rooms(n, rooms, solo_hotels):
    c = TestClient(create_app())
    body = {"profile": {"user_id": "x", "adults": n, "rooms": rooms}, "windows": WINDOWS,
            "limit": 50, "explain_top": 0}  # fmt: skip
    for r in c.post("/recommendations", json=body).json():
        check(r, n, solo_hotels, rooms)


@pytest.mark.parametrize("n", range(1, 13))
def test_candidate_and_rank_properties(n):
    """Odd per-person splits (e.g. / 7) stay exact: per_person x n == party_total."""
    c = Candidate(city="X", country="Y", iata="XXX",
                  window=FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19)),
                  flight_cost_pln=428.4, hotel_cost_pln=964.6 * math.ceil(n / 2), travelers=n,
                  temp_c=20, crowd=0.3, seasonal_median_cost_pln=1500)  # fmt: skip
    assert c.party_total_pln == pytest.approx(428.4 * n + 964.6 * math.ceil(n / 2))
    assert c.total_cost_pln * n == pytest.approx(c.party_total_pln)
    assert shown_party_total(c) == 428 * n + round(964.6 * math.ceil(n / 2))
    assert shown_total(c) * n == pytest.approx(shown_party_total(c))
    (r,) = rank([c], TasteProfile(user_id="u", adults=n))
    check(r, n)


def test_palma_regression():
    """The reported bug: 2 adults, flight 428 + hotel 964 (one double room)."""
    c = Candidate(city="Palma", country="Spain", iata="PMI",
                  window=FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19)),
                  flight_cost_pln=428, hotel_cost_pln=964, travelers=2, temp_c=18, crowd=0.2,
                  seasonal_median_cost_pln=1000)  # fmt: skip
    (r,) = rank([c], TasteProfile(user_id="u", adults=2))
    assert (r.flight_cost_pln, r.hotel_cost_pln) == (428, 964)
    assert r.party_total_pln == 428 * 2 + 964 == 1820  # was 2,784: hotel counted twice
    assert r.per_person_pln == r.total_cost_pln == 910
    line = cost_line(r)
    assert "910" in line and "1820" in line.replace(" ", "").replace(" ", "")


@pytest.mark.parametrize("adults,children", [(1, 0), (2, 0), (2, 1), (3, 2)])
def test_live_provider_money_properties(adults, children):
    n = adults + children
    p = LiveProvider(fixtures=True, today=date(2026, 10, 3), use_fallback=False, top_n=2,
                     max_refine=2,
                     city_ids=["rome", "lisbon", "barcelona", "vienna", "prague", "porto"])  # fmt: skip
    prof = TasteProfile(user_id="u", adults=adults, children=children)
    w = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
    cands = asyncio.run(p.candidates("KRK", w, profile=prof))
    assert any(c.hotel is not None for c in cands)  # a refined (Google Hotels) card is included
    for c in cands:
        assert c.travelers == n
        if c.hotel is not None:  # shown property = priced: its group price is the hotel line
            assert c.hotel.price_pln_total == c.hotel_cost_pln
    for r in rank(cands, prof, limit=10):
        check(r, n)


def test_why_text_and_push_text_use_the_party_numbers():
    from tripai.agents.explain import template_why

    prof = TasteProfile(user_id="u", adults=3)
    w = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
    (r,) = rank(asyncio.run(FixtureProvider().candidates("KRK", w, profile=prof)), prof, limit=1)
    flat = lambda s: s.replace(" ", "").replace(" ", "")
    why, push = flat(template_why(r, lang="en")), flat(cost_line(r))
    for text in (why, push):
        assert str(round(r.party_total_pln)) in text and f"3×{round(r.flight_cost_pln)}" in text
        assert str(round(r.hotel_cost_pln)) in text
