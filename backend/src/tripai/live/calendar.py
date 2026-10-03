"""Google Calendar free/busy behind the scorer's `CalendarProvider` seam."""

import logging
from datetime import date
from zoneinfo import ZoneInfo

from tripai.connectors.gcal_freebusy import GCalFreeBusy
from tripai.scoring.provider import FixtureCalendar
from tripai.scoring.windows import BusyInterval

log = logging.getLogger(__name__)
TZ = ZoneInfo("Europe/Warsaw")


class GCalCalendar:
    """Live free/busy for the primary calendar. Any failure falls back to the demo calendar (a 9-17
    office job), never to an empty one: an unreadable calendar must not look free."""

    mode = "live"

    def __init__(self, fallback: FixtureCalendar | None = None) -> None:
        self.fallback = fallback or FixtureCalendar()

    async def busy(self, start: date, end: date) -> list[BusyInterval]:
        try:
            res = await GCalFreeBusy(fixtures=False).query(start, end)
        except Exception as exc:  # noqa: BLE001 - never 500 on calendar trouble
            log.warning("gcal freebusy failed, using the demo calendar: %s", exc)
            return await self.fallback.busy(start, end)
        return [
            BusyInterval(
                start=b.start.astimezone(TZ).replace(tzinfo=None),
                end=b.end.astimezone(TZ).replace(tzinfo=None),
            )
            for b in res.busy
        ]
