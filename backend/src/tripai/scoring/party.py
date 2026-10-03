"""Party pricing (docs/BUDGET.md "Party pricing"): the one money model for groups.

- `flight_cost_pln`: per traveller (one return ticket).
- `hotel_cost_pln`: the TOTAL for the room(s) for the stay (rooms x price per room).
- `rooms`: `TasteProfile.rooms`, default ceil(travellers / 2).
- `party_total_pln = flight_cost_pln x travellers + hotel_cost_pln`.
- `per_person_pln = party_total_pln / travellers`; `total_cost_pln == per_person_pln`.
With one traveller in one room everything reduces to total = flight + hotel."""

import math

from tripai.models import TasteProfile


def travelers(profile: TasteProfile | None) -> int:
    if profile is None:
        return 1
    return max(1, profile.adults + profile.children)


def rooms(profile: TasteProfile | None) -> int:
    n = travelers(profile)
    if profile is not None and profile.rooms:
        return max(1, profile.rooms)
    return max(1, math.ceil(n / 2))


def hotel_total(room_price: float, profile: TasteProfile | None) -> float:
    """The stay for the whole party: price per room x rooms."""
    return room_price * rooms(profile)


def party_total(flight_pp: float, hotel_total_pln: float, n: int) -> float:
    return flight_pp * n + hotel_total_pln


def per_person(flight_pp: float, hotel_total_pln: float, n: int) -> float:
    return party_total(flight_pp, hotel_total_pln, n) / max(1, n)
