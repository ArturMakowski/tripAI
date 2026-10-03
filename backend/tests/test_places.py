"""T14: GET /destinations/{iata}/places — restaurants + things to do from Serper Places."""

import asyncio
import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.connectors.base import fixture_path
from tripai.connectors.cache import DiskCache, NullCache
from tripai.connectors.serper import BASE
from tripai.live.budget import WeeklyCap
from tripai.live.places import PlacesService, parse_interests


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    for var in ("SERPER_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "TRIPAI_FIXTURE_SOURCES"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("TRIPAI_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "1")


def _client(**kw) -> TestClient:
    return TestClient(create_app(**kw))


def _payload(name: str) -> dict:
    return json.loads(fixture_path("serper:places", name).read_text())["payload"]


def test_endpoint_serves_recorded_restaurants_and_things_to_do():
    r = _client().get("/destinations/FCO/places")
    assert r.status_code == 200
    body = r.json()
    assert (body["iata"], body["city"], body["mode"]) == ("FCO", "Rome", "fixture")
    assert len(body["restaurants"]) == 3 and len(body["things_to_do"]) == 3
    recorded = {p["title"]: p for p in _payload("best-restaurants-in-rome")["places"]}
    for p in body["restaurants"] + body["things_to_do"]:
        assert p["source"] == "serper:places [recorded fixture]" and p["fetched_at"]
        assert p["maps_url"].startswith("https://maps.google.com/?cid=")
        assert p["rating"] and p["rating_count"]
    for p in body["restaurants"]:
        # the price level is Google's own text, never computed or invented
        assert p["price_level"] == recorded[p["name"]].get("priceLevel")
    assert all(p["price_level"] is None for p in body["things_to_do"])
    assert body["things_to_do"][0]["name"] == "Colosseum"


def test_limit_and_validation():
    c = _client()
    assert len(c.get("/destinations/FCO/places?limit=5").json()["restaurants"]) == 5
    assert c.get("/destinations/FCO/places?limit=9").status_code == 422
    assert c.get("/destinations/XYZ/places").status_code == 404
    assert c.get("/destinations/ROME/places").status_code == 422


def test_polish_categories_and_no_english_leak():
    body = _client().get("/destinations/FCO/places?lang=pl&limit=5").json()
    assert body["lang"] == "pl"
    cats = {p["category"] for p in body["restaurants"] + body["things_to_do"]}
    assert "Kuchnia włoska" in cats and "Atrakcja" in cats
    assert not cats & {"Italian", "Tourist attraction", "Plaza"}


def test_interests_rerank_and_food_first():
    c = _client()
    plain = c.get("/destinations/LIS/places").json()
    hiker = c.get("/destinations/LIS/places?interests=hiking:0.9,food:0.2").json()
    top = hiker["things_to_do"][0]
    assert "nature" in top["tags"] and top["matches"] == ["hiking"]
    assert [p["name"] for p in plain["things_to_do"]] != [p["name"] for p in hiker["things_to_do"]]
    assert not hiker["food_first"]
    foodie = c.get("/destinations/LIS/places?interests=food:0.9,history:0.5").json()
    assert foodie["food_first"] and all(p["matches"] == ["food"] for p in foodie["restaurants"])


def test_unrecorded_city_is_empty_not_an_error():
    body = _client().get("/destinations/VIE/places").json()
    assert body["restaurants"] == [] and body["notes"] == {"restaurants": "not_recorded"}
    assert body["things_to_do"]


def test_parse_interests():
    assert parse_interests("food:0.9, Hiking ,x:abc,beach:7") == {
        "food": 0.9,
        "hiking": 1.0,
        "beach": 1.0,
    }
    assert parse_interests(None) == {}


@respx.mock
def test_live_calls_are_capped_per_city_per_week(monkeypatch, tmp_path):
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "0")
    monkeypatch.setenv("SERPER_API_KEY", "serper-test")
    route = respx.post(f"{BASE}/places").mock(
        return_value=httpx.Response(200, json=_payload("best-restaurants-in-rome"))
    )
    cap = WeeklyCap("serper_places", 2, root=tmp_path / "budget")
    # no cache at all: the cap alone must stop the third and fourth searches
    svc = PlacesService(cache=NullCache(), cap=cap)
    first = asyncio.run(svc.get("FCO"))
    assert first.mode == "live" and first.restaurants and not first.notes
    second = asyncio.run(svc.get("FCO"))
    assert route.call_count == 2
    assert second.restaurants == [] and second.notes == {
        "restaurants": "budget",
        "things_to_do": "budget",
    }
    # another process sees the same weekly counter; another city has its own
    other = PlacesService(cache=NullCache(), cap=WeeklyCap("serper_places", 2, tmp_path / "budget"))
    assert asyncio.run(other.get("FCO")).notes and route.call_count == 2
    assert not asyncio.run(other.get("LIS")).notes and route.call_count == 4


@respx.mock
def test_live_cache_hits_do_not_spend(monkeypatch, tmp_path):
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "0")
    monkeypatch.setenv("SERPER_API_KEY", "serper-test")
    payload = _payload("best-restaurants-in-rome")
    for place in payload["places"][1:]:
        place.pop("priceLevel", None)
    route = respx.post(f"{BASE}/places").mock(return_value=httpx.Response(200, json=payload))
    cap = WeeklyCap("serper_places", 2, root=tmp_path / "budget")
    svc = PlacesService(cache=DiskCache(tmp_path / "c"), cap=cap)
    for _ in range(3):
        res = asyncio.run(svc.get("FCO", {"food": 1.0}, limit=5))
    assert route.call_count == 2
    priced = {p["title"] for p in payload["places"] if p.get("priceLevel")}
    for p in res.restaurants:  # no price from the source -> none shown
        assert (p.price_level is not None) == (p.name in priced)
    assert res.restaurants[0].source == "serper:places"
    # gl/hl are fixed so the two cached searches serve every language
    body = json.loads(route.calls.last.request.content)
    assert body["hl"] == "en" and "serper-test" not in json.dumps(body)
