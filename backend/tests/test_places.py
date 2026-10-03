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
from tripai.connectors.serper import _slug as slug
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


def _by_query(request: httpx.Request) -> httpx.Response:
    """Answer each live search with the recorded payload for that city + query."""
    q = json.loads(request.content)["q"]  # "best restaurants in Lisbon, Portugal"
    return httpx.Response(200, json=_payload(slug(q.split(",")[0])))


@respx.mock
def test_live_calls_are_capped_per_city_per_week(monkeypatch, tmp_path):
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "0")
    monkeypatch.setenv("SERPER_API_KEY", "serper-test")
    route = respx.post(f"{BASE}/places").mock(side_effect=_by_query)
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


def _live(monkeypatch):
    monkeypatch.setenv("TRIPAI_USE_FIXTURES", "0")
    monkeypatch.setenv("SERPER_API_KEY", "serper-test")


@respx.mock
def test_failed_calls_are_released_but_bounded_by_slack(monkeypatch, tmp_path):
    _live(monkeypatch)
    ok = httpx.Response(200, json=_payload("best-restaurants-in-rome"))
    route = respx.post(f"{BASE}/places").mock(return_value=httpx.Response(400, text="bad"))
    cap = WeeklyCap("serper_places", 2, root=tmp_path / "budget", slack=2)
    svc = PlacesService(cache=NullCache(), cap=cap)
    failed = asyncio.run(svc.get("FCO"))
    assert failed.notes == {"restaurants": "unavailable", "things_to_do": "unavailable"}
    assert asyncio.run(cap.used("rome")) == {"used": 0, "tries": 2}  # nothing burnt

    route.mock(return_value=ok)
    good = asyncio.run(svc.get("FCO"))  # the week's 2 successes are still available
    assert not good.notes and good.restaurants and good.things_to_do
    assert asyncio.run(cap.used("rome")) == {"used": 2, "tries": 4}

    # a flapping upstream: attempts stop at cap + slack even with no success
    route.mock(return_value=httpx.Response(400, text="bad"))
    other = WeeklyCap("serper_places", 2, root=tmp_path / "b2", slack=2)
    svc2 = PlacesService(cache=NullCache(), cap=other)
    asyncio.run(svc2.get("LIS"))
    asyncio.run(svc2.get("LIS"))
    calls = route.call_count
    assert asyncio.run(svc2.get("LIS")).notes == {"restaurants": "budget", "things_to_do": "budget"}
    assert route.call_count == calls


@respx.mock
def test_concurrent_cold_requests_share_one_search(monkeypatch, tmp_path):
    _live(monkeypatch)

    async def slow(request):
        await asyncio.sleep(0.05)
        return httpx.Response(200, json=_payload("best-restaurants-in-rome"))

    route = respx.post(f"{BASE}/places").mock(side_effect=slow)
    cap = WeeklyCap("serper_places", 2, root=tmp_path / "budget")
    svc = PlacesService(cache=DiskCache(tmp_path / "c"), cap=cap)

    async def both():
        return await asyncio.gather(*(svc.get("FCO") for _ in range(4)))

    results = asyncio.run(both())
    assert route.call_count == 2  # one per query, the rest waited and read the cache
    for r in results:
        assert not r.notes and len(r.restaurants) == 3 and len(r.things_to_do) == 3


def test_weekly_cap_counts_in_flight_reservations(tmp_path):
    cap = WeeklyCap("t", 2, root=tmp_path)

    async def run():
        a = await cap.take("x")
        await cap.take("x")
        with pytest.raises(Exception, match="weekly cap"):
            await cap.take("x")  # 2 in flight: a third would overshoot
        await cap.release(a)
        await cap.take("x")  # the failed slot is free again (tries 3 <= cap + slack)

    asyncio.run(run())


# ---------------------------------------------------------------- live bug: Palma -> Łódź

LODZ = json.loads(
    (
        fixture_path("serper:places", "x").parent.parent
        / "regressions"
        / "palma-attractions-lodz.json"
    ).read_text()
)["payload"]


@respx.mock
def test_lodz_payload_for_palma_is_rejected_and_never_cached(monkeypatch, tmp_path):
    _live(monkeypatch)
    route = respx.post(f"{BASE}/places").mock(return_value=httpx.Response(200, json=LODZ))
    cache = DiskCache(tmp_path / "c")
    svc = PlacesService(cache=cache, cap=WeeklyCap("serper_places", 3, root=tmp_path / "b"))
    res = asyncio.run(svc.get("PMI", lang="pl"))
    assert res.things_to_do == [] and res.restaurants == []
    assert res.notes == {"restaurants": "unavailable", "things_to_do": "unavailable"}
    assert not list((tmp_path / "c").rglob("*.json"))  # garbage is not a success
    bodies = [json.loads(c.request.content) for c in route.calls]
    assert {b["hl"] for b in bodies} == {"en", "pl"}
    for b in bodies:  # anchored at the destination, not at the requester
        assert b["gl"] == "es" and b["ll"] == "@39.5696,2.6502,13z"
        assert b["q"].endswith("in Palma de Mallorca, Spain")


def test_lodz_payload_already_cached_is_filtered_out(monkeypatch, tmp_path):
    folder = tmp_path / "fx" / "serper" / "places"
    folder.mkdir(parents=True)
    entry = {"source": "serper:places", "params": {}, "fetched_at": "2026-10-03T21:11:00+00:00",
             "recorded": True, "payload": LODZ}  # fmt: skip
    (folder / "top-attractions-in-palma-de-mallorca.json").write_text(json.dumps(entry))
    monkeypatch.setenv("TRIPAI_FIXTURES_DIR", str(tmp_path / "fx"))
    body = _client().get("/destinations/PMI/places").json()
    assert body["things_to_do"] == [] and body["notes"]["things_to_do"] == "not_nearby"


def test_geo_filter_and_address_fallback():
    from tripai.connectors.serper import Place
    from tripai.live.places import nearby
    from tripai.seed import load

    palma = load.city("PMI")
    places = [
        Place(title="Catedral", lat=39.5674, lon=2.6483),  # in town
        Place(title="Sóller", lat=39.766, lon=2.715),  # ~23 km: still in
        Place(title="Alcúdia", lat=39.853, lon=3.121),  # ~51 km: out
        Place(title="TOP-SHOT Łódź", lat=51.766, lon=19.447),
        Place(title="No coords, Spanish address", address="Carrer X, Palma, España"),
        Place(title="No coords, Spain", address="07001 Palma de Mallorca, Spain"),
        Place(title="No coords, no address"),
        Place(title="No coords, elsewhere", address="ul. Piotrkowska 1, Łódź"),
    ]
    assert [p.title for p in nearby(places, palma)] == [
        "Catedral",
        "Sóller",
        "No coords, Spanish address",  # names the city ("Palma")
        "No coords, Spain",
    ]


def test_polish_names_join_english_counts():
    body = _client().get("/destinations/PMI/places?lang=pl&limit=5").json()
    by_name = {p["name"]: p for p in body["things_to_do"]}
    cathedral = by_name["Katedra w Palma de Mallorca"]  # Polish name from the hl=pl search...
    assert cathedral["rating_count"] == 69000  # ...with the real count from the English one
    assert cathedral["category"] == "Katedra"
    en = _client().get("/destinations/PMI/places?lang=en&limit=5").json()
    assert "Catedral-Basílica de Santa María de Mallorca" in {p["name"] for p in en["things_to_do"]}


def test_purge_finds_and_deletes_only_bad_rows(monkeypatch, tmp_path):
    from tripai.live.places import bad_payload, city_for_query, purge_cache

    assert city_for_query("top attractions in Palma de Mallorca, Spain").id == "palma"
    assert "0 of 10" in bad_payload(LODZ)
    assert bad_payload(_payload("top-attractions-in-rome")) is None

    folder = tmp_path / "cache" / "serper_places"
    folder.mkdir(parents=True)
    (folder / "bad.json").write_text(json.dumps({"payload": LODZ}))
    (folder / "good.json").write_text(json.dumps({"payload": _payload("top-attractions-in-rome")}))
    monkeypatch.setenv("SUPABASE_URL", "https://sb.example")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb-test")
    rows = [
        {"cache_key": "bad1", "payload": LODZ},
        {"cache_key": "ok1", "payload": _payload("best-restaurants-in-rome")},
    ]
    with respx.mock:
        respx.get("https://sb.example/rest/v1/api_cache").mock(
            return_value=httpx.Response(200, json=rows)
        )
        delete = respx.delete("https://sb.example/rest/v1/api_cache").mock(
            return_value=httpx.Response(204)
        )
        dry = asyncio.run(purge_cache(apply=False))
        assert len(dry) == 2 and delete.call_count == 0 and (folder / "bad.json").exists()
        asyncio.run(purge_cache(apply=True))
    assert delete.call_count == 1
    assert "cache_key=eq.bad1" in str(delete.calls.last.request.url)
    assert not (folder / "bad.json").exists() and (folder / "good.json").exists()
