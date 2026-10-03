"""Trip details (docs/TRIP_DETAILS.md): the concrete flight and stay behind a card's prices.

Pure mapping from connector results to the shared contract (`FlightDetails`, `HotelDetails`,
`TransferOption`). The caller passes exactly the itinerary/property it priced, so what is shown
is what was priced. Unknown stays None; nothing here is guessed.
"""

import math
import re
from datetime import datetime

from tripai import i18n
from tripai.connectors.serpapi import ExploreDestination, FlightOption, HotelOffer
from tripai.connectors.travelpayouts import FareQuote
from tripai.models import FlightDetails, FlightLeg, GeoPoint, HotelDetails, TransferOption
from tripai.seed import load

HAVERSINE_SOURCE = "estimate:haversine"
# Google's nearby_places transport labels -> TransferOption.mode
MODES = {
    "taxi": "taxi",
    "public transport": "public_transport",
    "walking": "walk",
    "walk": "walk",
    "driving": "drive",
    "car": "drive",
    "train": "train",
    "bus": "bus",
}
AIRPORT_WORDS = ("airport", "lotnisko", "aeroporto", "aeropuerto", "aéroport", "flughafen")


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def parse_duration_min(text: str | None) -> int | None:
    """Google's "52 min", "1 hr 5 min", "2 hrs" -> minutes."""
    if not text:
        return None
    h = re.search(r"(\d+)\s*h", text)
    m = re.search(r"(\d+)\s*min", text)
    if not h and not m:
        return None
    return (int(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0)


def _local(text: str | None) -> datetime | None:
    try:
        # contract: local time at the airport (FlightLeg.depart_at), so deliberately naive
        return datetime.strptime(text, "%Y-%m-%d %H:%M") if text else None  # noqa: DTZ007
    except ValueError:
        return None


# ---------------------------------------------------------------- flights


def flight_from_option(
    opt: FlightOption, source: str, fetched_at: datetime, url: str | None
) -> FlightDetails | None:
    """Google Flights itinerary (exact dates). Round-trip searches list the outbound only;
    the return leg would need a second (departure_token) search, so `inbound` stays empty.
    A leg without both airport codes means we can't show the itinerary: None, not "?"."""
    if not opt.legs or any(not (leg.from_iata and leg.to_iata) for leg in opt.legs):
        return None
    return FlightDetails(
        outbound=[
            FlightLeg(
                airline=leg.airline,
                flight_number=leg.flight_number,
                from_iata=leg.from_iata,
                to_iata=leg.to_iata,
                depart_at=_local(leg.depart),
                arrive_at=_local(leg.arrive),
                duration_min=leg.duration_min,
            )
            for leg in opt.legs
        ],
        stops_outbound=opt.stops,
        price_pln=opt.price,
        booking_url=url,
        source=source,
        fetched_at=fetched_at,
    )


def flight_from_fare(
    fare: FareQuote, origin: str, source: str, fetched_at: datetime
) -> FlightDetails | None:
    """Travelpayouts cached fare (fast phase / cheap pass): airline code only, times null.
    Only what Aviasales states: the airport it lands at (`destination_airport`) - never the
    requested city code - and no return leg (Aviasales doesn't say which flight that is)."""
    if not fare.airline or not fare.destination_airport:
        return None
    return FlightDetails(
        outbound=[
            FlightLeg(
                airline=fare.airline,
                from_iata=fare.origin_airport or origin,
                to_iata=fare.destination_airport,
            )
        ],
        stops_outbound=fare.transfers,
        stops_inbound=fare.return_transfers,
        price_pln=fare.price,
        booking_url=fare.link,
        source=source,
        fetched_at=fetched_at,
    )


def flight_from_explore(
    e: ExploreDestination, origin: str, source: str, fetched_at: datetime
) -> FlightDetails | None:
    if not e.airline or not e.iata:
        return None
    return FlightDetails(
        outbound=[FlightLeg(airline=e.airline, from_iata=origin, to_iata=e.iata)],
        stops_outbound=e.stops,
        price_pln=e.flight_price,
        booking_url=e.link,
        source=source,
        fetched_at=fetched_at,
    )


# ---------------------------------------------------------------- hotels


def pick_offer(offers: list[HotelOffer], quantile: float) -> tuple[HotelOffer, int] | None:
    """The real property at the luxury quantile (nearest rank by nightly price) and how many
    priced offers it was chosen from. Pricing uses *this* property, so it is what we show."""
    priced = sorted(
        (o for o in offers if o.price_per_night is not None),
        key=lambda o: (o.price_per_night, o.name),
    )
    if not priced:
        return None
    return priced[round(quantile * (len(priced) - 1))], len(priced)


def stay_cost(offer: HotelOffer, nights: int) -> float:
    """Google's total for the stay when given, else nightly x nights."""
    if offer.total_price is not None:
        return offer.total_price
    return offer.price_per_night * nights  # type: ignore[operator]


_STOP = {
    "airport", "international", "intl", "the", "of", "de", "di", "da", "del", "la", "le", "el",
    "il", "aeropuerto", "aeroporto", "aéroport", "flughafen", "lotnisko", "city",
}  # fmt: skip


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[^\W\d_]+", text.lower()) if len(t) >= 4 and t not in _STOP}


def distinctive_tokens(airport_iata: str, city: load.City) -> set[str]:
    """Words of this airport's (seed) name that no other airport of the city shares - and, in
    multi-airport cities, not the city's own name ("Milan Linate" must not match Malpensa)."""
    ap = load.airport(airport_iata)
    if ap is None:
        return set()
    others: set[str] = set()
    for code in city.airports:
        if code != airport_iata and (o := load.airport(code)) is not None:
            others |= _tokens(o.name)
    if len(city.airports) > 1:
        others |= _tokens(city.name)
    return _tokens(ap.name) - others


def google_transfers(
    offer: HotelOffer,
    airport_name: str | None,
    airport_iata: str | None,
    city: load.City,
    source: str,
    fetched_at: datetime,
) -> list[TransferOption]:
    """Airport -> hotel travel times Google lists for this property, only for the airport the
    priced flight lands at: Google's own airport name, or a place whose name carries a word
    distinctive to that airport. Anything else (another airport, an unknown landing) -> []."""
    places = [p for p in offer.nearby if p.transportations]
    match = None
    if airport_name:
        match = next((p for p in places if p.name.lower() == airport_name.lower()), None)
    if match is None and airport_iata:
        key = distinctive_tokens(airport_iata, city)
        tied = [
            p
            for p in places
            if any(w in p.name.lower() for w in AIRPORT_WORDS) and key & _tokens(p.name)
        ]
        match = tied[0] if len(tied) == 1 else None  # ambiguous -> don't guess
    if match is None:
        return []
    return [
        TransferOption(
            mode=MODES.get(t.type.lower(), t.type.lower().replace(" ", "_")),
            duration_min=parse_duration_min(t.duration),
            note=match.name,
            source=source,
            fetched_at=fetched_at,
        )
        for t in match.transportations
    ]


def drive_transfer(duration_min: int, distance_km: float, fetched_at: datetime) -> TransferOption:
    return TransferOption(
        mode="drive",
        duration_min=duration_min,
        distance_km=distance_km,
        note=i18n.t("transfer.osrm"),
        source="osrm:route",
        fetched_at=fetched_at,
    )


def hotel_details(
    offer: HotelOffer,
    total: float,
    city: load.City,
    airport_iata: str | None,
    airport_name: str | None,
    source: str,
    fetched_at: datetime,
) -> HotelDetails:
    loc = (
        GeoPoint(lat=offer.lat, lon=offer.lon, label=offer.name)
        if offer.lat is not None and offer.lon is not None
        else None
    )
    ap = load.airport(airport_iata) if airport_iata else None
    return HotelDetails(
        name=offer.name,
        address=offer.address,
        location=loc,
        rating=offer.rating,
        reviews=offer.reviews,
        stars=offer.hotel_class,
        price_pln_total=total,
        distance_to_center_km=(
            round(haversine_km(loc.lat, loc.lon, city.lat, city.lon), 1) if loc else None
        ),
        airport=(GeoPoint(lat=ap.lat, lon=ap.lon, label=airport_name or ap.name) if ap else None),
        city_center=GeoPoint(lat=city.lat, lon=city.lon, label=city.name),
        transfers=google_transfers(offer, airport_name, airport_iata, city, source, fetched_at),
        booking_url=offer.link,
        photo_url=offer.thumbnail,
        source=source,
        fetched_at=fetched_at,
    )
