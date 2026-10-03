"""Where to eat + what to do at a destination (docs/USER_TESTING.md "Restaurants & things to do").

Two fixed Serper Places searches per city ("best restaurants in X", "top attractions in X"), cached
for 7 days (`serper:places` TTL in api_cache) and capped at 2 real calls per city per ISO week
(`WeeklyCap`), so spend grows with the number of cities, not with users. Matching to the user's
interests (food -> restaurants first, hiking -> parks and viewpoints, ...) re-ranks those cached
results on our side and never costs another call. Nothing is invented: a rating, review count,
price level or category Google did not return stays null.
"""

import asyncio
import json
import logging
import math
import re
import unicodedata
import weakref
from collections.abc import Awaitable
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from tripai import i18n
from tripai.connectors import config
from tripai.connectors.base import ConnectorError, FixtureNotFound
from tripai.connectors.cache import Cache
from tripai.connectors.serper import Place, PlaceResults, Serper, parse_places
from tripai.live import sources
from tripai.live.budget import BudgetExhausted, WeeklyCap
from tripai.seed import load

log = logging.getLogger(__name__)

RESTAURANTS_QUERY = "best restaurants"
THINGS_TO_DO_QUERY = "top attractions"  # same query as the recorded city fixtures
# real Serper Places calls per city per week: restaurants + attractions in English (reliable
# review counts, shared by every UI language) + attractions in Polish (names only)
DEFAULT_WEEKLY_CAP = 3
MIN_REVIEWS = {"restaurant": 300, "activity": 500}  # below this a rating says little
INTEREST_MIN = 0.5  # an interest counts for matching from this weight
MATCH_BONUS = 0.3  # rating points added for a fully weighted (1.0) matching interest
MAX_KM = 25.0  # hard geo filter: farther from the city centre than this = not this city
MIN_NEARBY = 3  # a search with fewer nearby places is garbage: not cached, not shown as success
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


def localise_category(
    category: str | None, lang: i18n.Lang, answered: str | None = "en"
) -> str | None:
    """`answered`: the language Google wrote the category in (searchParameters.hl)."""
    if not category:
        return None
    answered = (answered or "en").lower()
    if answered == lang:
        return category
    if lang != "pl" or answered != "en":
        return None  # e.g. a Polish category on an English screen: say nothing
    key = category.strip().lower()
    return CATEGORY_PL.get(key) or CATEGORY_PL.get(re.sub(r"\s+restaurant$", "", key))


def _matches(tags: list[str], interests: dict[str, float]) -> list[tuple[str, float]]:
    return [
        (name, w)
        for name, w in sorted(interests.items(), key=lambda kv: -kv[1])
        if w >= INTEREST_MIN and INTEREST_TAG.get(name) in tags
    ]


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def nearby(places: list[Place], city: load.City, max_km: float = MAX_KM) -> list[Place]:
    """HARD geo filter: keep places within `max_km` of the city centre. A place without
    coordinates is kept only if its address names the city or the country."""
    names = {_fold(n) for n in (_plain(city.name), city.name, city.id, city.country_name) if n}
    out = []
    for p in places:
        if p.lat is not None and p.lon is not None:
            if _km(city.lat, city.lon, p.lat, p.lon) <= max_km:
                out.append(p)
        elif p.address and any(n in _fold(p.address) for n in names):
            out.append(p)
    return out


def check_nearby(res: PlaceResults, city: load.City) -> None:
    """Raise ConnectorError (-> not cached, not a success) when a search is mostly elsewhere."""
    near = nearby(res.places, city)
    if len(near) < min(MIN_NEARBY, len(res.places)) or not near:
        raise ConnectorError(
            f"serper places {res.query!r}: only {len(near)} of {len(res.places)} results "
            f"within {MAX_KM:.0f} km of {city.name}"
        )


def _plain(name: str) -> str:
    return name.split(" (")[0]  # "Valletta (Malta)" -> "Valletta"


def rank(
    res: PlaceResults,
    kind: PlaceKind,
    interests: dict[str, float],
    lang: i18n.Lang,
    limit: int,
    source: str,
    local_names: dict[str, tuple[str, str | None]] | None = None,
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
        local = (local_names or {}).get(p.cid or "")
        tags = place_tags(p, kind)  # from Google's English name/category
        hits = _matches(tags, interests)
        bonus = MATCH_BONUS * max((w for _, w in hits), default=0.0)
        count = p.rating_count or 0
        item = PlaceItem(
            kind=kind,
            name=local[0] if local else p.title,
            rating=p.rating,
            rating_count=p.rating_count,
            price_level=p.price_level if kind == "restaurant" else None,
            category=local[1] if local else localise_category(p.category, lang, res.hl),
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

    def _flight(self, key: str, what: str) -> asyncio.Lock:
        locks = self._flights.setdefault(asyncio.get_running_loop(), {})
        return locks.setdefault((key, what), asyncio.Lock())

    def _serper(self, cap_key: str) -> Serper:
        fixtures = sources.mode("serper") == "fixture" if self._fixtures is None else self._fixtures
        conn = Serper(client=self._client, cache=self._cache, fixtures=fixtures)
        if fixtures:
            return conn
        cap = self._cap or global_cap()
        http = conn._http

        async def metered(*a: Any, **k: Any) -> Any:  # cache hits never get here
            token = await cap.take(cap_key)
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
        # Every search runs in English: review counts are only reliable there (with hl=pl Google
        # writes "69 tys." and Serper hands us 69). On a Polish screen one extra attractions
        # search supplies the Polish names/categories, joined by Google's place id (cid).
        serper = self._serper(city.id)
        name = _plain(city.name)
        notes: dict[str, str] = {}

        def ask(what: str, hl: str) -> Awaitable[PlaceResults]:
            return serper.places(
                name,
                country=city.country_name,
                what=what,
                near=(city.lat, city.lon),  # anchor the search at the destination...
                gl=city.country,  # ...not near the requester (live bug: Palma -> Łódź)
                hl=hl,
                validate=lambda res: check_nearby(res, city),  # garbage is never cached
            )

        async def fetch(what: str, hl: str) -> PlaceResults:
            async with self._flight(f"{city.id}:{hl}", what):
                try:
                    return await ask(what, hl)
                except BudgetExhausted:
                    # another process may be storing this very search: re-check the cache once
                    await asyncio.sleep(CAP_RECHECK_S)
                    return await ask(what, hl)

        async def search(what: str, key: str | None, hl: str = "en") -> PlaceResults | None:
            try:
                return await fetch(what, hl)
            except FixtureNotFound:
                if key:
                    notes[key] = "not_recorded"
            except BudgetExhausted as exc:
                log.info("places %s: %s", city.id, exc)
                if key:
                    notes[key] = "budget"
            except ConnectorError as exc:
                log.warning("places %s %r (%s) failed: %s", city.id, what, hl, exc)
                if key:
                    notes[key] = "unavailable"
            return None

        async def nothing() -> None:
            return None

        eat, do, do_local = await asyncio.gather(
            search(RESTAURANTS_QUERY, "restaurants"),
            search(THINGS_TO_DO_QUERY, "things_to_do"),
            # names only: if this fails, the English names stay (no note)
            search(THINGS_TO_DO_QUERY, None, hl=lang) if lang != "en" else nothing(),
        )
        mode: Literal["live", "fixture"] = "fixture" if serper.fixtures else "live"

        def local(res: PlaceResults | None, key: str) -> PlaceResults | None:
            """Apply the geo filter to whatever we got (fixtures and older cache rows too)."""
            if res is None:
                return None
            near = nearby(res.places, city)
            if not near:
                notes[key] = "not_nearby"
                return None
            return res.model_copy(update={"places": near})

        eat, do = local(eat, "restaurants"), local(do, "things_to_do")
        local_names = {
            p.cid: (p.title, p.category)
            for p in (nearby(do_local.places, city) if do_local else [])
            if p.cid and do_local and (do_local.hl or "").lower() == lang
        }

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
            things_to_do=(
                rank(do, "activity", interests, lang, limit, src(do), local_names) if do else []
            ),
            food_first=interests.get("food", 0.0) >= FOOD_FIRST
            and interests.get("food", 0.0) >= max(interests.values(), default=0.0),
            mode=mode,
            notes=notes,
        )


# ---------------------------------------------------------------- one-off cache purge

_Q_RE = re.compile(r" in (?P<city>.+?), (?P<country>[^,]+)$")


def city_for_query(q: str) -> load.City | None:
    """'top attractions in Palma de Mallorca, Spain' -> the seed city (None if unknown)."""
    m = _Q_RE.search(q or "")
    if not m:
        return None
    want = (_fold(m["city"]), _fold(m["country"]))
    return next(
        (c for c in load.cities() if (_fold(_plain(c.name)), _fold(c.country_name)) == want), None
    )


def bad_payload(payload: Any) -> str | None:
    """Why a cached serper:places payload must go (None = keep)."""
    q = ((payload or {}).get("searchParameters") or {}).get("q") or ""
    city = city_for_query(q)
    if city is None:
        return None  # not one of ours: leave it alone
    try:
        check_nearby(parse_places(payload, datetime.now(UTC), q), city)
    except ConnectorError as exc:
        return str(exc)
    return None


async def purge_cache(apply: bool = False) -> list[str]:
    """Find (and with `apply`, delete) cached serper:places rows that fail the geo filter, in the
    Supabase `api_cache` table (SUPABASE_URL + SUPABASE_SECRET_KEY) and the local disk cache."""
    report: list[str] = []
    url, key = config.env("SUPABASE_URL"), config.env("SUPABASE_SECRET_KEY")
    if url and key:
        endpoint = url.rstrip("/") + "/rest/v1/api_cache"
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
        async with httpx.AsyncClient(timeout=20) as c:
            resp = await c.get(
                endpoint,
                headers=headers,
                params={"source": "eq.serper:places", "select": "cache_key,payload"},
            )
            resp.raise_for_status()
            for row in resp.json():
                why = bad_payload(row["payload"])
                if why is None:
                    continue
                report.append(f"supabase {row['cache_key']}: {why}")
                if apply:
                    d = await c.delete(
                        endpoint,
                        headers=headers,
                        params={
                            "source": "eq.serper:places",
                            "cache_key": f"eq.{row['cache_key']}",
                        },
                    )
                    d.raise_for_status()
    else:
        report.append("supabase: SUPABASE_URL / SUPABASE_SECRET_KEY not set, skipped")
    folder = config.cache_dir() / "serper_places"
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        try:
            why = bad_payload(json.loads(path.read_text()).get("payload"))
        except (OSError, ValueError):
            continue
        if why is None:
            continue
        report.append(f"disk {path.name}: {why}")
        if apply:
            path.unlink(missing_ok=True)
    return report
