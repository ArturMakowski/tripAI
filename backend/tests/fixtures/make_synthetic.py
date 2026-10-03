"""Regenerate the SYNTHETIC (hand-modelled, `"recorded": false`) fixtures for SerpApi and
Travelpayouts: KRK → 10 demo cities, January 2027. Shapes follow the official API docs; prices are
plausible PLN low-season levels, deterministic (seeded). Real recordings from
`python -m tripai.connectors.probe` overwrite these files with `"recorded": true`.

    uv run python tests/fixtures/make_synthetic.py
"""

import json
import random
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
FETCHED_AT = "2026-10-03T12:00:00+00:00"
OUT, BACK = date(2027, 1, 14), date(2027, 1, 19)

# iata: city, country, kgmid, lat, lon, base return fare PLN, carriers, direct?, flight min,
#       hotel median PLN/night, neighbourhoods
ROUTES = {
    "FCO": (
        "Rome",
        "Italy",
        "/m/06c62",
        41.9028,
        12.4964,
        289,
        ["FR", "W6"],
        True,
        125,
        390,
        ["Trastevere", "Monti", "Prati", "Esquilino"],
    ),
    "LIS": (
        "Lisbon",
        "Portugal",
        "/m/04llb",
        38.7223,
        -9.1393,
        489,
        ["FR", "TP"],
        True,
        255,
        330,
        ["Alfama", "Baixa", "Chiado", "Príncipe Real"],
    ),
    "BCN": (
        "Barcelona",
        "Spain",
        "/m/01f62",
        41.3874,
        2.1686,
        339,
        ["FR", "VY"],
        True,
        155,
        420,
        ["Gràcia", "Eixample", "El Born", "Poblenou"],
    ),
    "ATH": (
        "Athens",
        "Greece",
        "/m/0n2z",
        37.9838,
        23.7275,
        379,
        ["FR", "A3"],
        True,
        150,
        260,
        ["Plaka", "Koukaki", "Psyri", "Kolonaki"],
    ),
    "VIE": (
        "Vienna",
        "Austria",
        "/m/0fhp9",
        48.2082,
        16.3738,
        689,
        ["OS", "LO"],
        True,
        70,
        410,
        ["Innere Stadt", "Neubau", "Leopoldstadt", "Wieden"],
    ),
    "PRG": (
        "Prague",
        "Czechia",
        "/m/05ywg",
        50.0755,
        14.4378,
        759,
        ["LO", "OK"],
        False,
        205,
        280,
        ["Malá Strana", "Vinohrady", "Staré Město", "Karlín"],
    ),
    "BUD": (
        "Budapest",
        "Hungary",
        "/m/095w_",
        47.4979,
        19.0402,
        699,
        ["LO", "W6"],
        False,
        215,
        250,
        ["Belváros", "Erzsébetváros", "Buda Castle", "Terézváros"],
    ),
    "NAP": (
        "Naples",
        "Italy",
        "/m/0fhsz",
        40.8518,
        14.2681,
        279,
        ["FR", "W6"],
        True,
        120,
        280,
        ["Chiaia", "Spaccanapoli", "Vomero", "Santa Lucia"],
    ),
    "MLA": (
        "Valletta",
        "Malta",
        "/m/07zr3",
        35.8989,
        14.5146,
        399,
        ["FR", "KM"],
        True,
        170,
        300,
        ["Valletta", "Sliema", "St Julian's", "Floriana"],
    ),
    "OPO": (
        "Porto",
        "Portugal",
        "/m/0fb0",
        41.1579,
        -8.6291,
        529,
        ["FR", "TP"],
        False,
        300,
        280,
        ["Ribeira", "Baixa", "Cedofeita", "Foz do Douro"],
    ),
}
AIRLINE_NAMES = {
    "FR": "Ryanair",
    "W6": "Wizz Air",
    "TP": "TAP Air Portugal",
    "VY": "Vueling",
    "A3": "Aegean",
    "OS": "Austrian",
    "LO": "LOT",
    "OK": "Czech Airlines",
    "KM": "KM Malta Airlines",
}
HUB = {"PRG": "WAW", "BUD": "WAW", "OPO": "LIS"}


def write(source: str, name: str, params: dict, payload: dict) -> None:
    path = HERE / source.replace(":", "/") / f"{name}.json"
    if path.exists() and json.loads(path.read_text()).get("recorded"):
        return  # never clobber a live recording
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "source": source,
        "params": params,
        "fetched_at": FETCHED_AT,
        "recorded": False,
        "note": "synthetic fixture (tests/fixtures/make_synthetic.py), not a live recording",
        "payload": payload,
    }
    path.write_text(json.dumps(entry, ensure_ascii=False, indent=1) + "\n")


def day_factor(d: date) -> float:
    return {0: 0.95, 1: 0.9, 2: 0.88, 3: 1.0, 4: 1.12, 5: 1.05, 6: 1.08}[d.weekday()]


def fare(base: int, d: date, rnd: random.Random) -> int:
    return int(round(base * day_factor(d) * rnd.uniform(0.9, 1.12), -0) // 1)


def travelpayouts(iata: str, r: tuple) -> None:
    rnd = random.Random(f"tp-{iata}")
    base, carriers, direct, minutes = r[5], r[6], r[7], r[8]
    hub = HUB.get(iata)

    def item(dep: date, ret: date, price: int, dur_scale: float = 1.0) -> dict:
        al = carriers[0] if rnd.random() < 0.7 else carriers[1]
        transfers = 0 if direct else 1
        dur_to = int(minutes * dur_scale)
        dt = datetime(  # noqa: DTZ001
            dep.year,
            dep.month,
            dep.day,
            rnd.choice([6, 7, 10, 13, 16, 20]),
            rnd.choice([0, 5, 25, 40, 55]),
        )
        rt = datetime(  # noqa: DTZ001
            ret.year,
            ret.month,
            ret.day,
            rnd.choice([9, 12, 15, 18, 21]),
            rnd.choice([0, 15, 35, 50]),
        )
        code = f"KRK{dep:%d%m}{iata}{ret:%d%m}1"
        return {
            "origin": "KRK",
            "destination": iata,
            "origin_airport": "KRK",
            "destination_airport": iata,
            "price": price,
            "airline": al,
            "flight_number": str(
                rnd.randint(1000, 9999) if al in ("FR", "W6") else rnd.randint(200, 999)
            ),
            "departure_at": dt.isoformat() + "+01:00",
            "return_at": rt.isoformat() + "+01:00",
            "transfers": transfers,
            "return_transfers": transfers,
            "duration": dur_to * 2 + rnd.randint(-10, 15),
            "duration_to": dur_to,
            "duration_back": dur_to + rnd.randint(-5, 15),
            "link": f"/search/{code}?t={al}{rnd.randint(10**12, 10**13)}{'_' + hub if hub else ''}"
            f"&search_date=01102026&expected_price_uuid={rnd.getrandbits(128):032x}"
            "&expected_price_currency=pln",
        }

    grouped = {}
    for day in range(1, 29):
        dep = date(2027, 1, day)
        if rnd.random() < 0.12:  # Aviasales cache gaps
            continue
        ret = dep + timedelta(days=rnd.randint(3, 7))
        if ret.month != 1:
            continue
        grouped[dep.isoformat()] = item(dep, ret, fare(base, dep, rnd))
    # keep the demo window competitive
    grouped[OUT.isoformat()] = item(OUT, BACK, int(base * 0.92))
    write(
        "travelpayouts:grouped_prices",
        f"KRK-{iata}",
        {
            "origin": "KRK",
            "destination": iata,
            "currency": "pln",
            "departure_at": "2027-01",
            "group_by": "departure_at",
            "direct": "false",
            "return_at": "2027-01",
            "min_trip_duration": 3,
            "max_trip_duration": 7,
        },
        {"success": True, "data": dict(sorted(grouped.items())), "currency": "pln"},
    )

    offers = sorted(
        [item(OUT, BACK, int(base * 0.92))]
        + [item(OUT, BACK, int(base * rnd.uniform(1.0, 1.6))) for _ in range(4)],
        key=lambda x: x["price"],
    )
    write(
        "travelpayouts:prices_for_dates",
        f"KRK-{iata}",
        {
            "origin": "KRK",
            "destination": iata,
            "currency": "pln",
            "departure_at": OUT.isoformat(),
            "return_at": BACK.isoformat(),
            "one_way": "false",
            "direct": "false",
            "sorting": "price",
            "limit": 30,
        },
        {"success": True, "data": offers, "currency": "pln"},
    )


def serp_flights(iata: str, r: tuple) -> None:
    rnd = random.Random(f"gf-{iata}")
    base, carriers, direct, minutes = r[5], r[6], r[7], r[8]
    hub = HUB.get(iata)
    lowest = int(base * 0.95)
    typical = [int(base * 1.05 // 10 * 10), int(base * 1.6 // 10 * 10)]

    def leg(frm: str, to: str, day: date, hh: int, mins: int, al: str) -> dict:
        dep = datetime(day.year, day.month, day.day, hh, rnd.choice([0, 10, 25, 40, 55]))  # noqa: DTZ001
        arr = dep + timedelta(minutes=mins)
        return {
            "departure_airport": {
                "name": f"{frm} Airport",
                "id": frm,
                "time": f"{dep:%Y-%m-%d %H:%M}",
            },
            "arrival_airport": {"name": f"{to} Airport", "id": to, "time": f"{arr:%Y-%m-%d %H:%M}"},
            "duration": mins,
            "airplane": rnd.choice(["Boeing 737", "Airbus A320neo", "Embraer 195"]),
            "airline": AIRLINE_NAMES[al],
            "airline_logo": f"https://www.gstatic.com/flights/airline_logos/70px/{al}.png",
            "travel_class": "Economy",
            "flight_number": f"{al} {rnd.randint(100, 9999)}",
            "legroom": rnd.choice(["28 in", "29 in", "30 in"]),
            "extensions": ["Average legroom", f"Carbon emissions estimate: {mins // 2} kg"],
        }

    def option(price: int, al: str) -> dict:
        hh = rnd.choice([6, 9, 13, 17, 20])
        if direct:
            legs, layovers, total = [leg("KRK", iata, OUT, hh, minutes, al)], [], minutes
        else:
            m1, m2, lay = 60, minutes - 60 - 70, 70
            l1 = leg("KRK", hub, OUT, hh, m1, "LO" if hub == "WAW" else al)
            l2 = leg(hub, iata, OUT, hh + 2, m2, al)
            legs, layovers, total = (
                [l1, l2],
                [{"duration": lay, "name": f"{hub} Airport", "id": hub}],
                minutes,
            )
        return {
            "flights": legs,
            "layovers": layovers,
            "total_duration": total,
            "carbon_emissions": {
                "this_flight": total * 900,
                "typical_for_this_route": total * 950,
                "difference_percent": -5,
            },
            "price": price,
            "type": "Round trip",
            "airline_logo": f"https://www.gstatic.com/flights/airline_logos/70px/{al}.png",
            "departure_token": f"WyJ{rnd.getrandbits(96):024x}",
        }

    best = [option(lowest, carriers[0]), option(int(base * 1.15), carriers[1])]
    other = [option(int(base * rnd.uniform(1.2, 2.1)), rnd.choice(carriers)) for _ in range(4)]
    start = datetime(2026, 8, 5, tzinfo=UTC)
    history, p = [], base * 1.25
    for i in range(60):
        p = max(base * 0.85, min(base * 1.8, p * rnd.uniform(0.95, 1.04)))
        history.append([int((start + timedelta(days=i)).timestamp()), int(p)])
    history[-1][1] = lowest
    write(
        "serpapi:google_flights",
        f"KRK-{iata}",
        {
            "engine": "google_flights",
            "currency": "PLN",
            "gl": "pl",
            "hl": "en",
            "departure_id": "KRK",
            "arrival_id": iata,
            "type": 1,
            "outbound_date": OUT.isoformat(),
            "return_date": BACK.isoformat(),
            "adults": 1,
        },
        {
            "search_metadata": {
                "id": f"{rnd.getrandbits(96):024x}",
                "status": "Success",
                "google_flights_url": f"https://www.google.com/travel/flights?hl=en&gl=pl&curr=PLN&q=KRK+{iata}+{OUT}+{BACK}",
                "created_at": "2026-10-03 12:00:00 UTC",
                "total_time_taken": 2.1,
            },
            "search_parameters": {
                "engine": "google_flights",
                "departure_id": "KRK",
                "arrival_id": iata,
                "outbound_date": OUT.isoformat(),
                "return_date": BACK.isoformat(),
                "currency": "PLN",
                "gl": "pl",
                "hl": "en",
            },
            "best_flights": best,
            "other_flights": other,
            "price_insights": {
                "lowest_price": lowest,
                "price_level": "low" if lowest < typical[0] else "typical",
                "typical_price_range": typical,
                "price_history": history,
            },
            "airports": [
                {
                    "departure": [
                        {
                            "airport": {
                                "name": "Kraków John Paul II International Airport",
                                "id": "KRK",
                            },
                            "city": "Kraków",
                            "country": "Poland",
                            "country_code": "PL",
                        }
                    ],
                    "arrival": [
                        {
                            "airport": {"name": f"{r[0]} Airport", "id": iata},
                            "city": r[0],
                            "country": r[1],
                        }
                    ],
                }
            ],
        },
    )


def serp_hotels(iata: str, r: tuple) -> None:
    rnd = random.Random(f"gh-{iata}")
    city, median, hoods = r[0], r[9], r[10]
    kinds = [
        "Boutique Hotel",
        "Suites",
        "Residence",
        "Guesthouse",
        "Design Hotel",
        "Apartments",
        "Inn",
        "Palace Hotel",
    ]
    nights = (BACK - OUT).days
    props = []
    for i in range(10):
        stars = rnd.choice([2, 3, 3, 3, 4, 4, 4, 5])
        nightly = int(median * (0.45 + 0.22 * stars) * rnd.uniform(0.75, 1.2) / (0.45 + 0.22 * 3.6))
        rating = round(min(4.9, rnd.uniform(3.7, 4.4) + 0.08 * (stars - 3)), 1)
        kind = kinds[i % len(kinds)]
        hood = hoods[i % len(hoods)]
        rental = kind == "Apartments"
        p = {
            "type": "vacation rental" if rental else "hotel",
            "name": f"{hood} {kind}",
            "description": f"{'Apartment' if rental else 'Rooms'} in {hood}, {city}.",
            "link": f"https://example.com/{iata.lower()}-{i}",
            "property_token": f"ChcI{rnd.getrandbits(80):020x}",
            "gps_coordinates": {
                "latitude": round(r[3] + rnd.uniform(-0.02, 0.02), 6),
                "longitude": round(r[4] + rnd.uniform(-0.02, 0.02), 6),
            },
            "check_in_time": "3:00 PM",
            "check_out_time": "11:00 AM",
            "rate_per_night": {
                "lowest": f"{nightly} zł",
                "extracted_lowest": nightly,
                "before_taxes_fees": f"{int(nightly * 0.9)} zł",
                "extracted_before_taxes_fees": int(nightly * 0.9),
            },
            "total_rate": {
                "lowest": f"{nightly * nights} zł",
                "extracted_lowest": nightly * nights,
            },
            "overall_rating": rating,
            "reviews": rnd.randint(80, 4200),
            "location_rating": round(rnd.uniform(3.5, 4.9), 1),
            "amenities": rnd.sample(
                [
                    "Free Wi-Fi",
                    "Breakfast ($)",
                    "Air conditioning",
                    "Bar",
                    "Airport shuttle",
                    "Fitness centre",
                    "Kitchen",
                ],
                4,
            ),
        }
        if rental:
            p["essential_info"] = ["Entire apartment", "Sleeps 4", "1 bedroom"]
        else:
            p["hotel_class"] = f"{stars}-star hotel"
            p["extracted_hotel_class"] = stars
        props.append(p)
    write(
        "serpapi:google_hotels",
        iata,
        {
            "engine": "google_hotels",
            "currency": "PLN",
            "gl": "pl",
            "hl": "en",
            "q": f"{city} hotels",
            "check_in_date": OUT.isoformat(),
            "check_out_date": BACK.isoformat(),
            "adults": 2,
        },
        {
            "search_metadata": {"id": f"{rnd.getrandbits(96):024x}", "status": "Success"},
            "search_parameters": {
                "engine": "google_hotels",
                "q": f"{city} hotels",
                "check_in_date": OUT.isoformat(),
                "check_out_date": BACK.isoformat(),
                "adults": 2,
                "currency": "PLN",
                "gl": "pl",
                "hl": "en",
            },
            "properties": props,
            "serpapi_pagination": {"current_from": 1, "current_to": 10, "next_page_token": "CBI="},
        },
    )


def serp_explore() -> None:
    rnd = random.Random("explore")
    dests = []
    extra = [
        ("London", "United Kingdom", "STN", "/m/04jpl", 51.5072, -0.1276, 319, 2, 160, 520, "FR"),
        ("Milan", "Italy", "BGY", "/m/0947l", 45.4642, 9.19, 259, 0, 110, 340, "FR"),
        ("Paris", "France", "BVA", "/m/05qtj", 48.8566, 2.3522, 349, 0, 140, 480, "FR"),
        ("Tenerife", "Spain", "TFS", "/m/07ytt", 28.2916, -16.6291, 849, 0, 345, 360, "FR"),
    ]
    for iata, r in ROUTES.items():
        start = OUT + timedelta(days=rnd.choice([-7, -3, 0, 0, 4, 9]))
        dests.append(
            (
                r[0],
                r[1],
                iata,
                r[2],
                r[3],
                r[4],
                int(r[5] * 0.93),
                0 if r[7] else 1,
                r[8],
                r[9],
                r[6][0],
                start,
            )
        )
    for e in extra:
        dests.append((*e, OUT + timedelta(days=rnd.choice([-4, 2, 6]))))
    items = []
    for name, country, iata, kg, lat, lon, price, stops, dur, hotel, al, start in sorted(
        dests, key=lambda d: d[6]
    ):
        items.append(
            {
                "destination_id": kg,
                "name": name,
                "country": country,
                "gps_coordinates": {"latitude": lat, "longitude": lon},
                "thumbnail": f"https://encrypted-tbn0.gstatic.com/images?q=tbn:{rnd.getrandbits(64):016x}",
                "destination_airport": {"code": iata},
                "start_date": start.isoformat(),
                "end_date": (start + timedelta(days=5)).isoformat(),
                "flight_price": price,
                "hotel_price": hotel,
                "flight_duration": dur,
                "number_of_stops": stops,
                "airline": AIRLINE_NAMES[al],
                "airline_code": al,
                "link": f"https://www.google.com/travel/explore?hl=en&gl=pl&curr=PLN&q=KRK+{iata}",
                "serpapi_link": f"https://serpapi.com/search.json?arrival_id={iata}&currency=PLN&departure_id=KRK&engine=google_travel_explore&gl=pl&hl=en&month=1",
            }
        )
    write(
        "serpapi:google_travel_explore",
        "KRK",
        {
            "engine": "google_travel_explore",
            "currency": "PLN",
            "gl": "pl",
            "hl": "en",
            "departure_id": "KRK",
            "month": 1,
            "travel_duration": 2,
        },
        {
            "search_metadata": {
                "id": f"{rnd.getrandbits(96):024x}",
                "status": "Success",
                "google_travel_explore_url": "https://www.google.com/travel/explore?hl=en&gl=pl&curr=PLN",
            },
            "search_parameters": {
                "engine": "google_travel_explore",
                "hl": "en",
                "gl": "pl",
                "departure_id": "KRK",
                "currency": "PLN",
                "month": "1",
                "travel_duration": "2",
            },
            "destinations": items,
        },
    )


if __name__ == "__main__":
    serp_explore()
    for iata, r in ROUTES.items():
        travelpayouts(iata, r)
        serp_flights(iata, r)
        serp_hotels(iata, r)
    print("synthetic fixtures written under", HERE)
