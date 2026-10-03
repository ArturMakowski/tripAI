"""DBOS wiring for the proactive scan.

With DATABASE_URL set (Supabase pooler, *session* mode, port 5432), `proactive_scan` runs as a
durable DBOS workflow: every step is checkpointed in Postgres, and a crashed scan resumes from the
last finished step on restart. Free steps (DB, push) are retried (3 attempts, backoff); paid steps
(provider calls) are not, so a failed SerpApi call is never bought twice.

A DBOS schedule fires `daily_scan` every day at 07:00 Europe/Warsaw. It visits only active users
(push opt-ins plus anyone who changed prefs, watched a pick or ran a scan in the last
TRIPAI_SCAN_ACTIVE_DAYS days; at most TRIPAI_SCAN_MAX_USERS, most recent first), one after
another, and stops early once the provider's SerpApi daily budget is spent.

Without DATABASE_URL (tests, local) the same body runs inline with plain awaits.
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Any

from tripai.workflows.scan import PAID_STEPS, ScanDeps, plain_step, scan_body

log = logging.getLogger(__name__)

DAILY_CRON = os.environ.get("TRIPAI_SCAN_CRON", "0 0 7 * * *")  # sec min hour dom mon dow
DAILY_TZ = "Europe/Warsaw"
STEP_OPTIONS = {"retries_allowed": True, "max_attempts": 3, "interval_seconds": 1.0,
                "backoff_rate": 2.0}  # fmt: skip

_deps: ScanDeps | None = None  # steps run in-process; DBOS checkpoints only their outputs
_dbos_on = False


def set_deps(deps: ScanDeps) -> None:
    global _deps
    _deps = deps


def dbos_enabled() -> bool:
    return _dbos_on


def _require_deps() -> ScanDeps:
    if _deps is None:
        raise RuntimeError("tripai.workflows.runtime.set_deps() was not called")
    return _deps


def step_options(name: str) -> dict:
    opts = {**STEP_OPTIONS, "name": name}
    if name in PAID_STEPS:  # a failed provider call is not re-bought
        opts["retries_allowed"] = False
    return opts


def scheduled_users(at_iso: str) -> list[str]:
    deps = _require_deps()
    since = datetime.fromisoformat(at_iso) - timedelta(days=deps.limits.active_days)
    return deps.notify.active_user_ids(since, deps.limits.max_users)


def budget_exhausted() -> bool:
    """True once the provider's shared SerpApi daily budget is used up (fixture: never)."""
    status = getattr(_require_deps().provider, "budget_status", None)
    if not callable(status):
        return False
    b = status()
    cap = b.get("daily_cap")
    return bool(cap) and b.get("used", 0) >= cap


async def run_scan(user_id: str, today_iso: str | None = None) -> dict:
    """Entry point used by POST /scan/run: durable under DBOS, inline otherwise."""
    if _dbos_on:
        from dbos import DBOS

        handle = await DBOS.start_workflow_async(_wf_scan, user_id, today_iso, "manual")
        return await handle.get_result()
    return await scan_body(_require_deps(), user_id, today_iso, run_step=plain_step)


def _register() -> tuple[Any, Any]:
    """Decorate the workflows (must happen before DBOS.launch())."""
    from dbos import DBOS

    async def dbos_step(name: str, fn, *args):
        return await DBOS.run_step_async(step_options(name), fn, *args)

    @DBOS.workflow(name="proactive_scan")
    async def proactive_scan(
        user_id: str, today_iso: str | None = None, trigger: str = "manual"
    ) -> dict:
        return await scan_body(
            _require_deps(),
            user_id,
            today_iso,
            run_step=dbos_step,
            mode="dbos",
            trigger=trigger,
            workflow_id=DBOS.workflow_id,
        )

    @DBOS.workflow(name="daily_scan")
    async def daily_scan(scheduled_at: datetime, context: Any) -> None:
        users = await DBOS.run_step_async(
            step_options("list_users"), scheduled_users, scheduled_at.isoformat()
        )
        done = 0
        for uid in users:
            if await DBOS.run_step_async(step_options("budget_left"), budget_exhausted):
                DBOS.logger.warning(
                    "daily_scan: SerpApi budget spent, %d users skipped", len(users) - done
                )
                break
            # one child workflow per user, in turn: a failing user never blocks the rest, and
            # the budget check above sees what the previous user spent
            handle = await DBOS.start_workflow_async(proactive_scan, uid, None, "scheduled")
            try:
                await handle.get_result()
            except Exception as exc:  # noqa: BLE001
                DBOS.logger.warning("daily_scan: user %s failed: %s", uid, exc)
            done += 1
        DBOS.logger.info("daily_scan %s: %d/%d users", scheduled_at.isoformat(), done, len(users))

    return proactive_scan, daily_scan


_wf_scan: Any = None


def launch_dbos(database_url: str) -> bool:
    """Configure + launch DBOS on `database_url`. Returns False (inline mode) on any failure."""
    global _dbos_on, _wf_scan
    try:
        from dbos import DBOS, DBOSConfig

        if _wf_scan is None:
            _wf_scan, daily = _register()
        else:  # already registered in this process
            daily = None
        config: DBOSConfig = {
            "name": "tripai",
            "system_database_url": database_url,
            "application_version": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "dev")[:12],
            # pooler session mode allows few connections per client; keep the pool small
            "sys_db_pool_size": int(os.environ.get("TRIPAI_DBOS_POOL", "5")),
        }
        DBOS(config=config)
        DBOS.launch()
        if daily is not None:
            DBOS.apply_schedules(
                [
                    {
                        "schedule_name": "tripai-daily-scan",
                        "workflow_fn": daily,
                        "schedule": DAILY_CRON,
                        "cron_timezone": DAILY_TZ,
                    }
                ]
            )
        _dbos_on = True
        log.info("DBOS launched; daily scan cron %r (%s)", DAILY_CRON, DAILY_TZ)
    except Exception as exc:  # noqa: BLE001 - fall back to inline scans, never block startup
        log.warning("DBOS launch failed, scans run inline: %s", exc)
        _dbos_on = False
    return _dbos_on


def shutdown_dbos() -> None:
    global _dbos_on
    if _dbos_on:
        from dbos import DBOS

        DBOS.destroy()
        _dbos_on = False
