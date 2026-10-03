"""Demo route set used by the probe CLI and recorded fixtures (seed lane owns the full city list)."""

from typing import NamedTuple


class Place(NamedTuple):
    iata: str
    city: str
    country: str
    lat: float
    lon: float


ORIGIN = Place("KRK", "Kraków", "Poland", 50.06, 19.94)

DESTINATIONS: list[Place] = [
    Place("FCO", "Rome", "Italy", 41.90, 12.50),
    Place("LIS", "Lisbon", "Portugal", 38.72, -9.14),
    Place("BCN", "Barcelona", "Spain", 41.39, 2.17),
    Place("ATH", "Athens", "Greece", 37.98, 23.73),
    Place("VIE", "Vienna", "Austria", 48.21, 16.37),
    Place("PRG", "Prague", "Czechia", 50.08, 14.44),
    Place("BUD", "Budapest", "Hungary", 47.50, 19.04),
    Place("NAP", "Naples", "Italy", 40.85, 14.27),
    Place("MLA", "Valletta", "Malta", 35.90, 14.51),
    Place("OPO", "Porto", "Portugal", 41.15, -8.61),
]

BY_IATA = {p.iata: p for p in [ORIGIN, *DESTINATIONS]}
