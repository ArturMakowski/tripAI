"""One-off: delete cached serper:places rows that fail the geo filter (tripai.live.places).

    uv run python -m tripai.live.places_purge            # dry run: list what would go
    uv run python -m tripai.live.places_purge --apply    # delete (Supabase api_cache + disk)

Needs SUPABASE_URL + SUPABASE_SECRET_KEY (server-side) for the shared table."""

import asyncio
import sys

from tripai.connectors import config
from tripai.live.places import purge_cache

if __name__ == "__main__":
    config.load_dotenv_files()
    apply = "--apply" in sys.argv
    lines = asyncio.run(purge_cache(apply=apply))
    print("\n".join(lines) or "nothing to purge")
    print("deleted" if apply else "dry run: pass --apply to delete")
