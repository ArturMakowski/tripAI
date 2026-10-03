"""Data connectors. Every result is a `SourcedResult` (source + fetched_at) with `.evidence()`.

Set TRIPAI_USE_FIXTURES=1 to serve recorded fixtures (no network, no keys).
"""

from tripai.connectors.base import (
    ConnectorError,
    FixtureNotFound,
    MissingCredentials,
    SourcedResult,
)
from tripai.connectors.cache import DiskCache, LayeredCache, NullCache, SupabaseCache, default_cache
from tripai.connectors.gcal_freebusy import FreeBusyResult, GCalFreeBusy
from tripai.connectors.open_meteo import OpenMeteo, WeatherSummary
from tripai.connectors.serpapi import (
    ExploreDestination,
    ExploreResult,
    FlightPriceInsights,
    HotelOffer,
    HotelSearchResult,
    SerpApiExplore,
    SerpApiFlights,
    SerpApiHotels,
)
from tripai.connectors.travelpayouts import FareQuote, FlightCalendar, Travelpayouts

__all__ = [
    "ConnectorError",
    "DiskCache",
    "ExploreDestination",
    "ExploreResult",
    "FareQuote",
    "FixtureNotFound",
    "FlightCalendar",
    "FlightPriceInsights",
    "FreeBusyResult",
    "GCalFreeBusy",
    "HotelOffer",
    "HotelSearchResult",
    "LayeredCache",
    "MissingCredentials",
    "NullCache",
    "OpenMeteo",
    "SerpApiExplore",
    "SerpApiFlights",
    "SerpApiHotels",
    "SourcedResult",
    "SupabaseCache",
    "Travelpayouts",
    "WeatherSummary",
    "default_cache",
]
