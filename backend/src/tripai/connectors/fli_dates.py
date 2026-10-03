"""Optional fallback when SerpApi quota is gone: cheapest round-trip price per departure day via
the reverse-engineered Google Flights client `fli` (sync → run in a thread).

Not a project dependency (PyPI 0.9.0 is broken as of 2026-10; GitHub main works):
    uv pip install "flights @ git+https://github.com/punitarani/fli@881aee5ff4321e81ea2157cb44be94ce6a21dc1b"
`fli` returns no currency (observed values look like USD), so prices carry currency "USD?".
"""

import asyncio
from datetime import UTC, date, datetime, timedelta

from pydantic import BaseModel

from tripai.connectors.base import ConnectorError, SourcedResult
from tripai.models import Evidence


class DayPrice(BaseModel):
    departure: date
    return_date: date | None
    price: float


class FliDateSearch(SourcedResult):
    origin: str
    destination: str
    currency: str
    nights: int
    prices: list[DayPrice]

    def cheapest(self) -> DayPrice | None:
        return min(self.prices, key=lambda p: p.price) if self.prices else None

    def evidence(self) -> list[Evidence]:
        c = self.cheapest()
        if c is None:
            return []
        return [
            self._ev(
                "flight",
                f"Cheapest return {self.origin}-{self.destination} dep {c.departure:%d %b}, "
                f"{self.nights} nights (Google Flights via fli)",
                c.price,
                self.currency,
            )
        ]


def _search_sync(origin: str, destination: str, start: date, end: date, nights: int) -> list:
    try:
        from fli.models import (
            Airport,
            DateSearchFilters,
            FlightSegment,
            MaxStops,
            PassengerInfo,
            SeatType,
            TripType,
        )
        from fli.search import SearchDates
    except ImportError as exc:
        raise ConnectorError(
            "fli not installed (see tripai.connectors.fli_dates docstring)"
        ) from exc
    try:
        dep, arr = Airport[origin], Airport[destination]
    except KeyError as exc:
        raise ConnectorError(f"fli does not know airport {exc}") from exc
    ret = start + timedelta(days=nights)
    filters = DateSearchFilters(
        trip_type=TripType.ROUND_TRIP,
        passenger_info=PassengerInfo(adults=1),
        flight_segments=[
            FlightSegment(
                departure_airport=[[dep, 0]],
                arrival_airport=[[arr, 0]],
                travel_date=start.isoformat(),
            ),
            FlightSegment(
                departure_airport=[[arr, 0]],
                arrival_airport=[[dep, 0]],
                travel_date=ret.isoformat(),
            ),
        ],
        stops=MaxStops.ANY,
        seat_type=SeatType.ECONOMY,
        from_date=start.isoformat(),
        to_date=end.isoformat(),
        duration=nights,
    )
    return SearchDates().search(filters) or []


async def search_dates(
    origin: str, destination: str, start: date, end: date, nights: int = 5
) -> FliDateSearch:
    try:
        rows = await asyncio.to_thread(_search_sync, origin, destination, start, end, nights)
    except ConnectorError:
        raise
    except Exception as exc:  # fli raises assorted errors when Google changes things
        raise ConnectorError(f"fli search failed: {exc}") from exc
    prices = [
        DayPrice(
            departure=r.date[0].date(),
            return_date=r.date[1].date() if len(r.date) > 1 else None,
            price=r.price,
        )
        for r in rows
    ]
    currency = next((r.currency for r in rows if getattr(r, "currency", None)), None) or "USD?"
    return FliDateSearch(
        source="google_flights_via_fli",
        fetched_at=datetime.now(UTC),
        origin=origin,
        destination=destination,
        currency=currency,
        nights=nights,
        prices=sorted(prices, key=lambda p: p.departure),
    )
