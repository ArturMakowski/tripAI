"""docs/BUDGET.md: typical spend, value badges, and money-consistency invariants (both phases)."""

import asyncio
import re
from datetime import date

import pytest
from fastapi.testclient import TestClient

from tripai import i18n
from tripai.api import create_app
from tripai.models import FreeWindow, TasteProfile
from tripai.scoring import FixtureProvider, rank
from tripai.scoring.budget_fit import rank_within_budget
from tripai.scoring.engine import DEFAULT_SPEND_PLN, shown_total
from tripai.scoring.value import annotate_value, typical_spend

WINDOWS = [FreeWindow(start=date(2026, 11, 7), end=date(2026, 11, 11)),
           FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 18)),
           FreeWindow(start=date(2027, 7, 10), end=date(2027, 7, 15))]  # fmt: skip
PROFILES = [
    TasteProfile(user_id="a", interests={"food": 0.9, "history": 0.7}, traits={"q11": 5.0}),
    TasteProfile(user_id="b", luxury="budget", interests={"beach": 1.0}, preferred_temp_c=(22, 30)),
    TasteProfile(user_id="c", luxury="luxury", budget_pln=1200, interests={"art": 1.0}),
]


def _cands(luxury="standard"):
    return asyncio.run(FixtureProvider().candidates("KRK", WINDOWS, luxury))


def _num(s: str) -> list[int]:
    return [int(x.replace(" ", "").replace(" ", "")) for x in re.findall(r"\d[\d  ]*\d|\d", s)]


# ---------------------------------------------------------------- typical spend


def test_typical_spend_history_vs_dna():
    p = TasteProfile(user_id="u", luxury="comfort")
    assert typical_spend(p).model_dump() == {"pln": 4000, "source": "dna", "trips": 0}
    assert typical_spend(p, [900, 1100]).source == "dna"  # < 3 trips: not enough history
    t = typical_spend(p, [900, 1100, 1500, 0, -5])
    assert (t.pln, t.source, t.trips) == (1100, "history", 3)


def test_typical_spend_drives_price_factor_and_hash():
    p = PROFILES[0]
    cands = _cands()
    base = rank(cands, p)
    same = rank(cands, p, typical_spend_pln=DEFAULT_SPEND_PLN[p.luxury])
    assert [r.inputs_hash for r in base] == [r.inputs_hash for r in same]  # default = no change
    frugal = rank(cands, p, typical_spend_pln=800)
    assert frugal[0].inputs_hash != base[0].inputs_hash
    by = {r.id: r.score.price for r in base}
    assert all(r.score.price <= by[r.id] for r in frugal if r.id in by)


def test_hard_limit_keeps_budget_as_price_reference():
    """#16 unchanged: with a limit set, the limit is the price reference, whatever the
    typical spend (review #2: limit above and below typical)."""
    from tripai.scoring.engine import price_score

    for luxury, limit in (("luxury", 1200), ("standard", 5000)):
        p = TasteProfile(user_id="h", luxury=luxury, budget_pln=limit, interests={"art": 1.0})
        cands = _cands(luxury)
        a = rank_within_budget(cands, p, None)
        b = rank_within_budget(cands, p, None, typical_spend_pln=900)
        c = rank_within_budget(cands, p, None, typical_spend_pln=9000)
        ids = [r.id for r, _ in a]
        assert ids == [r.id for r, _ in b] == [r.id for r, _ in c]
        for r, _ in a:
            cand = next(x for x in cands if f"{x.iata}-{x.window.start:%Y%m%d}" in r.id)
            want = price_score(cand.total_cost_pln, limit, cand.seasonal_median_cost_pln)
            assert r.score.price == round(want, 4)
    # the reviewer's case: 3000 PLN inside a 5000 limit is not scored against typical 2500
    assert price_score(3000, 5000, 3000) > price_score(3000, 2500, 3000)


# ---------------------------------------------------------------- value badges


def test_badges_only_without_hard_limit_and_only_exact_prices():
    p = PROFILES[0]
    recs = rank(_cands(), p, limit=8)
    annotate_value(recs, p, None, typical_spend(p))
    assert any(r.value_badge == "great_value" for r in recs)
    limited = p.model_copy(update={"budget_pln": 5000})
    annotate_value(recs, limited, None, typical_spend(p))
    assert all(r.value_badge is None and r.value_reason is None for r in recs)
    for r in recs:
        r.price_status = "estimate"
    annotate_value(recs, p, None, typical_spend(p))
    assert all(r.value_badge is None for r in recs)


def test_great_value_is_selective_and_numbers_are_real():
    for p in PROFILES[:2]:
        recs = rank(_cands(p.luxury), p, limit=8)
        t = typical_spend(p)
        annotate_value(recs, p, None, t)
        great = [r for r in recs if r.value_badge == "great_value"]
        assert 1 <= len(great) <= max(1, len(recs) // 4 + 1)
        for r in great:
            assert r.score.price >= 0.75 and r.score.total >= 0.65
            nums = _num(r.value_reason)
            assert round(r.total_cost_pln) in nums and round(100 * r.score.price) in nums
            if r.total_cost_pln < t.pln:
                assert round(t.pln) in nums and round(t.pln - r.total_cost_pln) in nums


def test_worth_splurge_names_what_the_money_buys():
    p = TasteProfile(user_id="s", interests={"food": 1.0, "history": 1.0},
                     preferred_temp_c=(17, 24), traits={"q11": 5.0})  # fmt: skip
    t = typical_spend(p, [500, 600, 700])  # a frugal history: typical 600
    by = {(c.iata, c.window.start.month): c for c in _cands()}
    # a cheap but cold, crowded, off-taste option vs a pricier, clearly better one
    cheap = by[("EDI", 1)].model_copy(update={"flight_cost_pln": 300, "hotel_cost_pln": 400,
                                              "crowd": 0.8})  # fmt: skip
    better = by[("ATH", 11)]
    recs = rank([cheap, better], p, limit=8, typical_spend_pln=t.pln)
    annotate_value(recs, p, None, t)
    r = next(r for r in recs if r.iata == "ATH")
    alt = next(r for r in recs if r.iata == "EDI")
    assert r.value_badge == "worth_splurge", (r.value_badge, r.score, alt.score)
    assert r.total_cost_pln > t.pln and r.total_cost_pln >= 1.15 * alt.total_cost_pln
    assert r.value_reason.startswith(f"Worth the splurge: {r.city}: ")
    assert f"more than {alt.city}" in r.value_reason
    nums = _num(r.value_reason)
    assert round(r.total_cost_pln - alt.total_cost_pln) in nums
    assert round(r.temp_c - alt.temp_c) in nums  # "+N °C warmer"
    assert round(100 * (1 - r.crowd / alt.crowd)) in nums  # "N% fewer crowds"
    # with a typical spend above the pricier trip, it isn't a splurge at all
    annotate_value(recs, p, None, typical_spend(p))
    assert r.value_badge != "worth_splurge"


def test_badges_identical_across_languages():
    p = PROFILES[0]
    recs_en = rank(_cands(), p, limit=8, lang="en")
    recs_pl = rank(_cands(), p, limit=8, lang="pl")
    annotate_value(recs_en, p, None, typical_spend(p), lang="en")
    annotate_value(recs_pl, p, None, typical_spend(p), lang="pl")
    assert [r.value_badge for r in recs_en] == [r.value_badge for r in recs_pl]
    pl = [r.value_reason for r in recs_pl if r.value_reason]
    assert pl and all("zł" in x and "PLN" not in x for x in pl)


# ---------------------------------------------------------------- money consistency (API)


def _check_money(r: dict, lang: str) -> None:
    assert r["total_cost_pln"] == r["flight_cost_pln"] + r["hotel_cost_pln"]
    texts = [r["why"], r["value_reason"] or "", (r["budget"] or {}).get("label", ""),
             (r["flip"] or {}).get("text", "")] + [c["text"] for c in r["counterfactuals"]]  # fmt: skip
    blob = " ".join(texts).lower()
    assert "per person" not in blob and "na osobę" not in blob
    assert "cheaper" not in blob and "more expensive" not in blob
    more, less, same = ("drożej", "taniej", "ta sama cena") if lang == "pl" else (
        " more", " less", "same price")  # fmt: skip
    for c in r["counterfactuals"]:
        subject, _, rest = c["text"].partition(": ")
        assert subject and not subject[0].islower() and rest, c["text"]  # names the option
        assert any(w in rest for w in (more, less, same)), c["text"]
        assert c["cost_delta_pln"] == c["total_cost_pln"] - r["total_cost_pln"]
    if r["value_badge"]:
        assert r["price_status"] == "exact"
        assert r["value_badge"] in {"great_value", "worth_splurge"} and r["value_reason"]


@pytest.mark.parametrize("phase", ["fast", "full"])
@pytest.mark.parametrize("lang", ["en", "pl"])
@pytest.mark.parametrize("profile", PROFILES, ids=["food", "beach-budget", "luxury-limit"])
def test_money_invariants_every_rec(phase, lang, profile):
    c = TestClient(create_app())
    body = {"profile": profile.model_dump(mode="json"), "today": "2026-10-03", "limit": 10,
            "lang": lang}  # fmt: skip
    recs = c.post(f"/recommendations?phase={phase}", json=body).json()
    assert recs
    for r in recs:
        _check_money(r, lang)
        assert r["typical_spend_pln"] > 0 and r["typical_spend_source"] in {"history", "dna"}
        assert ("zł" if lang == "pl" else "PLN") in r["typical_spend_label"]
    if profile.budget_pln:
        assert all(r["value_badge"] is None for r in recs)


def test_fast_and_full_agree_on_money():
    c = TestClient(create_app())
    body = {"profile": PROFILES[0].model_dump(mode="json"), "today": "2026-10-03", "limit": 10}
    fast = {r["id"]: r for r in c.post("/recommendations?phase=fast", json=body).json()}
    full = {r["id"]: r for r in c.post("/recommendations?phase=full", json=body).json()}
    for rid in fast.keys() & full.keys():
        for k in ("total_cost_pln", "flight_cost_pln", "hotel_cost_pln", "value_badge"):
            assert fast[rid][k] == full[rid][k], (rid, k)


def test_shown_total_never_off_by_one():
    cands = _cands()
    for c in cands:
        c2 = c.model_copy(update={"flight_cost_pln": c.flight_cost_pln + 0.5,
                                  "hotel_cost_pln": c.hotel_cost_pln + 0.5})  # fmt: skip
        assert shown_total(c2) == round(c2.flight_cost_pln) + round(c2.hotel_cost_pln)
    recs = rank([c.model_copy(update={"flight_cost_pln": 100.5, "hotel_cost_pln": 200.5})
                 for c in cands[:3]], PROFILES[0])  # fmt: skip
    assert all(r.total_cost_pln == r.flight_cost_pln + r.hotel_cost_pln for r in recs)


def test_history_from_likes_sets_typical_spend():
    c = TestClient(create_app())
    body = {"profile": PROFILES[0].model_dump(mode="json"), "today": "2026-10-03", "limit": 10}
    recs = c.post("/recommendations", json=body).json()
    for r in recs[:3]:
        assert c.post("/reactions", json={"recommendation_id": r["id"],
                                          "reaction": "like"}).status_code == 200  # fmt: skip
    again = c.post("/recommendations", json=body).json()
    want = sorted(r["total_cost_pln"] for r in recs[:3])[1]
    assert again[0]["typical_spend_source"] == "history"
    assert again[0]["typical_spend_pln"] == want
    with i18n.using("en"):
        assert again[0]["typical_spend_label"] == i18n.t("value.typical_chip",
                                                         amount=i18n.fmt_pln(want))  # fmt: skip


# ---------------------------------------------------------------- review fixes (#27)


class _CapturingProvider(FixtureProvider):
    def __init__(self):
        super().__init__()
        self.seen: list[float | None] = []

    async def candidates(self, origin, windows, luxury="standard", *, profile=None,
                         weights=None, typical_spend_pln=None):  # fmt: skip
        self.seen.append(typical_spend_pln)
        return await super().candidates(origin, windows, luxury)


def _like_three(c, body) -> float:
    recs = c.post("/recommendations", json=body).json()
    for r in recs[:3]:
        c.post("/reactions", json={"recommendation_id": r["id"], "reaction": "like"})
    return sorted(r["total_cost_pln"] for r in recs[:3])[1]


def test_provider_and_scan_get_the_same_typical_spend(monkeypatch):
    """Review #1: refinement targets (provider) and proactive scan use the cards' reference."""
    monkeypatch.setenv("TRIPAI_SCAN_MIN_INTERVAL_S", "0")
    monkeypatch.setenv("TRIPAI_SCAN_PER_MIN", "1000")
    prov = _CapturingProvider()
    app = create_app(provider=prov)
    c = TestClient(app)
    body = {"profile": PROFILES[0].model_dump(mode="json"), "today": "2026-10-03", "limit": 10}
    want = _like_three(c, body)
    again = c.post("/recommendations", json=body).json()
    assert again[0]["typical_spend_pln"] == want and prov.seen[-1] == want
    from tripai.workflows.scan import Scan

    uid = c.get("/session").json()["user_id"]
    ctx = asyncio.run(Scan(app.state.scan_deps).load_context(uid))
    assert ctx["typical_spend_pln"] == want
    prov.seen.clear()
    r = c.post("/scan/run", json={"today": "2026-10-20"})
    assert r.status_code == 200 and prov.seen and set(prov.seen) == {want}


def test_small_gaps_are_not_named_as_gains():
    """Review #4: a 1-pt taste lead never justifies a splurge."""
    from tripai.scoring.value import _splurge_parts

    base = rank(_cands(), PROFILES[0], limit=2)
    a, b = base[0], base[1]
    a2 = a.model_copy(update={"score": a.score.model_copy(update={"taste": 0.61, "weather": 0.5}),
                              "temp_c": 20.0, "crowd": 0.5})  # fmt: skip
    b2 = b.model_copy(update={"score": b.score.model_copy(update={"taste": 0.60, "weather": 0.5}),
                              "temp_c": 19.5, "crowd": 0.5})  # fmt: skip
    assert _splurge_parts(a2, b2) == []
    a3 = a2.model_copy(update={"score": a2.score.model_copy(update={"weather": 0.8})})
    with i18n.using("en"):
        assert _splurge_parts(a3, b2) == ["better weather (80 vs 50 pts)"]


def test_value_texts_say_their_money_basis():
    """Review #3: amounts are trip totals (flight + room), and say so."""
    for lang, label in (("en", "(flight + room)"), ("pl", "(lot + pokój)")):
        recs = rank(_cands(), PROFILES[0], limit=8, lang=lang)
        annotate_value(recs, PROFILES[0], None, typical_spend(PROFILES[0]), lang=lang)
        reasons = [r.value_reason for r in recs if r.value_reason]
        assert reasons and all(label in x for x in reasons)


def test_chip_is_honest_without_history():
    """Review #7: no history -> 'typical for your travel style', not 'you usually spend'."""
    c = TestClient(create_app())
    body = {"profile": PROFILES[0].model_dump(mode="json"), "today": "2026-10-03", "limit": 5}
    first = c.post("/recommendations", json=body).json()[0]
    assert first["typical_spend_source"] == "dna"
    assert first["typical_spend_label"].startswith("Typical for your travel style: ~2500 PLN")
    _like_three(c, body)
    again = c.post("/recommendations", json=body).json()[0]
    assert again["typical_spend_label"].startswith("You usually spend ~")
