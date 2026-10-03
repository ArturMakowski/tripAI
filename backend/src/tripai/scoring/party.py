"""Party pricing (docs/BUDGET.md): flights x travellers, hotel per room x rooms.

Providers price a flight per person and a hotel per room (double) for the stay. A card's
`flight_cost_pln + hotel_cost_pln` (= `total_cost_pln`) is **per person**: the flight plus this
person's share of the rooms. The group total is per person x travellers."""

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


def hotel_share(room_total: float, profile: TasteProfile | None) -> float:
    """One person's share of the stay: rooms x price per room / travellers."""
    return room_total * rooms(profile) / travelers(profile)


def party_total(per_person: float, profile: TasteProfile | None) -> float:
    return per_person * travelers(profile)
