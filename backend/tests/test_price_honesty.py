"""docs/BUDGET.md "Price honesty" + "Party pricing". Regression: the tester's Nice 11-15 Nov card
showed 358 PLN (a Wizz fare for 22-29 Nov from Google Travel Explore) + 1,292 PLN (city-average
hotel, 323/night) as the trip price. Real for 11-15 Nov: flights from 588 PLN (Wizz nonstop
826 PLN), hotels 829 PLN (ibis budget) to 1,131 PLN (Ikonik) for 4 nights. Offline: connectors
stubbed with those numbers; SerpApi flights unavailable (cap used: fixtures have no Nice)."""

import asyncio
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.connectors.serpapi import (
    ExploreDestination,
    ExploreResult,
    HotelOffer,
    HotelSearchResult,
    SerpApiExplore,
    SerpApiHotels,
)
from tripai.connectors.travelpayouts import FareQuote, FlightCalendar, Travelpayouts
from tripai.live import LiveProvider
from tripai.models import FreeWindow, TasteProfile
from tripai.scoring import FixtureProvider, rank
from tripai.scoring.budget_fit import rank_within_budget
from tripai.scoring.engine import NEUTRAL_PRICE_SCORE

NOW = datetime(2026, 10, 3, 12, tzinfo=UTC)
NICE = [FreeWindow(start=date(2026, 11, 11), end=date(2026, 11, 15))]


def _fare(dep: str, ret: str, price: float, airline: str, transfers: int) -> FareQuote:
    return FareQuote(origin="KRK", destination="NCE", price=price, airline=airline,
                     origin_airport="KRK", destination_airport="NCE",
                     departure_at=datetime.fromisoformat(f"{dep}T06:00:00+01:00"),
                     return_at=datetime.fromisoformat(f"{ret}T20:00:00+01:00"),
                     transfers=transfers, return_transfers=transfers)  # fmt: skip


def _cal(fares: list[FareQuote], endpoint: str) -> FlightCalendar:
    return FlightCalendar(source=f"travelpayouts:{endpoint}", fetched_at=NOW, origin="KRK",
                          destination="NCE", currency="PLN", query={}, fares=fares)  # fmt: skip


@pytest.fixture
def nice(monkeypatch, tmp_path):
    for var in ("SERPAPI_API_KEY", "TRAVELPAYOUTS_TOKEN", "SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))

    async def explore(self, origin="KRK", **kw):  # Google Travel Explore: cheapest *other* dates
        dest = ExploreDestination(name="Nice", iata="NCE", start_date=date(2026, 11, 22),
                                  end_date=date(2026, 11, 29), flight_price=358, hotel_price=323,
                                  airline="Wizz Air", stops=0)  # fmt: skip
        return ExploreResult(source="serpapi:google_travel_explore", fetched_at=NOW,
                             origin=origin, currency="PLN", destinations=[dest])  # fmt: skip

    async def month_calendar(self, origin, dest, month, **kw):  # only the 22-29 Nov fare cached
        fares = [_fare("2026-11-22", "2026-11-29", 358, "W6", 0)] if month == "2026-11" else []
        return _cal(fares, "grouped_prices")

    async def prices_for_dates(self, origin, dest, departure, return_=None, **kw):
        assert (departure, return_) == (date(2026, 11, 11), date(2026, 11, 15))
        return _cal([_fare("2026-11-11", "2026-11-15", 826, "W6", 0),
                     _fare("2026-11-11", "2026-11-15", 588, "LO", 1)], "prices_for_dates")  # fmt: skip

    monkeypatch.setattr(SerpApiExplore, "explore", explore)
    monkeypatch.setattr(Travelpayouts, "month_calendar", month_calendar)
    monkeypatch.setattr(Travelpayouts, "prices_for_dates", prices_for_dates)


def provider(**kw) -> LiveProvider:
    return LiveProvider(fixtures=True, today=date(2026, 10, 3), city_ids=["nice"],
                        use_fallback=False, **kw)  # fmt: skip


def card(prof: TasteProfile, **kw):
    p = provider(**kw)
    (c,) = asyncio.run(p.candidates("KRK", NICE, profile=prof))
    return c


def test_nice_other_dates_prices_are_never_the_trip_price(nice):
    prof = TasteProfile(user_id="u", interests={"food": 0.9})
    c = card(prof)
    assert c.flight_cost_pln == 588  # exact-date fare, not Explore's 358 for 22-29 Nov
    flight = next(e for e in c.evidence if e.kind == "flight")
    assert flight.value == 588 and "your dates" in flight.label and "LO" in flight.label
    assert not any(e.kind == "flight" and e.value == 358 for e in c.evidence)
    # no exact-date hotel (SerpApi unavailable): the 323/night city average stays a labelled
    # estimate -> the card is only "partial", and its price doesn't count
    assert c.hotel_cost_pln == 1292 and c.price_status == "partial"
    hotel = next(e for e in c.evidence if e.kind == "hotel")
    assert "not your exact dates" in hotel.label
    (r,) = rank([c], prof)
    assert r.price_status == "partial" and r.score.price == NEUTRAL_PRICE_SCORE


def test_nice_with_exact_hotel_prices_is_exact(nice, monkeypatch):
    async def search(self, city, check_in, check_out, **kw):  # Google Hotels, exact dates
        offers = [HotelOffer(name="ibis budget Nice", price_per_night=829 / 4, total_price=829),
                  HotelOffer(name="Ikonik Hotel", price_per_night=1131 / 4, total_price=1131)]  # fmt: skip
        return HotelSearchResult(source="serpapi:google_hotels", fetched_at=NOW, city=city,
                                 check_in=check_in, check_out=check_out, adults=2,
                                 currency="PLN", offers=offers)  # fmt: skip

    monkeypatch.setattr(SerpApiHotels, "search", search)
    c = card(TasteProfile(user_id="u"), top_n=1)
    # the real property at the standard quantile (nearest rank of two: the cheaper one)
    assert (c.flight_cost_pln, c.hotel_cost_pln, c.price_status) == (588, 829, "exact")
    assert c.hotel.name == "ibis budget Nice" and c.hotel.price_pln_total == 829
    # shown = priced: the itinerary behind the exact-date Aviasales fare
    assert c.flight.price_pln == 588 and c.flight.outbound[0].airline == "LO"
    assert c.flight.outbound[0].to_iata == "NCE"
    duo = card(TasteProfile(user_id="u", adults=2), top_n=1)  # one double room for two
    assert duo.hotel_cost_pln == duo.hotel.price_pln_total == 829  # the room, not per person
    assert duo.party_total_pln == 588 * 2 + 829 and duo.total_cost_pln == (588 * 2 + 829) / 2


def test_without_an_exact_fare_the_price_is_an_estimate(nice, monkeypatch):
    async def none_for_these_dates(self, *a, **kw):
        return _cal([], "prices_for_dates")

    monkeypatch.setattr(Travelpayouts, "prices_for_dates", none_for_these_dates)
    c = card(TasteProfile(user_id="u"))
    assert c.price_status == "estimate"  # 358 (other dates) + 1,292 (city average)
    (r,) = rank([c], TasteProfile(user_id="u"))
    assert r.score.price == NEUTRAL_PRICE_SCORE  # rewards nothing, punishes nothing


def test_estimates_get_no_budget_status_and_rank_after_exact_fits(nice):
    prof = TasteProfile(user_id="u", budget_pln=3000)
    nice_c = card(prof)
    exact = asyncio.run(FixtureProvider().candidates("KRK", NICE, profile=prof))  # 10 cities
    out = rank_within_budget([nice_c, *exact], prof, None, limit=20)
    statuses = [(r.city, r.price_status, s.status if s else None) for r, s in out]
    first_unsure = next(i for i, (_, ps, _) in enumerate(statuses) if ps != "exact")
    assert all(ps == "exact" for _, ps, _ in statuses[:first_unsure])
    assert all(ps != "exact" for _, ps, _ in statuses[first_unsure:])  # never above exact fits
    assert ("Nice", "partial", None) in statuses  # no "within budget" claim on a guessed price
    over = TasteProfile(user_id="u", budget_pln=1500)  # 588 + 1292 = 1880 > 1650: not offered
    assert "Nice" not in [r.city for r, _ in rank_within_budget([nice_c], over, None)]


def test_party_pricing_flights_per_traveller_hotel_per_room(nice):
    solo = card(TasteProfile(user_id="u"))
    duo = card(TasteProfile(user_id="u", adults=2))  # 2 people share 1 room
    trio = card(TasteProfile(user_id="u", adults=2, children=1))  # 3 people, 2 rooms
    assert solo.flight_cost_pln == duo.flight_cost_pln == trio.flight_cost_pln == 588
    assert duo.hotel_cost_pln == 1292  # one room for the stay
    assert trio.hotel_cost_pln == 1292 * 2  # two rooms
    assert trio.total_cost_pln == pytest.approx((588 * 3 + 1292 * 2) / 3)  # per person
    party = next(e for e in trio.evidence if e.kind == "party")
    assert party.value == (588 * 3 + 1292 * 2)
    assert not any(e.kind == "party" for e in solo.evidence)


def test_api_party_fields(nice):
    c = TestClient(create_app(provider=provider()))
    body = {"profile": {"user_id": "x", "adults": 2, "rooms": 1},
            "windows": [w.model_dump(mode="json") for w in NICE]}  # fmt: skip
    (r,) = c.post("/recommendations", json=body).json()
    assert r["travelers"] == 2 and r["per_person_pln"] == r["total_cost_pln"] == 588 + 646
    assert r["party_total_pln"] == 2 * r["total_cost_pln"]
    assert r["price_status"] == "partial" and r["budget"] is None


def test_fixture_provider_party_share():
    w = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
    solo = asyncio.run(FixtureProvider().candidates("KRK", w, profile=TasteProfile(user_id="u")))
    duo = asyncio.run(FixtureProvider().candidates("KRK", w,
                                                   profile=TasteProfile(user_id="u", adults=2)))  # fmt: skip
    assert all(d.hotel_cost_pln == s.hotel_cost_pln for s, d in zip(solo, duo))  # same room
    assert all(d.flight_cost_pln == s.flight_cost_pln for s, d in zip(solo, duo))
    assert all(d.total_cost_pln == pytest.approx(d.flight_cost_pln + d.hotel_cost_pln / 2)
               for d in duo)  # fmt: skip


# ---------------------------------------------------------------- review fixes (#29)


def _sample(prof: TasteProfile, status: str | None = None, iatas: set[str] | None = None):
    w = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
    out = asyncio.run(FixtureProvider().candidates("KRK", w, profile=prof))
    out = [c for c in out if iatas is None or c.iata in iatas]
    return [c.model_copy(update={"price_status": status}) for c in out] if status else out


def test_price_drop_needs_an_exact_price():
    """Review #1: a watched pick re-priced from other dates must not alert or move the baseline."""
    from tripai.workflows.scan import build_drafts

    prof = TasteProfile(user_id="u")
    (est,) = rank(_sample(prof, "estimate", {"NAP"}), prof)
    (exact,) = rank(_sample(prof, None, {"NAP"}), prof)
    baseline = est.total_cost_pln * 1.5  # a "-33%" drop if the estimate were believed
    ctx = {"last_run": None,
           "picks": [{"recommendation_id": est.id, "baseline_pln": baseline}]}  # fmt: skip
    empty = ({"recs": []}, {"best": []})
    drafts, decisions = build_drafts(ctx, empty[0], empty[1],
                                     {"recs": {est.id: est.model_dump(mode="json")}}, [])  # fmt: skip
    assert drafts == []  # no draft -> no push, and finalize() never updates the baseline
    (d,) = [x for x in decisions if x.kind == "price_drop"]
    assert not d.notify and "estimate" in d.reason
    drafts, _ = build_drafts(ctx, empty[0], empty[1],
                             {"recs": {exact.id: exact.model_dump(mode="json")}}, [])  # fmt: skip
    assert [x.kind for x in drafts] == ["price_drop"]  # a real exact drop still alerts


def test_without_a_budget_estimates_never_outrank_exact_prices():
    """Review #2 (no budget, the default): unknown prices never beat known ones."""
    prof = TasteProfile(user_id="u", interests={"history": 0.9})
    exact = _sample(prof, None, {"NAP", "FCO", "LIS"})
    est = _sample(prof, "estimate", {"ATH", "MLA", "BCN"})
    out = rank_within_budget([*est, *exact], prof, None)
    statuses = [r.price_status for r, _ in out]
    assert statuses == ["exact"] * 3 + ["estimate"] * 3
    assert all(s is None for _, s in out)  # no budget -> no budget status
    assert all(r.flip is None for r, _ in out if r.price_status != "exact")
    # and an unknown price is never scored better than neutral, while a high one still counts
    (r,) = rank(_sample(prof, "estimate", {"CPH"}), prof)
    assert r.score.price <= NEUTRAL_PRICE_SCORE


def test_partial_cards_are_not_pushed():
    """Review #4: a push quotes a total, so it needs both legs for these dates."""
    from tripai.workflows.scan import _fitting

    prof = TasteProfile(user_id="u")
    partial = [c for c in _sample(prof, "partial") if c.iata != "NAP"]
    cands = partial + _sample(prof, None, {"NAP"})
    picks = _fitting(cands, prof, None, 10)
    assert [r.iata for r in picks] == ["NAP"]


def test_refinement_targets_are_status_blind():
    """Review #5: refining a card mustn't lock it into the top N. Once its exact price came
    back high, the loop keeps verifying the next best unverified option."""
    p = LiveProvider(fixtures=True, today=date(2026, 10, 3), use_fallback=False, top_n=1,
                     max_refine=3, exact_top=0,
                     city_ids=["rome", "lisbon", "barcelona", "athens", "vienna", "prague",
                               "budapest", "naples", "valletta", "porto"])  # fmt: skip
    w = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
    asyncio.run(p.candidates("KRK", w, profile=TasteProfile(user_id="u", interests={"food": 1})))
    # exact-first targeting stopped after round 1 (the refined card always stayed on top)
    assert len(p.last_stats["refined"]) >= 2


def test_hotel_evidence_says_per_room(nice):
    duo = card(TasteProfile(user_id="u", adults=2))
    hotel = next(e for e in duo.evidence if e.kind == "hotel")
    assert "price for 1 room" in hotel.label and hotel.value == 1292  # one room
    assert duo.hotel_cost_pln == 1292  # hotel_cost_pln is the rooms' total too


def test_value_badges_and_price_honesty_compose():
    """#27 + #29: badges only on exact prices, and estimates still rank after exact ones."""
    from tripai.scoring.value import annotate_value, typical_spend

    prof = TasteProfile(user_id="u", interests={"history": 0.9})
    cands = _sample(prof, None, {"NAP", "FCO", "LIS"}) + _sample(prof, "estimate", {"ATH", "MLA"})
    typical = typical_spend(prof)
    recs = [r for r, _ in rank_within_budget(cands, prof, None, typical_spend_pln=typical.pln)]
    annotate_value(recs, prof, None, typical)
    assert [r.price_status for r in recs] == ["exact"] * 3 + ["estimate"] * 2
    assert all(r.value_badge is None and r.value_reason is None for r in recs[3:])
