from tripai.models import TasteProfile, Weights


def test_defaults():
    assert TasteProfile(user_id="u").origin_airports == ["KRK"]
    assert Weights().price > 0
