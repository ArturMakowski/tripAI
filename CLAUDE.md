# TripAI — HackYeah 2026 (AI open task)

Proactive AI travel planner: from taste profile + budget + free calendar days, recommends **where AND when** to go,
with transparent, verifiable reasoning. Read `docs/CONCEPT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_SOURCES.md` first.

## Backlog
`docs/BACKLOG.md` (no external tracker). One task = one worktree = one PR into `main`.

## Conventions
- Python 3.12, `uv` (run everything via `uv run` inside `backend/`), pydantic v2, pydantic-ai, FastAPI, DBOS, Supabase (Postgres).
- `ruff` format + lint, `pytest`. Tests must pass without network or API keys (use fixtures in `backend/tests/fixtures/`).
- Secrets only via env vars (see `.env.example`); never commit `.env`.
- The LLM never produces prices/scores: numbers come from connectors + `tripai.scoring`. Every fact carries `source` + `fetched_at`.
- Shared contract lives in `backend/src/tripai/models.py` — change it only in a dedicated PR; frontend mirrors it in `frontend/lib/types.ts`.
- Stay inside the directories your task owns (see ARCHITECTURE.md "Ownership").
- Definition of done: tests + ruff green, short README section for what you added, PR opened with `gh pr create` against `main`.
