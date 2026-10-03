"""Serper (serper.dev) Google wrapper: city photos (/images) and attractions/restaurants (/places).
No flights/hotels here. SERPER_API_KEY required unless TRIPAI_USE_FIXTURES=1."""

import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from tripai.connectors import config
from tripai.connectors.base import Connector, Fetched, MissingCredentials, SourcedResult
from tripai.models import Evidence

BASE = "https://google.serper.dev"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


class Image(BaseModel):
    title: str | None = None
    image_url: str
    width: int | None = None
    height: int | None = None
    thumbnail_url: str | None = None
    source: str | None = None  # site name, for attribution
    page_url: str | None = None


class ImageResults(SourcedResult):
    query: str
    images: list[Image]

    def best(self, min_width: int = 800) -> Image | None:
        """First landscape image at least `min_width` wide (falls back to the first result)."""
        for img in self.images:
            if (img.width or 0) >= min_width and (img.width or 0) > (img.height or 0):
                return img
        return self.images[0] if self.images else None


class Place(BaseModel):
    title: str
    category: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    rating: float | None = None
    rating_count: int | None = None
    website: str | None = None
    cid: str | None = None

    @property
    def maps_url(self) -> str | None:
        return f"https://maps.google.com/?cid={self.cid}" if self.cid else None


class PlaceResults(SourcedResult):
    query: str
    places: list[Place]

    def top(self, n: int = 5, min_reviews: int = 500) -> list[Place]:
        ok = [p for p in self.places if (p.rating_count or 0) >= min_reviews]
        return sorted(ok, key=lambda p: (p.rating or 0, p.rating_count or 0), reverse=True)[:n]

    def evidence(self) -> list[Evidence]:
        return [
            self._ev(
                "attraction",
                f"{p.title} ({p.category or 'place'}, {p.rating_count} Google reviews)",
                p.rating,
                "★/5",
                p.maps_url or p.website,
            )
            for p in self.top()
            if p.rating is not None
        ]


def parse_images(payload: dict, fetched_at: datetime, query: str) -> ImageResults:
    return ImageResults(
        source="serper:images",
        fetched_at=fetched_at,
        query=query,
        images=[
            Image(
                title=i.get("title"),
                image_url=i["imageUrl"],
                width=i.get("imageWidth"),
                height=i.get("imageHeight"),
                thumbnail_url=i.get("thumbnailUrl"),
                source=i.get("source") or i.get("domain"),
                page_url=i.get("link"),
            )
            for i in payload.get("images", [])
            if i.get("imageUrl")
        ],
    )


def parse_places(payload: dict, fetched_at: datetime, query: str) -> PlaceResults:
    return PlaceResults(
        source="serper:places",
        fetched_at=fetched_at,
        query=query,
        places=[
            Place(
                title=p["title"],
                category=p.get("category"),
                address=p.get("address"),
                lat=p.get("latitude"),
                lon=p.get("longitude"),
                rating=p.get("rating"),
                rating_count=p.get("ratingCount"),
                website=p.get("website"),
                cid=str(p["cid"]) if p.get("cid") else None,
            )
            for p in payload.get("places", [])
            if p.get("title")
        ],
    )


class Serper(Connector):
    def __init__(self, *args: Any, gl: str = "pl", hl: str = "en", **kw: Any):
        super().__init__(*args, **kw)
        self.gl, self.hl = gl, hl

    async def _post(self, endpoint: str, body: dict, fixture: str) -> Fetched:
        key = config.env("SERPER_API_KEY")
        if not key and not self.fixtures:
            raise MissingCredentials("SERPER_API_KEY not set")
        return await self._fetch(
            f"serper:{endpoint}",
            f"{BASE}/{endpoint}",
            {},
            fixture=fixture,
            method="POST",
            json_body={"gl": self.gl, "hl": self.hl, **body},
            headers={"X-API-KEY": key or ""},
        )

    async def city_images(
        self, city: str, *, country: str | None = None, query: str | None = None, num: int = 10
    ) -> ImageResults:
        q = query or f"{city}{f' {country}' if country else ''} city skyline"
        f = await self._post("images", {"q": q, "num": num}, fixture=_slug(city))
        res = parse_images(f.payload, f.fetched_at, q)
        res.synthetic = f.synthetic
        return res

    async def places(
        self, city: str, *, country: str | None = None, what: str = "top attractions"
    ) -> PlaceResults:
        """e.g. what="top attractions" | "best restaurants" | "museums". Pass `country` to
        disambiguate (Naples, Italy vs Naples, FL). Fixture name ignores country."""
        q = f"{what} in {city}{f', {country}' if country else ''}"
        fixture = _slug(f"{what} in {city}")
        f = await self._post("places", {"q": q}, fixture=fixture)
        res = parse_places(f.payload, f.fetched_at, q)
        res.synthetic = f.synthetic
        return res
