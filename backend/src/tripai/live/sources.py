"""Per-source live/fixture mode for the live provider.

A source runs on recorded fixtures when any of these holds:
- TRIPAI_USE_FIXTURES=1 (all sources),
- it is listed in TRIPAI_FIXTURE_SOURCES (comma list, e.g. "travelpayouts,gcal"; "all" = every source),
- its credentials are missing (so a missing key degrades to labelled fixtures instead of failing).
Fixture evidence keeps its label: "[synthetic fixture]" (hand-modelled) or "[recorded fixture]"."""

import logging

from tripai.connectors import config
from tripai.connectors.gcal_freebusy import token_path

log = logging.getLogger(__name__)

# source name -> env vars it needs to run live
SOURCES: dict[str, tuple[str, ...]] = {
    "travelpayouts": ("TRAVELPAYOUTS_TOKEN",),
    "serpapi": ("SERPAPI_API_KEY",),
    "serper": ("SERPER_API_KEY",),
    "open_meteo": (),
    "osrm": (),
    "gcal": ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
}
ALIASES = {"open-meteo": "open_meteo", "openmeteo": "open_meteo", "google_calendar": "gcal"}
# Evidence `source` prefix -> source name (for the "[recorded fixture]" label).
EVIDENCE_PREFIX = {
    "travelpayouts:": "travelpayouts",
    "serpapi:": "serpapi",
    "serper:": "serper",
    "open-meteo:": "open_meteo",
    "osrm:": "osrm",
    "gcal:": "gcal",
}
RECORDED_TAG = " [recorded fixture]"


def forced_fixture_sources() -> set[str]:
    raw = config.env("TRIPAI_FIXTURE_SOURCES") or ""
    out: set[str] = set()
    for name in (p.strip().lower() for p in raw.split(",") if p.strip()):
        name = ALIASES.get(name, name)
        if name in {"all", "*"}:
            return set(SOURCES)
        if name in SOURCES:
            out.add(name)
        else:
            log.warning(
                "TRIPAI_FIXTURE_SOURCES: unknown source %r (known: %s)", name, ", ".join(SOURCES)
            )
    return out


def missing_credentials(source: str) -> list[str]:
    missing = [v for v in SOURCES[source] if not config.env(v)]
    if source == "gcal" and not token_path().exists():
        missing.append(f"OAuth token ({token_path()})")
    return missing


def mode(source: str) -> str:
    """'live' or 'fixture' for one source, from the current env."""
    if config.use_fixtures() or source in forced_fixture_sources() or missing_credentials(source):
        return "fixture"
    return "live"


def modes() -> dict[str, str]:
    return {s: mode(s) for s in SOURCES}


def reasons() -> dict[str, str]:
    """Why each fixture-mode source is on fixtures (for /health and the warm CLI)."""
    forced = forced_fixture_sources()
    out = {}
    for s in SOURCES:
        if config.use_fixtures():
            out[s] = "TRIPAI_USE_FIXTURES=1"
        elif s in forced:
            out[s] = "TRIPAI_FIXTURE_SOURCES"
        elif missing := missing_credentials(s):
            out[s] = "missing " + ", ".join(missing)
    return out


def source_of_evidence(evidence_source: str) -> str | None:
    return next((s for p, s in EVIDENCE_PREFIX.items() if evidence_source.startswith(p)), None)
