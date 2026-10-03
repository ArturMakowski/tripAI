from tripai.models import Weights
from tripai.scoring import apply_feedback


def test_bad_crowds_raise_crowd_weight(profile):
    res = apply_feedback(profile, Weights(), {"crowds": 2}, trip_tags=["food"], trip_label="BCN")
    assert res.weights.crowds > Weights().crowds
    assert abs(sum(res.weights.model_dump().values()) - 1) < 1e-3
    first = res.diff[0]
    assert first.field == "weights.crowds" and "2/5" in first.reason
    assert {c.field for c in res.diff} == {
        f"weights.{f}" for f in ("price", "weather", "crowds", "taste")
    }


def test_tag_ratings_and_lists(profile):
    res = apply_feedback(
        profile, Weights(), {"food": 5, "beach": 1, "loved": ["art"], "disliked": ["heat"],
                             "overall": 4}, trip_tags=["food", "beach"])  # fmt: skip
    assert res.profile.interests["food"] == 0.95
    assert res.profile.interests["beach"] == 0.35
    assert res.profile.interests["art"] == 0.7
    assert "heat" in res.profile.dislikes
    assert res.weights == Weights()  # no factor ratings -> weights untouched


def test_crowds_one_adds_dislike_and_weather_narrows(profile):
    res = apply_feedback(profile, Weights(), {"crowds": 1, "weather": 2}, trip_temp_c=25)
    assert "crowds" in res.profile.dislikes
    assert res.profile.preferred_temp_c == (15.0, 24.0)


def test_satisfied_changes_nothing(profile):
    res = apply_feedback(profile, Weights(), {"price": 5, "weather": 4})
    assert res.diff == [] and res.profile == profile
