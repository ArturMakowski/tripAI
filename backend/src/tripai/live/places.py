"""Where to eat + what to do at a destination (docs/USER_TESTING.md "Restaurants & things to do").

Two fixed Serper Places searches per city ("best restaurants in X", "top attractions in X"), cached
for 7 days (`serper:places` TTL in api_cache) and capped at 2 real calls per city per ISO week
(`WeeklyCap`), so spend grows with the number of cities, not with users. Matching to the user's
interests (food -> restaurants first, hiking -> parks and viewpoints, ...) re-ranks those cached
results on our side and never costs another call. Nothing is invented: a rating, review count,
price level or category Google did not return stays null.
"""

import asyncio
import logging
import re
import weakref
from datetime import datetime
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from tripai import i18n
from tripai.connectors import config
from tripai.connectors.base import ConnectorError, FixtureNotFound
from tripai.connectors.cache import Cache
from tripai.connectors.serper import Place, PlaceResults, Serper
from tripai.live import sources
from tripai.live.budget import BudgetExhausted, WeeklyCap
from tripai.seed import load

log = logging.getLogger(__name__)

RESTAURANTS_QUERY = "best restaurants"
THINGS_TO_DO_QUERY = "top attractions"  # same query as the recorded city fixtures
DEFAULT_WEEKLY_CAP = 2  # real Serper Places calls per city per week (= one of each query)
MIN_REVIEWS = {"restaurant": 300, "activity": 500}  # below this a rating says little
INTEREST_MIN = 0.5  # an interest counts for matching from this weight
MATCH_BONUS = 0.3  # rating points added for a fully weighted (1.0) matching interest
CAP_RECHECK_S = 0.5  # after a cap hit, wait this long and re-read the shared cache once
FOOD_FIRST = 0.7  # food weight from which "where to eat" comes before "what to do"

PlaceKind = Literal["restaurant", "activity"]

# Our buckets, inferred from Google's category + the place name (word-boundary matches).
TAG_WORDS: dict[str, tuple[str, ...]] = {
    "nature": ("park", "parque", "garden", "gardens", "botanical", "hiking", "trail", "nature",
               "mountain", "hill", "viewpoint", "miradouro", "lookout", "scenic", "forest", "lake",
               "island", "cliff", "cliffs", "national park", "nature preserve"),
    "beach": ("beach", "praia", "playa", "spiaggia", "plage", "coast", "bay", "lagoon"),
    "art": ("museum", "museu", "museo", "gallery", "art", "arts", "opera", "theatre", "theater"),
    "history": ("historical", "historic", "history", "castle", "cathedral", "church", "basilica",
                "monument", "ruins", "palace", "temple", "archaeological", "fortress", "fort",
                "forum", "colosseum", "acropolis", "abbey", "monastery", "old town", "tower",
                "bridge", "landmark", "agora", "citadel", "synagogue", "mosque"),
    "nightlife": ("bar", "pub", "club", "nightlife", "wine bar", "brewery", "rooftop"),
    "food": ("market", "mercado", "mercato", "food hall", "food tour", "winery"),
}  # fmt: skip
_TAG_RE = {
    tag: re.compile(r"\b(" + "|".join(re.escape(w) for w in words) + r")\b", re.IGNORECASE)
    for tag, words in TAG_WORDS.items()
}
# The user's interest tags (TasteProfile.interests) -> our bucket. Outdoor interests share one.
INTEREST_TAG = {
    "food": "food",
    "history": "history",
    "culture": "history",
    "art": "art",
    "museums": "art",
    "nature": "nature",
    "hiking": "nature",
    "outdoor": "nature",
    "beach": "beach",
    "nightlife": "nightlife",
}

# Google's category in Polish. EN keeps Google's text; PL without a translation shows no category
# (one language per screen) rather than an English word.
CATEGORY_PL = {
    "tourist attraction": "Atrakcja",
    "museum": "Muzeum",
    "art museum": "Muzeum sztuki",
    "archaeological museum": "Muzeum archeologiczne",
    "history museum": "Muzeum historyczne",
    "historical place museum": "Muzeum historyczne",
    "war museum": "Muzeum wojskowe",
    "art gallery": "Galeria sztuki",
    "historical landmark": "Zabytek",
    "monument": "Pomnik",
    "castle": "Zamek",
    "palace": "Pałac",
    "cathedral": "Katedra",
    "church": "Kościół",
    "basilica": "Bazylika",
    "catholic church": "Kościół",
    "fortress": "Twierdza",
    "fountain": "Fontanna",
    "plaza": "Plac",
    "bridge": "Most",
    "park": "Park",
    "garden": "Ogród",
    "botanical garden": "Ogród botaniczny",
    "national park": "Park narodowy",
    "nature preserve": "Rezerwat przyrody",
    "hiking area": "Szlak",
    "scenic spot": "Punkt widokowy",
    "observation deck": "Taras widokowy",
    "beach": "Plaża",
    "market": "Targ",
    "aquarium": "Akwarium",
    "zoo": "Zoo",
    "restaurant": "Restauracja",
    "fine dining": "Fine dining",
    "fine dining restaurant": "Fine dining",
    "italian": "Kuchnia włoska",
    "roman": "Kuchnia rzymska",
    "pizza": "Pizza",
    "czech": "Kuchnia czeska",
    "greek": "Kuchnia grecka",
    "portuguese": "Kuchnia portugalska",
    "spanish": "Kuchnia hiszpańska",
    "catalan": "Kuchnia katalońska",
    "basque": "Kuchnia baskijska",
    "french": "Kuchnia francuska",
    "hungarian": "Kuchnia węgierska",
    "austrian": "Kuchnia austriacka",
    "maltese": "Kuchnia maltańska",
    "croatian": "Kuchnia chorwacka",
    "mediterranean": "Kuchnia śródziemnomorska",
    "seafood": "Owoce morza",
    "fish": "Ryby",
    "tapas": "Tapas",
    "steak": "Steki",
    "steak house": "Steki",
    "grill": "Grill",
    "halal": "Halal",
    "fusion": "Kuchnia fusion",
    "fusion restaurant": "Kuchnia fusion",
    "vegetarian": "Wegetariańska",
    "vegan": "Wegańska",
    "bar": "Bar",
    "wine bar": "Bar winny",
    "pub": "Pub",
    "cafe": "Kawiarnia",
    "bakery": "Piekarnia",
    "brewery": "Browar",
}


class PlaceItem(BaseModel):
    kind: PlaceKind
    name: str
    rating: float | None = None
    rating_count: int | None = None
    price_level: str | None = None  # Google's own text ("€20–30"); null = Google gave none
    category: str | None = None  # localised; null if we can't say it in the requested language
    tags: list[str] = []  # our buckets: food | history | art | nature | beach | nightlife
    matches: list[str] = []  # the user's interests this place matches (e.g. ["hiking"])
    address: str | None = None
    maps_url: str | None = None
    lat: float | None = None
    lon: float | None = None
    source: str
    fetched_at: datetime


class DestinationPlaces(BaseModel):
    iata: str
    city: str
    country: str
    lang: i18n.Lang
    restaurants: list[PlaceItem]
    things_to_do: list[PlaceItem]
    food_first: bool  # the user cares most about food: show "where to eat" first
    mode: Literal["live", "fixture"]
    # per list, why it is empty or partial: "budget" (weekly cap hit), "not_recorded" (fixture
    # mode, city not recorded), "unavailable" (source error)
    notes: dict[str, str] = {}


def parse_interests(raw: str | None) -> dict[str, float]:
    """ "food:0.9,hiking:0.7" or "food,hiking" (weight 1) -> {tag: weight}; junk is skipped."""
    out: dict[str, float] = {}
    for part in (raw or "").split(","):
        name, _, w = part.strip().partition(":")
        name = name.strip().lower()
        if not name or len(name) > 32:
            continue
        try:
            weight = float(w) if w else 1.0
        except ValueError:
            continue
        out[name] = max(0.0, min(1.0, weight))
    return out


def place_tags(p: Place, kind: PlaceKind) -> list[str]:
    text = f"{p.category or ''} | {p.title}"
    tags = {tag for tag, rx in _TAG_RE.items() if rx.search(text)}
    if kind == "restaurant":
        tags = {"food"} | (tags & {"nightlife"})
    return sorted(tags)


def localise_category(category: str | None, lang: i18n.Lang) -> str | None:
    if not category:
        return None
    if lang == "en":
        return category
    key = category.strip().lower()
    return CATEGORY_PL.get(key) or CATEGORY_PL.get(re.sub(r"\s+restaurant$", "", key))


def _matches(tags: list[str], interests: dict[str, float]) -> list[tuple[str, float]]:
    return [
        (name, w)
        for name, w in sorted(interests.items(), key=lambda kv: -kv[1])
        if w >= INTEREST_MIN and INTEREST_TAG.get(name) in tags
    ]


def rank(
    res: PlaceResults,
    kind: PlaceKind,
    interests: dict[str, float],
    lang: i18n.Lang,
    limit: int,
    source: str,
) -> list[PlaceItem]:
    """Best rated first, a matching interest adds up to MATCH_BONUS; places with few reviews
    only fill up when there aren't enough well-reviewed ones."""
    seen: set[str] = set()
    scored: list[tuple[bool, float, int, PlaceItem]] = []
    for p in res.places:
        ident = p.cid or p.title.lower()
        if ident in seen:
            continue
        seen.add(ident)
        tags = place_tags(p, kind)
        hits = _matches(tags, interests)
        bonus = MATCH_BONUS * max((w for _, w in hits), default=0.0)
        count = p.rating_count or 0
        item = PlaceItem(
            kind=kind,
            name=p.title,
            rating=p.rating,
            rating_count=p.rating_count,
            price_level=p.price_level if kind == "restaurant" else None,
            category=localise_category(p.category, lang),
            tags=tags,
            matches=[name for name, _ in hits],
            address=p.address,
            maps_url=p.maps_url,
            lat=p.lat,
            lon=p.lon,
            source=source,
            fetched_at=res.fetched_at,
        )
        scored.append((count >= MIN_REVIEWS[kind], (p.rating or 0) + bonus, count, item))
    scored.sort(key=lambda s: (s[0], s[1], s[2]), reverse=True)
    return [s[3] for s in scored[:limit]]


def weekly_cap() -> int:
    try:
        return max(0, int(config.env("TRIPAI_SERPER_PLACES_WEEKLY_CAP") or DEFAULT_WEEKLY_CAP))
    except ValueError:
        return DEFAULT_WEEKLY_CAP


_CAP: WeeklyCap | None = None


def global_cap() -> WeeklyCap:
    global _CAP
    if _CAP is None:
        _CAP = WeeklyCap("serper_places", weekly_cap())
    return _CAP


class PlacesService:
    """`cache`, `fixtures`, `cap` and `client` are injectable for tests. By default the Serper
    mode follows tripai.live.sources (fixtures under TRIPAI_USE_FIXTURES, TRIPAI_FIXTURE_SOURCES
    or a missing SERPER_API_KEY)."""

    def __init__(
        self,
        *,
        cache: Cache | None = None,
        fixtures: bool | None = None,
        cap: WeeklyCap | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._cache, self._fixtures, self._cap, self._client = cache, fixtures, cap, client
        # single-flight per (city, query) and event loop: concurrent cold requests wait for the
        # first one's search and then read it from the cache instead of spending or failing
        self._flights: weakref.WeakKeyDictionary[
            asyncio.AbstractEventLoop, dict[tuple[str, str], asyncio.Lock]
        ] = weakref.WeakKeyDictionary()

    def _flight(self, city_id: str, what: str) -> asyncio.Lock:
        locks = self._flights.setdefault(asyncio.get_running_loop(), {})
        return locks.setdefault((city_id, what), asyncio.Lock())

    def _serper(self, city_id: str) -> Serper:
        fixtures = sources.mode("serper") == "fixture" if self._fixtures is None else self._fixtures
        conn = Serper(client=self._client, cache=self._cache, fixtures=fixtures)
        if fixtures:
            return conn
        cap = self._cap or global_cap()
        http = conn._http

        async def metered(*a: Any, **k: Any) -> Any:  # cache hits never get here
            token = await cap.take(city_id)
            try:
                payload = await http(*a, **k)
            except BaseException:
                await cap.release(token)  # a failed call never burns the week's budget
                raise
            await cap.commit(token)
            return payload

        conn._http = metered  # type: ignore[method-assign]
        return conn

    async def get(
        self,
        iata: str,
        interests: dict[str, float] | None = None,
        lang: i18n.Lang | None = None,
        limit: int = 3,
    ) -> DestinationPlaces:
        """Raises KeyError for a destination we don't know."""
        city = load.city(iata)
        lang = lang or i18n.current()
        interests = interests or {}
        serper = self._serper(city.id)
        name = city.name.split(" (")[0]  # "Valletta (Malta)" -> "Valletta"
        notes: dict[str, str] = {}

        async def fetch(what: str) -> PlaceResults:
            async with self._flight(city.id, what):
                try:
                    return await serper.places(name, country=city.country_name, what=what)
                except BudgetExhausted:
                    # another process may be storing this very search: re-check the cache once
                    await asyncio.sleep(CAP_RECHECK_S)
                    return await serper.places(name, country=city.country_name, what=what)

        async def search(what: str, key: str) -> PlaceResults | None:
            try:
                return await fetch(what)
            except FixtureNotFound:
                notes[key] = "not_recorded"
            except BudgetExhausted as exc:
                log.info("places %s: %s", city.id, exc)
                notes[key] = "budget"
            except ConnectorError as exc:
                log.warning("places %s %r failed: %s", city.id, what, exc)
                notes[key] = "unavailable"
            return None

        eat, do = await asyncio.gather(
            search(RESTAURANTS_QUERY, "restaurants"), search(THINGS_TO_DO_QUERY, "things_to_do")
        )
        mode: Literal["live", "fixture"] = "fixture" if serper.fixtures else "live"

        def src(res: PlaceResults) -> str:
            if res.synthetic:
                return res.source + " [synthetic fixture]"
            return res.source + (sources.RECORDED_TAG if mode == "fixture" else "")

        return DestinationPlaces(
            iata=city.iata,
            city=city.name,
            country=city.country_name,
            lang=lang,
            restaurants=rank(eat, "restaurant", interests, lang, limit, src(eat)) if eat else [],
            things_to_do=rank(do, "activity", interests, lang, limit, src(do)) if do else [],
            food_first=interests.get("food", 0.0) >= FOOD_FIRST
            and interests.get("food", 0.0) >= max(interests.values(), default=0.0),
            mode=mode,
            notes=notes,
        )
