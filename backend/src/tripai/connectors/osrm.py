"""OSRM driving route (router.project-osrm.org): airport → hotel time/distance by car.

No key. The public demo server asks for at most ~1 request/second, so calls are throttled
process-wide, and results are cached "forever" (a road distance doesn't change; TTL ~10 years).
Results are estimates without traffic, and labelled so (docs/TRIP_DETAILS.md).
"""

import asyncio
import time
import weakref
from typing import Any

from tripai.connectors.base import Connector, ConnectorError, SourcedResult

BASE = "https://router.project-osrm.org/route/v1/driving"
MIN_INTERVAL_S = 1.0


class Route(SourcedResult):
    from_lat: float
    from_lon: float
    to_lat: float
    to_lon: float
    duration_min: int
    distance_km: float


class _Throttle:
    """Space calls MIN_INTERVAL_S apart across the process (one lock per event loop)."""

    def __init__(self) -> None:
        self._last = 0.0
        self._locks: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = (
            weakref.WeakKeyDictionary()
        )

    async def wait(self) -> None:
        loop = asyncio.get_running_loop()
        lock = self._locks.get(loop)
        if lock is None:
            lock = self._locks[loop] = asyncio.Lock()
        async with lock:
            gap = MIN_INTERVAL_S - (time.monotonic() - self._last)
            if gap > 0:
                await asyncio.sleep(gap)
            self._last = time.monotonic()


THROTTLE = _Throttle()


def _validate(payload: Any) -> None:
    if not isinstance(payload, dict) or payload.get("code") != "Ok" or not payload.get("routes"):
        raise ConnectorError(
            f"osrm: {payload.get('code') if isinstance(payload, dict) else payload}"
        )


class Osrm(Connector):
    async def _http(
        self, method: str, url: str, params: dict[str, Any], json_body: Any, headers: Any
    ) -> Any:
        """Only real network calls are throttled; `_route` is a cache-key-only param."""
        await THROTTLE.wait()
        query = {k: v for k, v in params.items() if not k.startswith("_")}
        return await super()._http(method, url, query, json_body, headers)

    async def drive(self, from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> Route:
        pts = [round(v, 5) for v in (from_lon, from_lat, to_lon, to_lat)]
        coords = f"{pts[0]},{pts[1]};{pts[2]},{pts[3]}"
        f = await self._fetch(
            "osrm:route",
            f"{BASE}/{coords}",
            {"overview": "false", "_route": coords},  # coords live in the URL path
            fixture="_".join(f"{v:.3f}" for v in pts),
            validate=_validate,
        )
        r = f.payload["routes"][0]
        res = Route(
            source="osrm:route",
            fetched_at=f.fetched_at,
            from_lat=from_lat,
            from_lon=from_lon,
            to_lat=to_lat,
            to_lon=to_lon,
            duration_min=round(r["duration"] / 60),
            distance_km=round(r["distance"] / 1000, 1),
        )
        res.synthetic = f.synthetic
        return res
