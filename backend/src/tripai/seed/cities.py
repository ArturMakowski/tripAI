"""Candidate destination cities → data/cities.json.

Hand-curated (no API): coordinates, airport IATA codes, NUTS2 region (Eurostat NUTS 2024, used to join
crowds), taste tags with 0..1 weights, and an approximate set of Polish origins with direct flights.
Tag weights and `direct_from` are editorial priors, not facts: live prices come from connectors.

    uv run python -m tripai.seed.cities
"""

from typing import Any

from tripai.seed._common import meta, write_json

TAGS = ("food", "history", "art", "beach", "nature", "hiking", "nightlife", "ski")
ORIGINS = ("KRK", "KTW", "WAW", "GDN")
ALL = ORIGINS

# id, name, country, iata, airports, lat, lon, nuts2, direct_from, radius_km, tags
_C = tuple[str, str, str, str, list[str], float, float, str, tuple[str, ...], int, dict[str, float]]
# fmt: off
_CITIES: list[_C] = [
    ("rome", "Rome", "IT", "FCO", ["FCO", "CIA"], 41.8967, 12.4822, "ITI4", ALL, 6,
     {"food": 0.95, "history": 1.0, "art": 0.95, "nightlife": 0.6, "nature": 0.2}),
    ("milan", "Milan", "IT", "MXP", ["MXP", "BGY", "LIN"], 45.4642, 9.19, "ITC4", ALL, 6,
     {"food": 0.85, "history": 0.6, "art": 0.85, "nightlife": 0.75, "nature": 0.3, "ski": 0.3}),
    ("naples", "Naples", "IT", "NAP", ["NAP"], 40.8518, 14.2681, "ITF3", ("KRK", "KTW", "WAW"), 12,
     {"food": 1.0, "history": 0.9, "art": 0.6, "beach": 0.5, "hiking": 0.5, "nature": 0.6,
      "nightlife": 0.5}),
    ("venice", "Venice", "IT", "VCE", ["VCE", "TSF"], 45.4381, 12.3358, "ITH3", ("KTW", "WAW"), 5,
     {"food": 0.7, "history": 0.95, "art": 0.95, "nature": 0.2, "nightlife": 0.3}),
    ("catania", "Catania", "IT", "CTA", ["CTA"], 37.5079, 15.083, "ITG1", ALL, 30,
     {"food": 0.9, "history": 0.7, "art": 0.4, "beach": 0.75, "nature": 0.85, "hiking": 0.8,
      "nightlife": 0.5}),
    ("barcelona", "Barcelona", "ES", "BCN", ["BCN"], 41.3874, 2.1686, "ES51", ALL, 7,
     {"food": 0.95, "history": 0.75, "art": 0.95, "beach": 0.7, "nightlife": 0.95,
      "nature": 0.3, "hiking": 0.3}),
    ("madrid", "Madrid", "ES", "MAD", ["MAD"], 40.4168, -3.7038, "ES30", ("KRK", "WAW", "KTW"), 7,
     {"food": 0.9, "history": 0.75, "art": 1.0, "nightlife": 0.9, "nature": 0.2}),
    ("malaga", "Málaga", "ES", "AGP", ["AGP"], 36.7213, -4.4214, "ES61", ALL, 12,
     {"food": 0.85, "history": 0.65, "art": 0.7, "beach": 0.9, "nature": 0.5, "hiking": 0.5,
      "nightlife": 0.7}),
    ("valencia", "Valencia", "ES", "VLC", ["VLC"], 39.4699, -0.3763, "ES52", ("KRK", "WAW", "KTW"), 8,
     {"food": 0.95, "history": 0.6, "art": 0.65, "beach": 0.85, "nature": 0.35,
      "nightlife": 0.7}),
    ("palma", "Palma de Mallorca", "ES", "PMI", ["PMI"], 39.5696, 2.6502, "ES53", ALL, 25,
     {"food": 0.7, "history": 0.5, "art": 0.4, "beach": 1.0, "nature": 0.75, "hiking": 0.75,
      "nightlife": 0.75}),
    ("tenerife", "Tenerife", "ES", "TFS", ["TFS", "TFN"], 28.2916, -16.6291, "ES70", ALL, 40,
     {"food": 0.5, "history": 0.2, "beach": 0.9, "nature": 1.0, "hiking": 0.95,
      "nightlife": 0.5}),
    ("lisbon", "Lisbon", "PT", "LIS", ["LIS"], 38.7223, -9.1393, "PT1A", ALL, 15,
     {"food": 0.9, "history": 0.85, "art": 0.75, "beach": 0.65, "nature": 0.4, "hiking": 0.3,
      "nightlife": 0.8}),
    ("porto", "Porto", "PT", "OPO", ["OPO"], 41.1579, -8.6291, "PT11", ALL, 8,
     {"food": 0.95, "history": 0.75, "art": 0.6, "beach": 0.45, "nature": 0.4,
      "nightlife": 0.65}),
    ("funchal", "Funchal (Madeira)", "PT", "FNC", ["FNC"], 32.6669, -16.9241, "PT30",
     ("WAW", "KRK", "KTW"), 25,
     {"food": 0.6, "history": 0.3, "beach": 0.4, "nature": 1.0, "hiking": 1.0,
      "nightlife": 0.3}),
    ("paris", "Paris", "FR", "CDG", ["CDG", "ORY", "BVA"], 48.8566, 2.3522, "FR10", ALL, 7,
     {"food": 0.95, "history": 0.9, "art": 1.0, "nightlife": 0.85, "nature": 0.2}),
    ("nice", "Nice", "FR", "NCE", ["NCE"], 43.7102, 7.262, "FRL0", ("KRK", "WAW", "KTW"), 20,
     {"food": 0.8, "history": 0.55, "art": 0.7, "beach": 0.85, "nature": 0.65, "hiking": 0.55,
      "nightlife": 0.6, "ski": 0.2}),
    ("amsterdam", "Amsterdam", "NL", "AMS", ["AMS", "EIN"], 52.3676, 4.9041, "NL32", ALL, 6,
     {"food": 0.65, "history": 0.75, "art": 0.95, "nightlife": 0.9, "nature": 0.3}),
    ("berlin", "Berlin", "DE", "BER", ["BER"], 52.52, 13.405, "DE30", ("KRK", "WAW", "GDN"), 8,
     {"food": 0.65, "history": 0.95, "art": 0.85, "nightlife": 1.0, "nature": 0.3}),
    ("munich", "Munich", "DE", "MUC", ["MUC"], 48.1351, 11.582, "DE21", ALL, 8,
     {"food": 0.75, "history": 0.7, "art": 0.75, "nightlife": 0.65, "nature": 0.55,
      "hiking": 0.5, "ski": 0.45}),
    ("vienna", "Vienna", "AT", "VIE", ["VIE"], 48.2082, 16.3738, "AT13", ALL, 8,
     {"food": 0.8, "history": 0.9, "art": 0.95, "nightlife": 0.6, "nature": 0.35}),
    ("innsbruck", "Innsbruck", "AT", "INN", ["INN"], 47.2692, 11.4041, "AT33", ("KTW", "WAW"), 20,
     {"food": 0.5, "history": 0.5, "art": 0.3, "nature": 0.95, "hiking": 1.0, "ski": 1.0,
      "nightlife": 0.35}),
    ("prague", "Prague", "CZ", "PRG", ["PRG"], 50.0755, 14.4378, "CZ01", ("WAW", "GDN"), 6,
     {"food": 0.65, "history": 0.95, "art": 0.75, "nightlife": 0.8, "nature": 0.25}),
    ("budapest", "Budapest", "HU", "BUD", ["BUD"], 47.4979, 19.0402, "HU11", ("WAW", "GDN"), 7,
     {"food": 0.75, "history": 0.85, "art": 0.65, "nightlife": 0.9, "nature": 0.35}),
    ("athens", "Athens", "GR", "ATH", ["ATH"], 37.9838, 23.7275, "EL30", ALL, 10,
     {"food": 0.85, "history": 1.0, "art": 0.7, "beach": 0.55, "nature": 0.3,
      "nightlife": 0.7}),
    ("heraklion", "Heraklion (Crete)", "GR", "HER", ["HER"], 35.3387, 25.1442, "EL43", ALL, 30,
     {"food": 0.85, "history": 0.85, "art": 0.3, "beach": 0.95, "nature": 0.75, "hiking": 0.7,
      "nightlife": 0.5}),
    ("split", "Split", "HR", "SPU", ["SPU"], 43.5081, 16.4402, "HR03", ALL, 20,
     {"food": 0.7, "history": 0.8, "art": 0.4, "beach": 0.9, "nature": 0.7, "hiking": 0.55,
      "nightlife": 0.75}),
    ("dubrovnik", "Dubrovnik", "HR", "DBV", ["DBV"], 42.6507, 18.0944, "HR03", ("KRK", "WAW", "KTW"),
     10,
     {"food": 0.65, "history": 0.9, "art": 0.4, "beach": 0.8, "nature": 0.6, "hiking": 0.4,
      "nightlife": 0.5}),
    ("valletta", "Valletta (Malta)", "MT", "MLA", ["MLA"], 35.8989, 14.5146, "MT00", ALL, 15,
     {"food": 0.65, "history": 0.9, "art": 0.5, "beach": 0.8, "nature": 0.45, "hiking": 0.35,
      "nightlife": 0.75}),
    ("copenhagen", "Copenhagen", "DK", "CPH", ["CPH"], 55.6761, 12.5683, "DK01", ALL, 8,
     {"food": 0.9, "history": 0.7, "art": 0.75, "nightlife": 0.7, "nature": 0.35}),
    ("stockholm", "Stockholm", "SE", "ARN", ["ARN"], 59.3293, 18.0686, "SE11", ALL, 10,
     {"food": 0.7, "history": 0.75, "art": 0.75, "nightlife": 0.65, "nature": 0.65,
      "hiking": 0.4}),
    ("oslo", "Oslo", "NO", "OSL", ["OSL"], 59.9139, 10.7522, "NO08", ALL, 12,
     {"food": 0.6, "history": 0.65, "art": 0.75, "nightlife": 0.5, "nature": 0.8,
      "hiking": 0.7, "ski": 0.6}),
    ("reykjavik", "Reykjavík", "IS", "KEF", ["KEF"], 64.1466, -21.9426, "IS00", ALL, 60,
     {"food": 0.5, "history": 0.4, "art": 0.45, "nature": 1.0, "hiking": 0.9,
      "nightlife": 0.6}),
    ("dublin", "Dublin", "IE", "DUB", ["DUB"], 53.3498, -6.2603, "IE06", ALL, 8,
     {"food": 0.6, "history": 0.75, "art": 0.6, "nightlife": 0.95, "nature": 0.4,
      "hiking": 0.35}),
    ("larnaca", "Larnaca (Cyprus)", "CY", "LCA", ["LCA", "PFO"], 34.9167, 33.6333, "CY00", ALL, 30,
     {"food": 0.7, "history": 0.65, "art": 0.25, "beach": 0.95, "nature": 0.5, "hiking": 0.35,
      "nightlife": 0.6}),
    ("london", "London", "GB", "STN", ["LHR", "LGW", "STN", "LTN"], 51.5074, -0.1278, "UKI", ALL, 8,
     {"food": 0.8, "history": 0.9, "art": 1.0, "nightlife": 0.95, "nature": 0.3}),
    ("tirana", "Tirana", "AL", "TIA", ["TIA"], 41.3275, 19.8187, "AL02", ALL, 40,
     {"food": 0.75, "history": 0.6, "art": 0.35, "beach": 0.6, "nature": 0.75, "hiking": 0.75,
      "nightlife": 0.6}),
]
# fmt: on

COUNTRY_NAMES = {
    "IT": "Italy", "ES": "Spain", "PT": "Portugal", "FR": "France", "NL": "Netherlands",
    "DE": "Germany", "AT": "Austria", "CZ": "Czechia", "HU": "Hungary", "GR": "Greece",
    "HR": "Croatia", "MT": "Malta", "DK": "Denmark", "SE": "Sweden", "NO": "Norway",
    "IS": "Iceland", "IE": "Ireland", "CY": "Cyprus", "GB": "United Kingdom", "AL": "Albania",
}  # fmt: skip


def build() -> list[dict[str, Any]]:
    out = []
    for cid, name, cc, iata, airports, lat, lon, nuts2, direct, radius, tags in _CITIES:
        assert set(tags) <= set(TAGS), (cid, set(tags) - set(TAGS))
        assert set(direct) <= set(ORIGINS), cid
        out.append(
            {
                "id": cid,
                "name": name,
                "country": cc,
                "country_name": COUNTRY_NAMES[cc],
                "iata": iata,
                "airports": airports,
                "lat": lat,
                "lon": lon,
                "nuts2": nuts2,
                "direct_from": list(direct),
                "attractions_radius_km": radius,
                "tags": {t: tags.get(t, 0.0) for t in TAGS},
            }
        )
    return out


def main() -> None:
    cities = build()
    payload = {
        "meta": meta(
            "curated:tripai-team",
            generator="tripai.seed.cities",
            notes=(
                "Hand-curated list. Tag weights (0..1) are editorial priors; direct_from is an "
                "approximate list of PL origins with direct (often seasonal) flights, to be "
                "verified by flight connectors. nuts2 uses Eurostat NUTS 2024 codes "
                "(UKI has no post-Brexit Eurostat data; IS00 uses country-level data)."
            ),
            tags=list(TAGS),
            origins=list(ORIGINS),
        ),
        "cities": cities,
    }
    path = write_json("cities.json", payload)
    print(f"wrote {len(cities)} cities → {path}")


if __name__ == "__main__":
    main()
