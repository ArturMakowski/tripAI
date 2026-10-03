"""Trip details (docs/TRIP_DETAILS.md): which flight, which hotel, where, how to get there.
Offline: recorded SerpApi fixtures, mocked OSRM. The core rule: what is shown is what was priced."""

import asyncio
import json
import time
from datetime import UTC, date, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from tripai import i18n
from tripai.api import create_app
from tripai.connectors import config, osrm
from tripai.connectors.cache import DiskCache
from tripai.connectors.serpapi import HotelOffer, NearbyPlace, Transportation, parse_flights
from tripai.live import LiveProvider, details
from tripai.live.provider import LUXURY_QUANTILE, _Session
from tripai.models import FreeWindow, GeoPoint, HotelDetails, LuxuryLevel, TasteProfile
from tripai.seed import load

CITIES = ["rome", "lisbon", "barcelona", "athens", "vienna", "prague", "budapest", "naples",
          "valletta", "porto"]  # fmt: skip
JAN = [FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19))]
PROF = TasteProfile(user_id="u", budget_pln=6000, interests={"food": 0.9, "history": 0.7})
NOW = datetime(2026, 10, 3, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _offline(monkeypatch, tmp_path):
    for var in ("SERPAPI_API_KEY", "SERPER_API_KEY", "TRAVELPAYOUTS_TOKEN", "SUPABASE_URL",
                "SUPABASE_SECRET_KEY", "TRIPAI_FIXTURE_SOURCES"):  # fmt: skip
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))


def run(top_n=10, max_refine=10, luxury=LuxuryLevel.standard):
    p = LiveProvider(fixtures=True, today=date(2026, 10, 3), city_ids=CITIES, use_fallback=False,
                     top_n=top_n, max_refine=max_refine)  # fmt: skip
    return p, asyncio.run(p.candidates("KRK", JAN, luxury, profile=PROF))


def fixture(kind: str, name: str) -> dict:
    return json.loads((config.fixtures_dir() / "serpapi" / kind / f"{name}.json").read_text())


@pytest.mark.parametrize("luxury", [LuxuryLevel.standard, LuxuryLevel.luxury])
def test_shown_itinerary_and_property_are_exactly_the_priced_ones(luxury):
    _, cands = run(luxury=luxury)
    refined = [c for c in cands if c.hotel is not None]
    assert len(refined) >= 3  # top_n=10, minus options the hard budget filters out
    for c in refined:
        # flight: Google's cheapest listed itinerary, at exactly its price
        raw = fixture("google_flights", f"KRK-{c.iata}")
        fl = parse_flights(raw["payload"], NOW, "KRK", c.iata, JAN[0].start, JAN[0].end, "PLN")
        cheapest = next(o for o in fl.options if o.price)
        assert c.flight.source.startswith("serpapi:google_flights")
        assert c.flight.price_pln == cheapest.price == c.flight_cost_pln
        assert [leg.flight_number for leg in c.flight.outbound] == [
            seg.flight_number for seg in cheapest.legs
        ]
        assert c.flight.outbound[0].from_iata == "KRK" and c.flight.outbound[-1].to_iata == c.iata
        assert c.flight.outbound[0].depart_at is not None  # Google gives local times
        # hotel: the property at the luxury quantile, priced at its own total
        props = [x for x in fixture("google_hotels", c.iata)["payload"]["properties"]
                 if (x.get("rate_per_night") or {}).get("extracted_lowest") is not None]  # fmt: skip
        props.sort(key=lambda x: (x["rate_per_night"]["extracted_lowest"], x["name"]))
        chosen = props[round(LUXURY_QUANTILE[luxury] * (len(props) - 1))]
        assert c.hotel.name == chosen["name"]
        total = (chosen.get("total_rate") or {}).get("extracted_lowest")
        assert (
            c.hotel.price_pln_total
            == c.hotel_cost_pln
            == (total if total is not None else chosen["rate_per_night"]["extracted_lowest"] * 5)
        )
        ev = next(e for e in c.evidence if e.kind == "hotel")
        assert ev.label.startswith(c.hotel.name) and ev.value == round(c.hotel_cost_pln)
        assert c.hotel.location.lat == pytest.approx(chosen["gps_coordinates"]["latitude"])


def test_hotel_geo_and_transfers():
    _, cands = run()
    rome = next(c for c in cands if c.iata == "FCO")
    h = rome.hotel
    city = load.city("rome")
    assert h.city_center.lat == city.lat and h.city_center.label == "Rome"
    assert h.distance_to_center_km == round(
        details.haversine_km(h.location.lat, h.location.lon, city.lat, city.lon), 1
    )
    landing = rome.flight.outbound[-1].to_iata
    assert h.airport.lat == load.airport(landing).lat  # the airport the priced flight lands at
    assert h.transfers and {t.source for t in h.transfers} == {
        "serpapi:google_hotels [recorded fixture]"
    }
    assert {t.mode for t in h.transfers} <= {"taxi", "public_transport", "walk", "drive"}
    assert all(t.duration_min and t.note == h.airport.label for t in h.transfers)
    assert h.photo_url and h.booking_url and h.rating


def test_cheap_pass_and_fast_phase_show_the_travelpayouts_airline_only():
    _, cands = run(top_n=0)
    for c in cands:
        assert c.hotel is None  # no property without the exact-date hotel search
        f = c.flight
        assert f is not None and f.price_pln == c.flight_cost_pln
        assert f.source.startswith("travelpayouts:")  # synthetic fixture, labelled
        assert f.source.endswith("[synthetic fixture]")
        assert all(leg.depart_at is None and leg.flight_number is None for leg in f.outbound)
        assert len(f.outbound[0].airline) == 2  # IATA airline code


def test_api_returns_details_in_both_phases():
    p = LiveProvider(fixtures=True, today=date(2026, 10, 3), city_ids=CITIES, use_fallback=False,
                     top_n=2, max_refine=2)  # fmt: skip
    c = TestClient(create_app(provider=p))
    body = {"profile": PROF.model_dump(mode="json"),
            "windows": [w.model_dump(mode="json") for w in JAN]}  # fmt: skip
    fast = c.post("/recommendations?phase=fast", json=body).json()
    assert all(r["flight"] and r["hotel"] is None for r in fast)
    full = c.post("/recommendations", json=body).json()
    shown = [r for r in full if r["hotel"]]
    assert shown and all(r["hotel"]["price_pln_total"] == r["hotel_cost_pln"] for r in shown)


# ---------------------------------------------------------------- helpers


@pytest.mark.parametrize(
    "text,minutes",
    [("52 min", 52), ("1 hr 5 min", 65), ("2 hrs", 120), ("1 h 30 min", 90), (None, None),
     ("soon", None)],
)  # fmt: skip
def test_parse_duration(text, minutes):
    assert details.parse_duration_min(text) == minutes


def _offer(*places: tuple[str, list[tuple[str, str]]]) -> HotelOffer:
    return HotelOffer(name="H", price_per_night=100, lat=41.9, lon=12.5, nearby=[
        NearbyPlace(name=n, transportations=[Transportation(type=t, duration=d) for t, d in ts])
        for n, ts in places])  # fmt: skip


def test_transfers_match_the_landing_airport_and_never_guess():
    two = _offer(("Ciampino Airport", [("Taxi", "30 min")]),
                 ("Leonardo da Vinci International Airport", [("Public transport", "1 hr")]))  # fmt: skip
    got = details.google_transfers(two, "Leonardo da Vinci International Airport", "s", NOW)
    assert [(t.mode, t.duration_min) for t in got] == [("public_transport", 60)]
    assert details.google_transfers(two, None, "s", NOW) == []  # two airports: ambiguous
    one = _offer(("Colosseum", [("Walking", "9 min")]), ("Ciampino Airport", [("Taxi", "30 min")]))
    assert [t.mode for t in details.google_transfers(one, None, "s", NOW)] == ["taxi"]
    assert details.google_transfers(_offer(("Colosseum", [("Walking", "9 min")])), None, "s",
                                    NOW) == []  # fmt: skip


def test_pick_offer_is_a_real_property():
    offers = [
        HotelOffer(name=n, price_per_night=p) for n, p in [("a", 300), ("b", 100), ("c", 200)]
    ]
    offers.append(HotelOffer(name="no price"))
    assert details.pick_offer(offers, 0.5)[0].name == "c"
    assert details.pick_offer(offers, 0.9)[0].name == "a"
    assert details.pick_offer([HotelOffer(name="x")], 0.5) is None


# ---------------------------------------------------------------- OSRM fallback


def _hotel_without_transfers() -> HotelDetails:
    return HotelDetails(name="H", location=GeoPoint(lat=41.8986, lon=12.4769),
                        airport=GeoPoint(lat=41.80453, lon=12.252, label="FCO"),
                        source="serpapi:google_hotels", fetched_at=NOW)  # fmt: skip


def test_osrm_drive_when_google_has_no_transfer(tmp_path, monkeypatch):
    import respx

    monkeypatch.setattr(osrm, "MIN_INTERVAL_S", 0.0)
    route = {"code": "Ok", "routes": [{"duration": 1950.0, "distance": 31400.0}]}

    async def go(lang):
        async with httpx.AsyncClient() as client:
            s = _Session(client, DiskCache(tmp_path / "c"), fixtures=False, today=None)
            with i18n.using(lang):
                return await LiveProvider()._drive_transfer(s, _hotel_without_transfers())

    with respx.mock() as mock:
        r = mock.get(url__startswith="https://router.project-osrm.org/route/v1/driving/").respond(
            json=route
        )
        en = asyncio.run(go("en"))
        pl = asyncio.run(go("pl"))  # same pair: served from the cache, no second request
    assert r.call_count == 1
    assert "12.252,41.80453;12.4769,41.8986" in str(r.calls[0].request.url)
    assert "_route" not in str(r.calls[0].request.url)  # cache-key-only param stays local
    (t,) = en.transfers
    assert (t.mode, t.duration_min, t.distance_km, t.source) == ("drive", 32, 31.4, "osrm:route")
    assert "estimate" in t.note and "szacunek" in pl.transfers[0].note
    assert not any(x.mode == "public_transport" for x in en.transfers)  # never invented


def test_osrm_failure_leaves_transfers_empty(tmp_path):
    import respx

    async def go():
        async with httpx.AsyncClient() as client:
            s = _Session(client, DiskCache(tmp_path / "c"), fixtures=False, today=None)
            return await LiveProvider()._drive_transfer(s, _hotel_without_transfers())

    with respx.mock() as mock:
        mock.get(url__startswith="https://router.project-osrm.org/").respond(
            json={"code": "NoRoute"}
        )
        assert asyncio.run(go()).transfers == []


def test_osrm_is_throttled(monkeypatch):
    monkeypatch.setattr(osrm, "MIN_INTERVAL_S", 0.2)
    t = osrm._Throttle()

    async def three():
        start = time.monotonic()
        await asyncio.gather(t.wait(), t.wait(), t.wait())
        return time.monotonic() - start

    assert asyncio.run(three()) >= 0.39  # 3 calls spaced 0.2 s apart
    assert asyncio.run(three()) >= 0.39  # and again on a new event loop
