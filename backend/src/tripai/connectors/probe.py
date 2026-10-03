"""Hit every live API whose credentials are present, print a summary and record fixtures.

    uv run python -m tripai.connectors.probe                      # all sources, all demo routes
    uv run python -m tripai.connectors.probe --only travelpayouts,open_meteo --routes FCO,LIS
    uv run python -m tripai.connectors.probe --no-record          # just check the APIs

Fixtures land in backend/tests/fixtures/<source>/ and are served with TRIPAI_USE_FIXTURES=1.
SerpApi quota: explore = 1 call, flights/hotels = 1 call per route.
"""

import argparse
import asyncio
import os
from collections.abc import Awaitable, Callable
from datetime import date

import httpx

from tripai.connectors import config
from tripai.connectors.base import ConnectorError, SourcedResult
from tripai.connectors.cache import NullCache
from tripai.connectors.demo_routes import BY_IATA, DESTINATIONS, ORIGIN, Place
from tripai.connectors.gcal_freebusy import GCalFreeBusy, token_path
from tripai.connectors.open_meteo import OpenMeteo
from tripai.connectors.serpapi import SerpApiExplore, SerpApiFlights, SerpApiHotels
from tripai.connectors.serper import Serper
from tripai.connectors.travelpayouts import Travelpayouts

SOURCES = [
    "serpapi_explore",
    "serpapi_flights",
    "serpapi_hotels",
    "travelpayouts",
    "open_meteo",
    "gcal",
]


def _ok(name: str, res: SourcedResult, detail: str) -> None:
    print(f"  ✓ {name:<34} {detail}  [{res.source} @ {res.fetched_at:%Y-%m-%d %H:%M}Z]")


async def probe(args: argparse.Namespace) -> int:
    only = set(args.only.split(",")) if args.only else set(SOURCES)
    routes: list[Place] = (
        [BY_IATA[c] for c in args.routes.split(",")] if args.routes else DESTINATIONS
    )
    out, back = date.fromisoformat(args.outbound), date.fromisoformat(args.inbound)
    month = out.strftime("%Y-%m")
    serp_key, tp_token = config.env("SERPAPI_API_KEY"), config.env("TRAVELPAYOUTS_TOKEN")
    serper_key = config.env("SERPER_API_KEY")
    failures = 0

    async with httpx.AsyncClient(timeout=60) as client:
        kw = {"client": client, "cache": NullCache(), "fixtures": False}

        async def step(
            name: str, enabled: bool, why: str, fn: Callable[[], Awaitable[None]]
        ) -> None:
            nonlocal failures
            if not enabled:
                print(f"  - {name:<34} skipped ({why})")
                return
            try:
                await fn()
            except ConnectorError as exc:
                failures += 1
                print(f"  ✗ {name:<34} {exc}")

        print(f"Probe {ORIGIN.iata} → {','.join(p.iata for p in routes)}  {out}..{back}")

        if "serpapi_explore" in only:

            async def explore() -> None:
                res = await SerpApiExplore(**kw).explore(ORIGIN.iata, month=out.month)
                top = ", ".join(f"{d.iata or d.name} {d.flight_price:.0f}" for d in res.cheapest(5))
                _ok("serpapi explore", res, f"{len(res.destinations)} destinations; {top}")

            await step("serpapi explore", bool(serp_key), "SERPAPI_API_KEY not set", explore)

        for p in routes:
            if "travelpayouts" in only:

                async def tp(p: Place = p) -> None:
                    cal = await Travelpayouts(**kw).month_calendar(ORIGIN.iata, p.iata, month)
                    c = cal.cheapest()
                    _ok(
                        f"travelpayouts calendar {p.iata}",
                        cal,
                        f"{len(cal.fares)} days, min {c.price if c else '-'} PLN",
                    )
                    dated = await Travelpayouts(**kw).prices_for_dates(
                        ORIGIN.iata, p.iata, out, back
                    )
                    c = dated.cheapest()
                    _ok(
                        f"travelpayouts dates {p.iata}",
                        dated,
                        f"{len(dated.fares)} fares, min {c.price if c else '-'} PLN",
                    )

                await step(
                    f"travelpayouts {p.iata}", bool(tp_token), "TRAVELPAYOUTS_TOKEN not set", tp
                )

            if "serpapi_flights" in only:

                async def flights(p: Place = p) -> None:
                    res = await SerpApiFlights(**kw).price_insights(ORIGIN.iata, p.iata, out, back)
                    _ok(
                        f"serpapi flights {p.iata}",
                        res,
                        f"lowest {res.lowest_price} PLN, level {res.price_level}",
                    )

                await step(
                    f"serpapi flights {p.iata}", bool(serp_key), "SERPAPI_API_KEY not set", flights
                )

            if "serpapi_hotels" in only:

                async def hotels(p: Place = p) -> None:
                    res = await SerpApiHotels(**kw).search(p.city, out, back, iata=p.iata)
                    _ok(
                        f"serpapi hotels {p.city}",
                        res,
                        f"{len(res.offers)} offers, median {res.median_nightly} PLN/night",
                    )

                await step(
                    f"serpapi hotels {p.city}", bool(serp_key), "SERPAPI_API_KEY not set", hotels
                )

            if "serper" in only:

                async def serper(p: Place = p) -> None:
                    imgs = await Serper(**kw).city_images(p.city, country=p.country)
                    best = imgs.best()
                    _ok(
                        f"serper images {p.city}",
                        imgs,
                        f"{len(imgs.images)} images, best {best.width if best else '-'}px",
                    )
                    pl = await Serper(**kw).places(p.city, country=p.country)
                    top = ", ".join(x.title for x in pl.top(3))
                    _ok(f"serper places {p.city}", pl, f"{len(pl.places)} places: {top}")

                await step(f"serper {p.city}", bool(serper_key), "SERPER_API_KEY not set", serper)

            if "open_meteo" in only:

                async def weather(p: Place = p) -> None:
                    res = await OpenMeteo(**kw).weather(p.lat, p.lon, out, back, place=p.city)
                    _ok(
                        f"open-meteo {p.city}",
                        res,
                        f"{res.mode}: max {res.avg_temp_max_c}°C, rain {res.rainy_day_share}",
                    )

                await step(f"open-meteo {p.city}", True, "", weather)

        if "gcal" in only:

            async def gcal() -> None:
                res = await GCalFreeBusy(**kw).query(out.replace(day=1), back.replace(day=28))
                wins = ", ".join(f"{w.start:%d %b}-{w.end:%d %b}" for w in res.free_windows())
                _ok("gcal freebusy", res, f"{len(res.busy)} busy blocks; free: {wins or 'none'}")

            await step(
                "gcal freebusy",
                token_path().exists(),
                f"no token at {token_path()}; run `python -m tripai.connectors.gcal_freebusy login`",
                gcal,
            )

    if os.environ.get("TRIPAI_RECORD_FIXTURES") == "1":
        print(f"Fixtures written under {config.fixtures_dir()}")
    return 1 if failures else 0


def main() -> None:
    config.load_dotenv_files()
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--only", help=f"comma list of {','.join(SOURCES)}")
    parser.add_argument("--routes", help="comma list of destination IATA codes (default: all demo)")
    parser.add_argument("--outbound", default="2027-01-14")
    parser.add_argument("--inbound", default="2027-01-19")
    parser.add_argument("--no-record", action="store_true", help="don't write fixtures")
    args = parser.parse_args()
    os.environ["TRIPAI_USE_FIXTURES"] = "0"
    os.environ["TRIPAI_RECORD_FIXTURES"] = "0" if args.no_record else "1"
    raise SystemExit(asyncio.run(probe(args)))


if __name__ == "__main__":
    main()
