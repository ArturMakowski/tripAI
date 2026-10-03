"""When to ping the user. Pure and deterministic: every number in a title/body is read from the
recommendation (connectors + tripai.scoring), never invented.

Triggers (docs: backend README "Proactive scan + notifications"):
- new_top:      this scan's #1 differs from the last scan's #1 (or there was no last scan)
- price_drop:   a watched pick is >= 15% cheaper than the last price we told the user
- long_weekend: a długi-weekend window starts within 21 days and its best trip scores >= 0.8

Gate: when `rec.fit` (AI fit verdict, docs/FIT_VERDICT.md) is present, only good_fit/great_fit
pass; otherwise the score thresholds below apply.
User control: muted cities, snooze, max N per week, and one notification per dedupe key.
"""

from datetime import date, datetime, timedelta

from tripai import i18n
from tripai.agents.explain import template_why
from tripai.notify.models import Decision, Notification, NotificationKind, NotificationPrefs
from tripai.scoring.types import RankedRecommendation
from tripai.scoring.windows import BridgeWindow

NEW_TOP_MIN_SCORE = 0.6
LONG_WEEKEND_MIN_SCORE = 0.8
LONG_WEEKEND_WITHIN_DAYS = 21
PRICE_DROP_MIN = 0.15
GOOD_FIT = {"good_fit", "great_fit"}
PRIORITY = {"price_drop": 0, "long_weekend": 1, "new_top": 2}


def gate(rec: RankedRecommendation, min_score: float) -> tuple[bool, str]:
    if rec.fit is not None:
        ok = rec.fit.label in GOOD_FIT
        return ok, f"fit verdict {rec.fit.label}" + ("" if ok else " (only good/great fit notify)")
    ok = rec.score.total >= min_score
    cmp = ">=" if ok else "<"
    return ok, f"score {rec.score.total:.2f} {cmp} {min_score:.2f} (no fit verdict)"


def when(rec: RankedRecommendation) -> str:
    """'7-11 Nov' / '7-11 lis' (current language)."""
    s, e = rec.window.start, rec.window.end
    if s.month == e.month:
        return f"{s.day}-{e.day} {i18n.month(s.month)}"
    return f"{s.day} {i18n.month(s.month)}-{e.day} {i18n.month(e.month)}"


def pts(score: float) -> int:
    return round(score * 100)


def cost_line(rec: RankedRecommendation) -> str:
    """One traveller: total = flight + hotel. A group: per person, the group total, and how it
    is built (flights x n + the rooms) - docs/BUDGET.md "Party pricing"."""
    n = rec.travelers
    return i18n.t(
        "n.cost" if n == 1 else "n.cost.party",
        total=i18n.fmt_pln(rec.total_cost_pln),
        group=i18n.fmt_pln(rec.party_total_pln or rec.total_cost_pln * n),
        n=n,
        flight=i18n.fmt_int(rec.flight_cost_pln),
        hotel=i18n.fmt_int(rec.hotel_cost_pln),
        pts=pts(rec.score.total),
    )


class Draft:
    """A notification candidate before user-control filters."""

    def __init__(self, kind: NotificationKind, rec: RankedRecommendation, title: str, body: str):
        self.kind, self.rec, self.title, self.body = kind, rec, title, body
        self.dedupe_key = f"{kind}:{rec.id}"

    def with_key(self, key: str) -> "Draft":
        self.dedupe_key = key
        return self


def draft_new_top(
    top: RankedRecommendation | None, prev_top_id: str | None, prev_top_city: str | None
) -> tuple[Draft | None, Decision]:
    if top is None:
        return None, Decision(kind="new_top", notify=False, reason="no recommendations")
    if top.id == prev_top_id:
        return None, Decision(
            kind="new_top", recommendation_id=top.id, notify=False, reason="#1 unchanged"
        )
    ok, why = gate(top, NEW_TOP_MIN_SCORE)
    if not ok:
        return None, Decision(kind="new_top", recommendation_id=top.id, notify=False, reason=why)
    changed = prev_top_city and prev_top_city != top.city
    was = i18n.t("n.new_top.prev", city=prev_top_city) if changed else ""
    d = Draft(
        "new_top",
        top,
        i18n.t("n.new_top.title", city=top.city, dates=when(top)),
        f"{cost_line(top)}.{was}",
    )
    return d, Decision(kind="new_top", recommendation_id=top.id, notify=True, reason=why)


def draft_price_drop(
    rec: RankedRecommendation, baseline_pln: float
) -> tuple[Draft | None, Decision]:
    now = rec.total_cost_pln
    drop = (baseline_pln - now) / baseline_pln if baseline_pln > 0 else 0.0
    if drop < PRICE_DROP_MIN:
        reason = f"{now:.0f} PLN vs watched {baseline_pln:.0f} PLN ({-drop:+.0%}), need -15%"
        return None, Decision(
            kind="price_drop", recommendation_id=rec.id, notify=False, reason=reason
        )
    ok, why = gate(rec, 0.0)
    if not ok:
        return None, Decision(kind="price_drop", recommendation_id=rec.id, notify=False, reason=why)
    d = Draft(
        "price_drop",
        rec,
        i18n.t("n.drop.title", city=rec.city, dates=when(rec), pct=round(drop * 100)),
        i18n.t(
            "n.drop.body" if rec.travelers == 1 else "n.drop.body.party",
            now=i18n.fmt_pln(now),
            was=i18n.fmt_pln(baseline_pln),
            n=rec.travelers,
            flight=i18n.fmt_int(rec.flight_cost_pln),
            hotel=i18n.fmt_int(rec.hotel_cost_pln),
        ),
    ).with_key(f"price_drop:{rec.id}:{now:.0f}")
    return d, Decision(
        kind="price_drop", recommendation_id=rec.id, notify=True, reason=f"-{drop:.0%}; {why}"
    )


def soon_long_weekends(bridges: list[BridgeWindow], today: date) -> list[BridgeWindow]:
    horizon = today + timedelta(days=LONG_WEEKEND_WITHIN_DAYS)
    return [b for b in bridges if today <= b.window.start <= horizon]


def draft_long_weekend(
    bridge: BridgeWindow, best: RankedRecommendation | None
) -> tuple[Draft | None, Decision]:
    if best is None:
        return None, Decision(
            kind="long_weekend", notify=False, reason=f"no trips for {bridge.label}"
        )
    ok, why = gate(best, LONG_WEEKEND_MIN_SCORE)
    if not ok:
        return None, Decision(
            kind="long_weekend", recommendation_id=best.id, notify=False, reason=why
        )
    d = Draft(
        "long_weekend",
        best,
        i18n.t("n.lw.title", city=best.city, dates=when(best)),
        f"{bridge.label}. {cost_line(best)}.",
    )
    return d, Decision(kind="long_weekend", recommendation_id=best.id, notify=True, reason=why)


def apply_user_control(
    drafts: list[Draft],
    prefs: NotificationPrefs,
    *,
    now: datetime,
    sent_last_week: int,
    already_sent: set[str],
) -> tuple[list[Draft], list[Decision]]:
    """Filter drafts by prefs; returns (kept, decisions for the dropped ones)."""
    dropped: list[Decision] = []
    muted = {m.strip().lower() for m in prefs.muted_cities if m.strip()}
    budget = max(0, prefs.max_per_week - sent_last_week)
    kept: list[Draft] = []
    seen: set[str] = set()
    for d in sorted(drafts, key=lambda d: PRIORITY[d.kind]):

        def drop(reason: str, d=d) -> None:
            dropped.append(
                Decision(kind=d.kind, recommendation_id=d.rec.id, notify=False, reason=reason)
            )

        if d.dedupe_key in already_sent or d.dedupe_key in seen:
            drop("already notified")
        elif prefs.snooze_until and prefs.snooze_until > now:
            drop(f"snoozed until {prefs.snooze_until:%Y-%m-%d %H:%M}")
        elif d.rec.city.lower() in muted or d.rec.iata.lower() in muted:
            drop(f"{d.rec.city} is muted")
        elif len(kept) >= budget:
            drop(f"weekly limit reached ({prefs.max_per_week}/week)")
        else:
            kept.append(d)
            seen.add(d.dedupe_key)
    return kept, dropped


def to_notification(
    d: Draft, user_id: str, interests: dict[str, float], scan_run_id: str | None
) -> Notification:
    rec = d.rec
    fit = rec.fit
    return Notification(
        user_id=user_id,
        kind=d.kind,
        title=d.title,
        body=d.body,
        recommendation_id=rec.id,
        inputs_hash=rec.inputs_hash,
        scoring_version=rec.scoring_version,
        why=rec.why or template_why(rec, interests),  # rec.why is already in the scan's language
        evidence=rec.evidence,
        score=rec.score,
        fit_label=fit.label if fit else None,
        fit_summary=fit.summary if fit else None,
        concerns=fit.concerns if fit else [],
        recommendation=rec,
        url=f"/trips/{rec.id}",
        dedupe_key=d.dedupe_key,
        scan_run_id=scan_run_id,
    )
