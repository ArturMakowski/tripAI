import json

import httpx
import pytest
import respx

from tripai.connectors.base import MissingCredentials, fixture_path
from tripai.connectors.demo_routes import DESTINATIONS
from tripai.connectors.serper import BASE, Serper


def _payload(source: str, name: str) -> dict:
    return json.loads(fixture_path(source, name).read_text())["payload"]


@respx.mock
async def test_places_live_posts_json_and_caches(disk_cache, monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "serper-test")
    route = respx.post(f"{BASE}/places").mock(
        return_value=httpx.Response(200, json=_payload("serper:places", "top-attractions-in-rome"))
    )
    res = await Serper(cache=disk_cache).places("Rome", country="Italy")
    req = route.calls.last.request
    assert req.headers["X-API-KEY"] == "serper-test"
    assert json.loads(req.content) == {
        "gl": "pl",
        "hl": "en",
        "q": "top attractions in Rome, Italy",
    }
    top = res.top(3)
    assert top and all(p.rating_count >= 500 for p in top)
    ev = res.evidence()[0]
    assert ev.kind == "attraction" and ev.source == "serper:places"
    assert ev.url.startswith("https://maps.google.com/?cid=")
    assert "serper-test" not in next(disk_cache.root.rglob("*.json")).read_text()

    await Serper(cache=disk_cache).places("Rome", country="Italy")
    assert route.call_count == 1


@respx.mock
async def test_images_best_prefers_large_landscape(disk_cache, monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "serper-test")
    respx.post(f"{BASE}/images").mock(
        return_value=httpx.Response(
            200,
            json={
                "images": [
                    {"imageUrl": "https://a/portrait.jpg", "imageWidth": 900, "imageHeight": 1600},
                    {"imageUrl": "https://a/small.jpg", "imageWidth": 300, "imageHeight": 200},
                    {"imageUrl": "https://a/wide.jpg", "imageWidth": 1600, "imageHeight": 900},
                ]
            },
        )
    )
    res = await Serper(cache=disk_cache).city_images("Lisbon")
    assert res.best().image_url == "https://a/wide.jpg"


async def test_missing_key():
    with pytest.raises(MissingCredentials):
        await Serper().places("Rome")


async def test_fixture_mode_all_cities(fixtures_mode):
    for p in DESTINATIONS:
        imgs = await Serper().city_images(p.city, country=p.country)
        places = await Serper().places(p.city, country=p.country)
        assert imgs.best() is not None
        assert places.places
