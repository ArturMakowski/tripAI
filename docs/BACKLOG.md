# Backlog
- [x] T1 core: scoring engine + pydantic-ai agents + FastAPI endpoints (fixture connectors)
- [x] T2 connectors: live clients + Supabase/disk cache + recorded fixtures
- [x] T3 seed: candidate cities, airports, Eurostat crowd scores, holidays, attractions → data/
- [ ] T4 frontend: mobile-first Next.js app (interview, proactive cards, why-panel, slider, survey)
- [ ] T4b swipe onboarding = Travel DNA deck (docs/TRAVEL_DNA.md), frontend
- [ ] T1b POST /profile/dna deterministic mapping + personalize=False honoured, backend
- [ ] T5a integration: LiveProvider (seed + connectors) behind core Provider, Supabase persistence
- [ ] T5b DBOS proactive scan workflow + notifications (after T1+T2)
- [ ] T6 pitch: 10-slide PDF + demo script ("auditable engine, not a chatbot" — see COMPETITORS.md)
- [ ] T7 replan on disruption (stretch)

Wedges (from COMPETITORS.md), folded into tasks:
- Długi weekend radar → T3 (holidays + ferie data) + T1 (bridge-day window finder)
- Receipt card w/ counterfactuals + inputs hash → T1 (deltas, hash) + T4 (UI)
- Live learning loop → T1 (/feedback adjusts weights) + T4 (survey → re-rank animation)
- [x] Deploy: Railway project tripai, backend at https://backend-production-f17bd.up.railway.app (auto-deploy from main)
- [ ] Deploy frontend service on Railway after T4 merges
