"""SerpApi clients: Google Travel Explore (WHERE), Google Flights price insights, Google Hotels.

Prices are in `currency` (default PLN). SERPAPI_API_KEY required unless TRIPAI_USE_FIXTURES=1.
SerpApi itself caches identical searches for 1h (free); our cache adds per-source TTLs on top.
"""

import re
import statistics
from datetime import UTC, date, datetime
from typing import Any

from pydantic import BaseModel, Field, computed_field

from tripai.connectors import config
from tripai.connectors.base import (
    Connector,
    ConnectorError,
    Fetched,
    MissingCredentials,
    SourcedResult,
)
from tripai.models import Evidence

SEARCH_URL = "https://serpapi.com/search.json"
NO_RESULTS = "hasn't returned any results"


def _validate(payload: Any) -> None:
    err = payload.get("error") if isinstance(payload, dict) else "non-object payload"
    if err and NO_RESULTS not in err:
        raise ConnectorError(f"serpapi: {err}")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _d(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


class _SerpApi(Connector):
    engine: str

    def __init__(
        self, *args: Any, currency: str = "PLN", gl: str = "pl", hl: str = "en", **kw: Any
    ):
        super().__init__(*args, **kw)
        self.currency, self.gl, self.hl = currency, gl, hl

    async def _search(
        self, params: dict[str, Any], fixture: str, match: tuple[str, ...] = ()
    ) -> Fetched:
        key = config.env("SERPAPI_API_KEY")
        if not key and not self.fixtures:
            raise MissingCredentials("SERPAPI_API_KEY not set")
        full = {
            "engine": self.engine,
            "currency": self.currency,
            "gl": self.gl,
            "hl": self.hl,
            **params,
            "api_key": key,
        }
        return await self._fetch(
            f"serpapi:{self.engine}",
            SEARCH_URL,
            full,
            fixture=fixture,
            validate=_validate,
            match=match,
        )


# ---------------------------------------------------------------- explore


class ExploreDestination(BaseModel):
    name: str
    country: str | None = None
    iata: str | None = None
    kgmid: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    flight_price: float | None = None  # return trip, per person
    hotel_price: float | None = None  # per night (as shown by Google Travel Explore)
    flight_duration_min: int | None = None
    stops: int | None = None
    airline: str | None = None
    airline_code: str | None = None
    lat: float | None = None
    lon: float | None = None
    thumbnail: str | None = None
    link: str | None = None


class ExploreResult(SourcedResult):
    origin: str
    currency: str
    destinations: list[ExploreDestination]

    def cheapest(self, n: int | None = None) -> list[ExploreDestination]:
        priced = [d for d in self.destinations if d.flight_price is not None]
        return sorted(priced, key=lambda d: d.flight_price)[:n]

    def evidence(self) -> list[Evidence]:
        out = []
        for d in self.cheapest():
            span = (
                f" {d.start_date:%d %b}–{d.end_date:%d %b}" if d.start_date and d.end_date else ""
            )
            route = f"{self.origin}-{d.iata or d.name}"
            out.append(
                self._ev(
                    "flight",
                    f"Return {route}{span} (Google Travel Explore)",
                    d.flight_price,
                    self.currency,
                    d.link,
                )
            )
        return out


def parse_explore(payload: dict, fetched_at: datetime, origin: str, currency: str) -> ExploreResult:
    dests = []
    for d in payload.get("destinations", []):
        gps = d.get("gps_coordinates") or {}
        dests.append(
            ExploreDestination(
                name=d.get("name", "?"),
                country=d.get("country"),
                iata=(d.get("destination_airport") or {}).get("code"),
                kgmid=d.get("destination_id"),
                start_date=_d(d.get("start_date")),
                end_date=_d(d.get("end_date")),
                flight_price=d.get("flight_price"),
                hotel_price=d.get("hotel_price"),
                flight_duration_min=d.get("flight_duration"),
                stops=d.get("number_of_stops"),
                airline=d.get("airline"),
                airline_code=d.get("airline_code"),
                lat=gps.get("latitude"),
                lon=gps.get("longitude"),
                thumbnail=d.get("thumbnail"),
                link=d.get("link"),
            )
        )
    return ExploreResult(
        source="serpapi:google_travel_explore",
        fetched_at=fetched_at,
        origin=origin,
        currency=currency,
        destinations=dests,
    )


class SerpApiExplore(_SerpApi):
    """Cheapest destinations (+ their dates) from an origin. Flexible dates: `month` (1-12, only
    the next 6 months) + `travel_duration` (1 weekend, 2 one week, 3 two weeks); or fixed dates."""

    engine = "google_travel_explore"

    async def explore(
        self,
        origin: str = "KRK",
        *,
        month: int | None = None,
        travel_duration: int | None = None,
        outbound_date: date | None = None,
        return_date: date | None = None,
        arrival_area_id: str | None = None,
        interest: str | None = None,
        max_price: int | None = None,
    ) -> ExploreResult:
        params = {
            "departure_id": origin,
            "month": month,
            "travel_duration": travel_duration,
            "outbound_date": outbound_date.isoformat() if outbound_date else None,
            "return_date": return_date.isoformat() if return_date else None,
            "arrival_area_id": arrival_area_id,
            "interest": interest,
            "max_price": max_price,
        }
        params = {k: v for k, v in params.items() if v is not None}
        f = await self._search(
            params,
            fixture=origin,
            match=("month", "travel_duration", "outbound_date", "return_date"),
        )
        res = parse_explore(f.payload, f.fetched_at, origin, self.currency)
        res.synthetic = f.synthetic
        return res


# ---------------------------------------------------------------- flights


class FlightSegment(BaseModel):
    """One leg of an itinerary as Google Flights lists it (times are local, "YYYY-MM-DD HH:MM")."""

    airline: str
    flight_number: str | None = None
    from_iata: str | None = None
    from_name: str | None = None
    to_iata: str | None = None
    to_name: str | None = None
    depart: str | None = None
    arrive: str | None = None
    duration_min: int | None = None


class FlightOption(BaseModel):
    price: float | None
    airlines: list[str]
    flight_numbers: list[str]
    stops: int
    total_duration_min: int | None = None
    departure_time: str | None = None  # local "YYYY-MM-DD HH:MM"
    arrival_time: str | None = None
    legs: list[FlightSegment] = Field(default_factory=list)  # outbound legs (round trips too)


class FlightPriceInsights(SourcedResult):
    origin: str
    destination: str
    outbound_date: date
    return_date: date | None
    currency: str
    lowest_price: float | None
    price_level: str | None = None  # "low" | "typical" | "high"
    typical_price_range: tuple[float, float] | None = None
    price_history: list[tuple[date, float]] = Field(default_factory=list)
    options: list[FlightOption] = Field(default_factory=list)
    url: str | None = None

    def evidence(self) -> list[Evidence]:
        span = f"{self.outbound_date:%d %b}" + (
            f"–{self.return_date:%d %b}" if self.return_date else ""
        )
        kind = "Return" if self.return_date else "One-way"
        route = f"{self.origin}-{self.destination}"
        out = []
        if self.lowest_price is not None:
            out.append(
                self._ev(
                    "flight",
                    f"{kind} {route} {span} lowest (Google Flights)",
                    self.lowest_price,
                    self.currency,
                    self.url,
                )
            )
        if self.price_level:
            typical = ""
            if self.typical_price_range:
                lo, hi = self.typical_price_range
                typical = f", typical {lo:.0f}–{hi:.0f} {self.currency}"
            out.append(
                self._ev(
                    "flight",
                    f"Google price level for {route} {span}{typical}",
                    self.price_level,
                    None,
                    self.url,
                )
            )
        return out


def _option(item: dict) -> FlightOption:
    legs = item.get("flights", [])
    return FlightOption(
        price=item.get("price"),
        airlines=list(dict.fromkeys(leg.get("airline", "?") for leg in legs)),
        flight_numbers=[leg["flight_number"] for leg in legs if leg.get("flight_number")],
        stops=max(len(legs) - 1, 0),
        total_duration_min=item.get("total_duration"),
        departure_time=(legs[0].get("departure_airport") or {}).get("time") if legs else None,
        arrival_time=(legs[-1].get("arrival_airport") or {}).get("time") if legs else None,
        legs=[
            FlightSegment(
                airline=leg.get("airline", "?"),
                flight_number=leg.get("flight_number"),
                from_iata=(leg.get("departure_airport") or {}).get("id"),
                from_name=(leg.get("departure_airport") or {}).get("name"),
                to_iata=(leg.get("arrival_airport") or {}).get("id"),
                to_name=(leg.get("arrival_airport") or {}).get("name"),
                depart=(leg.get("departure_airport") or {}).get("time"),
                arrive=(leg.get("arrival_airport") or {}).get("time"),
                duration_min=leg.get("duration"),
            )
            for leg in legs
        ],
    )


def parse_flights(
    payload: dict,
    fetched_at: datetime,
    origin: str,
    destination: str,
    outbound: date,
    return_date: date | None,
    currency: str,
) -> FlightPriceInsights:
    options = [
        _option(i) for i in payload.get("best_flights", []) + payload.get("other_flights", [])
    ]
    options.sort(key=lambda o: o.price if o.price is not None else float("inf"))
    pi = payload.get("price_insights") or {}
    lowest = pi.get("lowest_price")
    if lowest is None and options and options[0].price is not None:
        lowest = options[0].price
    rng = pi.get("typical_price_range")
    return FlightPriceInsights(
        source="serpapi:google_flights",
        fetched_at=fetched_at,
        origin=origin,
        destination=destination,
        outbound_date=outbound,
        return_date=return_date,
        currency=currency,
        lowest_price=lowest,
        price_level=pi.get("price_level"),
        typical_price_range=tuple(rng) if rng and len(rng) == 2 else None,
        price_history=[
            (datetime.fromtimestamp(ts, UTC).date(), price)
            for ts, price in pi.get("price_history", [])
        ],
        options=options[:5],
        url=(payload.get("search_metadata") or {}).get("google_flights_url"),
    )


class SerpApiFlights(_SerpApi):
    engine = "google_flights"

    async def price_insights(
        self,
        origin: str,
        destination: str,
        outbound_date: date,
        return_date: date | None = None,
        *,
        adults: int = 1,
        stops: int | None = None,
    ) -> FlightPriceInsights:
        params = {
            # one city's airports in one search: "WAW,WMI" (Google Flights takes a comma list)
            "departure_id": origin,
            "arrival_id": destination,
            "type": 1 if return_date else 2,
            "outbound_date": outbound_date.isoformat(),
            "return_date": return_date.isoformat() if return_date else None,
            "adults": adults,
            "stops": stops,
        }
        params = {k: v for k, v in params.items() if v is not None}
        f = await self._search(
            params,
            # fixture name: the group's first airport; `match` still requires the recorded
            # departure_id, so KRK data is never served as a WAW,WMI search
            fixture=f"{origin.split(',')[0]}-{destination}",
            match=("departure_id", "arrival_id", "outbound_date", "return_date"),
        )
        payload, fetched_at = f.payload, f.fetched_at
        res = parse_flights(
            payload, fetched_at, origin, destination, outbound_date, return_date, self.currency
        )
        res.synthetic = f.synthetic
        return res


# ---------------------------------------------------------------- hotels


class Transportation(BaseModel):
    type: str  # Google's label: "Taxi" | "Public transport" | "Walking" | ...
    duration: str | None = None  # e.g. "52 min", "1 hr 5 min"


class NearbyPlace(BaseModel):
    name: str
    transportations: list[Transportation] = Field(default_factory=list)


class HotelOffer(BaseModel):
    name: str
    type: str | None = None  # "hotel" | "vacation rental"
    price_per_night: float | None = None
    total_price: float | None = None
    rating: float | None = None
    reviews: int | None = None
    hotel_class: int | None = None
    lat: float | None = None
    lon: float | None = None
    link: str | None = None
    property_token: str | None = None
    address: str | None = None
    thumbnail: str | None = None
    nearby: list[NearbyPlace] = Field(default_factory=list)  # Google's travel times to places


class HotelSearchResult(SourcedResult):
    city: str
    check_in: date
    check_out: date
    adults: int
    currency: str
    offers: list[HotelOffer]

    @computed_field
    @property
    def nights(self) -> int:
        return max((self.check_out - self.check_in).days, 1)

    @computed_field
    @property
    def median_nightly(self) -> float | None:
        prices = [o.price_per_night for o in self.offers if o.price_per_night is not None]
        return round(statistics.median(prices), 0) if prices else None

    def cheapest(self, min_rating: float = 0.0) -> HotelOffer | None:
        ok = [
            o
            for o in self.offers
            if o.price_per_night is not None and (o.rating or 0) >= min_rating
        ]
        return min(ok, key=lambda o: o.price_per_night) if ok else None

    def evidence(self) -> list[Evidence]:
        span = f"{self.check_in:%d %b}–{self.check_out:%d %b}"
        out = []
        if self.median_nightly is not None:
            n = sum(o.price_per_night is not None for o in self.offers)
            out.append(
                self._ev(
                    "hotel",
                    f"Median hotel price/night {self.city} {span} ({n} offers, {self.adults} adults)",
                    self.median_nightly,
                    self.currency,
                )
            )
        best = self.cheapest(min_rating=4.0)
        if best is not None:
            out.append(
                self._ev(
                    "hotel",
                    f"Cheapest ≥4.0★ rated: {best.name} ({best.rating}) per night",
                    best.price_per_night,
                    self.currency,
                    best.link,
                )
            )
        return out


def parse_hotels(
    payload: dict,
    fetched_at: datetime,
    city: str,
    check_in: date,
    check_out: date,
    adults: int,
    currency: str,
) -> HotelSearchResult:
    offers = []
    for p in payload.get("properties", []):
        gps = p.get("gps_coordinates") or {}
        offers.append(
            HotelOffer(
                name=p.get("name", "?"),
                type=p.get("type"),
                price_per_night=(p.get("rate_per_night") or {}).get("extracted_lowest"),
                total_price=(p.get("total_rate") or {}).get("extracted_lowest"),
                rating=p.get("overall_rating"),
                reviews=p.get("reviews"),
                hotel_class=p.get("extracted_hotel_class"),
                lat=gps.get("latitude"),
                lon=gps.get("longitude"),
                link=p.get("link"),
                property_token=p.get("property_token"),
                address=p.get("address"),
                thumbnail=((p.get("images") or [{}])[0] or {}).get("thumbnail"),
                nearby=[
                    NearbyPlace(
                        name=n["name"],
                        transportations=[
                            Transportation(type=t["type"], duration=t.get("duration"))
                            for t in n.get("transportations") or []
                            if t.get("type")
                        ],
                    )
                    for n in p.get("nearby_places") or []
                    if n.get("name")
                ],
            )
        )
    return HotelSearchResult(
        source="serpapi:google_hotels",
        fetched_at=fetched_at,
        city=city,
        check_in=check_in,
        check_out=check_out,
        adults=adults,
        currency=currency,
        offers=offers,
    )


class SerpApiHotels(_SerpApi):
    engine = "google_hotels"

    async def search(
        self,
        city: str,
        check_in: date,
        check_out: date,
        *,
        adults: int = 2,
        iata: str | None = None,
        hotel_class: list[int] | None = None,
        min_rating: int | None = None,  # SerpApi code: 7 = 3.5+, 8 = 4.0+, 9 = 4.5+
        sort_by: int | None = None,  # 3 lowest price, 8 highest rating, 13 most reviewed
    ) -> HotelSearchResult:
        params = {
            "q": f"{city} hotels",
            "check_in_date": check_in.isoformat(),
            "check_out_date": check_out.isoformat(),
            "adults": adults,
            "hotel_class": ",".join(map(str, hotel_class)) if hotel_class else None,
            "rating": min_rating,
            "sort_by": sort_by,
        }
        params = {k: v for k, v in params.items() if v is not None}
        f = await self._search(
            params, fixture=iata or _slug(city), match=("check_in_date", "check_out_date", "adults")
        )
        res = parse_hotels(
            f.payload, f.fetched_at, city, check_in, check_out, adults, self.currency
        )
        res.synthetic = f.synthetic
        return res
