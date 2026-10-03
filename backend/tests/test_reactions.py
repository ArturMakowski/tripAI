from datetime import date

from fastapi.testclient import TestClient

from tripai.api import create_app
from tripai.api.state import MemoryStore
from tripai.models import FreeWindow, ScoreBreakdown, Weights
from tripai.scoring.reactions import apply_reaction, undo_reaction
from tripai.scoring.types import RankedRecommendation


def _rec(tags=("food", "history", "city"), **score) -> RankedRecommendation:
    s = {"price": 0.6, "weather": 0.6, "crowds": 0.6, "taste": 0.6, "total": 0.6, **score}
    return RankedRecommendation(
        id="FCO-20270114-20270119", city="Rome", country="Italy", iata="FCO",
        window=FreeWindow(start=date(2027, 1, 14), end=date(2027, 1, 19)),
        total_cost_pln=1500, flight_cost_pln=600, hotel_cost_pln=900,
        score=ScoreBreakdown(**s), evidence=[], rank=1, inputs_hash="h",
        scoring_version="v", tags=list(tags),
    )  # fmt: skip


def test_like_nudges_city_tags_with_reasons(profile):
    res = apply_reaction(profile, Weights(), _rec(), "like")
    assert res.profile.interests == {"food": 0.95, "history": 0.75, "city": 0.55}
    assert res.weights == Weights()  # a like never moves weights
    fields = [c.field for c in res.diff]
    assert fields == ["interests.food", "interests.history", "interests.city"]
    assert all("Rome" in c.reason and "Chcę tam" in c.reason for c in res.diff)
    assert res.diff[2].before is None  # new tag starts from neutral 0.5
    assert not res.record.hidden and res.note is None


def test_love_is_stronger_clamped_and_moves_the_best_factor_weight(profile):
    res = apply_reaction(profile, Weights(), _rec(crowds=0.9), "love")
    assert res.profile.interests["food"] == 1.0  # 0.9 + 0.1, clamped
    assert res.profile.interests["history"] == 0.8
    assert res.weights.crowds > Weights().crowds
    assert abs(sum(res.weights.model_dump().values()) - 1) < 1e-3
    assert res.diff[0].field == "weights.crowds" and "crowds score was 0.90" in res.diff[0].reason
    # at the clamp a second love changes nothing for that tag
    again = apply_reaction(res.profile, res.weights, _rec(crowds=0.9), "love")
    assert "interests.food" not in {c.field for c in again.diff}


def test_dislike_lowers_only_existing_interests_hides_and_weights_weakest(profile):
    res = apply_reaction(profile, Weights(), _rec(price=0.2, crowds=0.3), "dislike")
    assert res.profile.interests == {"food": 0.85, "history": 0.65}  # no 'city' invented
    assert res.record.hidden and "hidden" in res.note
    assert res.diff[0].field == "weights.price" and "only 0.20" in res.diff[0].reason


def test_mild_cards_do_not_move_weights(profile):
    assert apply_reaction(profile, Weights(), _rec(), "love").weights == Weights()
    assert apply_reaction(profile, Weights(), _rec(), "dislike").weights == Weights()


def test_personalize_off_records_but_changes_nothing(profile):
    off = profile.model_copy(update={"personalize": False})
    res = apply_reaction(off, Weights(), _rec(crowds=0.95), "love")
    assert res.diff == [] and res.profile == off and res.weights == Weights()
    assert "Personalisation is off" in res.note and res.record.personalized is False
    gone = apply_reaction(off, Weights(), _rec(), "dislike")
    assert gone.record.hidden and "hidden" in gone.note and gone.diff == []


def test_undo_restores_exactly_and_respects_later_changes(profile):
    res = apply_reaction(profile, Weights(), _rec(crowds=0.9), "love")
    p, w, diff, note = undo_reaction(res.profile, res.weights, res.record)
    assert p.interests == profile.interests and w == Weights() and note is None
    assert {c.field for c in diff} >= {"interests.food", "interests.city", "weights.crowds"}
    # food changed again after the swipe: undo keeps it and says so
    moved = res.profile.model_copy(update={"interests": {**res.profile.interests, "food": 0.3}})
    p2, _, _, note2 = undo_reaction(moved, res.weights, res.record)
    assert p2.interests["food"] == 0.3 and "city" not in p2.interests and "food" in note2


# ---------------------------------------------------------------- API

PROFILE = {"user_id": "attacker-chosen", "budget_pln": 2500,
           "interests": {"food": 0.9, "history": 0.7}}  # fmt: skip
REQ = {"profile": PROFILE, "today": "2026-10-03", "limit": 5}


def test_reactions_api_learn_hide_and_undo():
    store = MemoryStore()
    c = TestClient(create_app(store=store))
    recs = c.post("/recommendations", json=REQ).json()
    top, second = recs[0], recs[1]

    liked = c.post("/reactions", json={"recommendation_id": top["id"], "reaction": "like",
                                       "user_id": "someone-else"}).json()  # fmt: skip
    assert liked["learned"] and liked["profile"]["user_id"].startswith("s_")  # session, not client
    assert all(d["field"].startswith("interests.") for d in liked["diff"])
    assert liked["profile"]["interests"] != PROFILE["interests"] and not liked["hidden"]

    # subsequent /recommendations with the learned profile reflect it (different ranking input)
    again = c.post("/recommendations", json={**REQ, "profile": liked["profile"]}).json()
    assert again[0]["inputs_hash"] != top["inputs_hash"]

    gone = c.post("/reactions", json={"recommendation_id": second["id"],
                                      "reaction": "dislike"}).json()  # fmt: skip
    assert gone["hidden"]
    ids = {r["id"] for r in c.post("/recommendations", json={**REQ, "limit": 10}).json()}
    assert second["id"] not in ids
    listed = c.get("/reactions").json()
    assert [r["reaction"] for r in listed] == ["dislike", "like"]

    undone = c.delete(f"/reactions/{second['id']}").json()
    assert undone["reaction"] is None and not undone["hidden"]
    ids = {r["id"] for r in c.post("/recommendations", json={**REQ, "limit": 10}).json()}
    assert second["id"] in ids
    assert c.delete(f"/reactions/{second['id']}").status_code == 404
    assert (
        c.post("/reactions", json={"recommendation_id": "nope", "reaction": "like"}).status_code
        == 404
    )
    assert (
        c.post("/reactions", json={"recommendation_id": top["id"], "reaction": "meh"}).status_code
        == 422
    )


def test_reactions_are_per_session():
    s = MemoryStore()
    c1 = TestClient(create_app(store=s))
    recs = c1.post("/recommendations", json=REQ).json()
    c1.post("/reactions", json={"recommendation_id": recs[0]["id"], "reaction": "dislike"})
    c2 = TestClient(c1.app)  # fresh cookie jar = another browser
    assert c2.get("/reactions").json() == []
    assert recs[0]["id"] in {r["id"] for r in c2.post("/recommendations", json=REQ).json()}
    assert len(s.reactions) == 1


def test_reswipe_replaces_previous_reaction():
    c = TestClient(create_app())
    top = c.post("/recommendations", json=REQ).json()[0]
    c.post("/reactions", json={"recommendation_id": top["id"], "reaction": "love"})
    res = c.post("/reactions", json={"recommendation_id": top["id"], "reaction": "like"}).json()
    # undo of the love, then the like: net effect is exactly one like step
    food = res["profile"]["interests"]["food"]
    assert food == 0.95
    assert [r["reaction"] for r in c.get("/reactions").json()] == ["like"]


def test_reactions_api_personalize_off():
    c = TestClient(create_app())
    off = {**PROFILE, "personalize": False}
    top = c.post("/recommendations", json={**REQ, "profile": off}).json()[0]
    res = c.post("/reactions", json={"recommendation_id": top["id"], "reaction": "love",
                                     "profile": off}).json()  # fmt: skip
    assert res["diff"] == [] and "Personalisation is off" in res["note"]
    assert res["profile"]["interests"] == off["interests"]
    assert len(c.get("/reactions").json()) == 1  # still recorded


async def test_supabase_store_persists_and_reloads_reactions(profile):
    import httpx

    from tripai.api.supabase_store import SupabaseStore

    seen: list[httpx.Request] = []
    stored = apply_reaction(profile, Weights(), _rec(), "dislike").record
    row = {"payload": stored.model_dump(mode="json")}

    def fake(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[row])
        return httpx.Response(201)

    client = httpx.Client(transport=httpx.MockTransport(fake))
    s = SupabaseStore("https://x.supabase.co", "k", client=client, background=False)
    loaded = await s.get_reactions("u1")  # cold process: read through, scoped to the user
    assert loaded[stored.recommendation_id].hidden
    assert seen[0].url.params["user_id"] == "eq.u1"
    await s.get_reactions("u1")
    assert len(seen) == 1  # loaded once
    liked = apply_reaction(profile, Weights(), _rec(tags=("food",)), "like").record
    await s.save_reaction(liked)
    body = seen[-1].content.decode()
    assert seen[-1].url.params["on_conflict"] == "user_id,recommendation_id" and '"like"' in body
    await s.delete_reaction("u1", liked.recommendation_id)
    assert seen[-1].method == "DELETE" and seen[-1].url.params["recommendation_id"].startswith(
        "eq."
    )
    assert liked.recommendation_id not in await s.get_reactions("u1")
