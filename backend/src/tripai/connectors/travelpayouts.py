"""Travelpayouts / Aviasales Data API v3: price calendar per route (WHEN).

Prices are cached Aviasales user searches (last 48h, kept ≤7 days) — indicative, not bookable.
TRAVELPAYOUTS_TOKEN required unless TRIPAI_USE_FIXTURES=1. Currency defaults to RUB upstream, so
we always send `currency=pln`.
"""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel

from tripai.connectors import config
from tripai.connectors.base import Connector, ConnectorError, MissingCredentials, SourcedResult
from tripai.models import Evidence

BASE = "https://api.travelpayouts.com/aviasales/v3"
LINK_BASE = "https://www.aviasales.com"


def _validate(payload: Any) -> None:
    if not isinstance(payload, dict) or not payload.get("success", False):
        err = payload.get("error") if isinstance(payload, dict) else payload
        raise ConnectorError(f"travelpayouts: {err or 'success=false'}")


def _month_or_day(value: date | str | None) -> str | None:
    if value is None or isinstance(value, str):
        return value
    return value.isoformat()


class FareQuote(BaseModel):
    origin: str
    destination: str
    origin_airport: str | None = None
    destination_airport: str | None = None
    price: float
    airline: str | None = None
    flight_number: str | None = None
    departure_at: datetime
    return_at: datetime | None = None
    transfers: int | None = None
    return_transfers: int | None = None
    duration_min: int | None = None
    link: str | None = None

    @property
    def nights(self) -> int | None:
        return (self.return_at.date() - self.departure_at.date()).days if self.return_at else None


class FlightCalendar(SourcedResult):
    origin: str
    destination: str
    currency: str
    query: dict[str, Any]
    fares: list[FareQuote]

    def cheapest(self) -> FareQuote | None:
        return min(self.fares, key=lambda f: f.price) if self.fares else None

    def by_departure_day(self) -> dict[date, FareQuote]:
        out: dict[date, FareQuote] = {}
        for f in sorted(self.fares, key=lambda f: f.price, reverse=True):
            out[f.departure_at.date()] = f
        return dict(sorted(out.items()))

    def evidence(self) -> list[Evidence]:
        c = self.cheapest()
        if c is None:
            return []
        kind = "return" if c.return_at else "one-way"
        dates = f"{c.departure_at:%d %b}" + (f"–{c.return_at:%d %b}" if c.return_at else "")
        stops = "direct" if not c.transfers else f"{c.transfers} stop(s)"
        return [
            self._ev(
                "flight",
                f"Cheapest {kind} {self.origin}-{self.destination} {dates}, {c.airline} {stops} "
                "(Aviasales cached fare, not bookable)",
                c.price,
                self.currency,
                c.link,
            )
        ]


def _fare(item: dict) -> FareQuote:
    return FareQuote(
        origin=item["origin"],
        destination=item["destination"],
        origin_airport=item.get("origin_airport"),
        destination_airport=item.get("destination_airport"),
        price=item["price"],
        airline=item.get("airline"),
        flight_number=str(item["flight_number"]) if item.get("flight_number") is not None else None,
        departure_at=datetime.fromisoformat(item["departure_at"]),
        return_at=datetime.fromisoformat(item["return_at"]) if item.get("return_at") else None,
        transfers=item.get("transfers"),
        return_transfers=item.get("return_transfers"),
        duration_min=item.get("duration"),
        link=LINK_BASE + link if (link := item.get("link") or "").startswith("/") else link or None,
    )


def parse_calendar(
    payload: dict, fetched_at: datetime, source: str, origin: str, destination: str, query: dict
) -> FlightCalendar:
    data = payload.get("data") or []
    items = list(data.values()) if isinstance(data, dict) else data
    return FlightCalendar(
        source=source,
        fetched_at=fetched_at,
        origin=origin,
        destination=destination,
        currency=(payload.get("currency") or query.get("currency", "")).upper(),
        query=query,
        fares=sorted((_fare(i) for i in items), key=lambda f: f.departure_at),
    )


class Travelpayouts(Connector):
    def __init__(self, *args: Any, currency: str = "pln", market: str | None = None, **kw: Any):
        super().__init__(*args, **kw)
        self.currency, self.market = currency.lower(), market

    async def _get(
        self, endpoint: str, origin: str, destination: str, params: dict, fixture: str
    ) -> FlightCalendar:
        token = config.env("TRAVELPAYOUTS_TOKEN")
        if not token and not self.fixtures:
            raise MissingCredentials("TRAVELPAYOUTS_TOKEN not set")
        query = {
            "origin": origin,
            "destination": destination,
            "currency": self.currency,
            "market": self.market,
            **params,
        }
        query = {k: v for k, v in query.items() if v is not None}
        source = f"travelpayouts:{endpoint}"
        f = await self._fetch(
            source,
            f"{BASE}/{endpoint}",
            query,
            fixture=fixture,
            headers={"X-Access-Token": token or "", "Accept-Encoding": "gzip, deflate"},
            validate=_validate,
            match=("departure_at", "return_at"),
        )
        res = parse_calendar(f.payload, f.fetched_at, source, origin, destination, query)
        res.synthetic = f.synthetic
        return res

    async def month_calendar(
        self,
        origin: str,
        destination: str,
        month: str,
        *,
        trip_days: tuple[int, int] | None = (3, 7),
        direct: bool = False,
    ) -> FlightCalendar:
        """Cheapest fare per departure day in `month` ("YYYY-MM"). `trip_days` → round trips with
        that many nights (returning in the same month); None → one-way."""
        params: dict[str, Any] = {
            "departure_at": month,
            "group_by": "departure_at",
            "direct": str(direct).lower(),
        }
        if trip_days:
            params |= {
                "return_at": month,
                "min_trip_duration": trip_days[0],
                "max_trip_duration": trip_days[1],
            }
        return await self._get(
            "grouped_prices", origin, destination, params, fixture=f"{origin}-{destination}"
        )

    async def prices_for_dates(
        self,
        origin: str,
        destination: str,
        departure: date | str,
        return_: date | str | None = None,
        *,
        direct: bool = False,
        limit: int = 30,
    ) -> FlightCalendar:
        """Offers for exact days (date) or whole months ("YYYY-MM"), sorted by price."""
        params = {
            "departure_at": _month_or_day(departure),
            "return_at": _month_or_day(return_),
            "one_way": "false" if return_ else "true",
            "direct": str(direct).lower(),
            "sorting": "price",
            "limit": limit,
        }
        return await self._get(
            "prices_for_dates", origin, destination, params, fixture=f"{origin}-{destination}"
        )
