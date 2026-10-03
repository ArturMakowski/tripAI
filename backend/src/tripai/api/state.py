"""Per-user state (profile, weights, last recommendations, feedback). In-memory here;
`tripai.api.supabase_store.SupabaseStore` persists it to the tables in `supabase/migrations`.

Every method is async (a persistent store must never block the event loop) and every read is
scoped to the server-issued session user (`tripai.api.session`)."""

from typing import Protocol

from tripai.models import TasteProfile, Weights
from tripai.scoring.types import RankedRecommendation


class Store(Protocol):
    async def get_profile(self, user_id: str) -> TasteProfile | None: ...
    async def save_profile(self, profile: TasteProfile) -> None: ...
    async def get_weights(self, user_id: str) -> Weights | None: ...
    async def save_weights(self, user_id: str, weights: Weights) -> None: ...
    async def save_recommendations(
        self, user_id: str, recs: list[RankedRecommendation]
    ) -> None: ...
    async def get_recommendation(
        self, user_id: str, rec_id: str
    ) -> RankedRecommendation | None: ...
    async def save_feedback(
        self, user_id: str, trip_id: str, answers: dict, diff: list
    ) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self.profiles: dict[str, TasteProfile] = {}
        self.weights: dict[str, Weights] = {}
        self.recs: dict[tuple[str, str], RankedRecommendation] = {}  # (user_id, rec id)
        self.feedback: list[dict] = []

    async def get_profile(self, user_id: str) -> TasteProfile | None:
        return self.profiles.get(user_id)

    async def save_profile(self, profile: TasteProfile) -> None:
        self.profiles[profile.user_id] = profile

    async def get_weights(self, user_id: str) -> Weights | None:
        return self.weights.get(user_id)

    async def save_weights(self, user_id: str, weights: Weights) -> None:
        self.weights[user_id] = weights

    async def save_recommendations(self, user_id: str, recs: list[RankedRecommendation]) -> None:
        self.recs.update({(user_id, r.id): r for r in recs})

    async def get_recommendation(self, user_id: str, rec_id: str) -> RankedRecommendation | None:
        return self.recs.get((user_id, rec_id))

    async def save_feedback(self, user_id: str, trip_id: str, answers: dict, diff: list) -> None:
        self.feedback.append({"user_id": user_id, "trip_id": trip_id, "answers": answers,
                              "diff": diff})  # fmt: skip
