"""Per-user state (profile, weights, last recommendations, feedback). In-memory here;
`tripai.api.supabase_store.SupabaseStore` persists it to the tables in `supabase/migrations`."""

from typing import Protocol

from tripai.models import TasteProfile, Weights
from tripai.scoring.types import RankedRecommendation


class Store(Protocol):
    def get_profile(self, user_id: str) -> TasteProfile | None: ...
    def save_profile(self, profile: TasteProfile) -> None: ...
    def get_weights(self, user_id: str) -> Weights | None: ...
    def save_weights(self, user_id: str, weights: Weights) -> None: ...
    def save_recommendations(self, user_id: str, recs: list[RankedRecommendation]) -> None: ...
    def get_recommendation(self, rec_id: str) -> RankedRecommendation | None: ...
    def save_feedback(self, user_id: str, trip_id: str, answers: dict, diff: list) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self.profiles: dict[str, TasteProfile] = {}
        self.weights: dict[str, Weights] = {}
        self.recs: dict[str, RankedRecommendation] = {}
        self.feedback: list[dict] = []

    def get_profile(self, user_id: str) -> TasteProfile | None:
        return self.profiles.get(user_id)

    def save_profile(self, profile: TasteProfile) -> None:
        self.profiles[profile.user_id] = profile

    def get_weights(self, user_id: str) -> Weights | None:
        return self.weights.get(user_id)

    def save_weights(self, user_id: str, weights: Weights) -> None:
        self.weights[user_id] = weights

    def save_recommendations(self, user_id: str, recs: list[RankedRecommendation]) -> None:
        self.recs.update({r.id: r for r in recs})

    def get_recommendation(self, rec_id: str) -> RankedRecommendation | None:
        return self.recs.get(rec_id)

    def save_feedback(self, user_id: str, trip_id: str, answers: dict, diff: list) -> None:
        self.feedback.append({"user_id": user_id, "trip_id": trip_id, "answers": answers,
                              "diff": diff})  # fmt: skip
