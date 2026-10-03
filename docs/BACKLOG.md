# Backlog
- [x] T1 core: scoring engine + pydantic-ai agents + FastAPI endpoints (fixture connectors)
- [x] T2 connectors: live clients + Supabase/disk cache + recorded fixtures
- [x] T3 seed: candidate cities, airports, Eurostat crowd scores, holidays, attractions → data/
- [ ] T4 frontend: mobile-first Next.js app (interview, proactive cards, why-panel, slider, survey)
- [ ] T4b swipe onboarding = Travel DNA deck (docs/TRAVEL_DNA.md), frontend
- [ ] T1b POST /profile/dna deterministic mapping + personalize=False honoured, backend
- [ ] T5a integration: LiveProvider (seed + connectors) behind core Provider, Supabase persistence
- [ ] T5b proactive scan (DBOS daily + "Run scan now") → in-app inbox + web push (VAPID), prefs/opt-in, migration 0003
- [ ] T1c AI fit verdict agent vs Travel DNA (docs/FIT_VERDICT.md) + eval set; gates T5b notifications; UI badge (after T1b)
- [ ] T6 pitch: 10-slide PDF + demo script ("auditable engine, not a chatbot" — see COMPETITORS.md)
- [ ] T7 replan on disruption (stretch)

Wedges (from COMPETITORS.md), folded into tasks:
- Długi weekend radar → T3 (holidays + ferie data) + T1 (bridge-day window finder)
- Receipt card w/ counterfactuals + inputs hash → T1 (deltas, hash) + T4 (UI)
- Live learning loop → T1 (/feedback adjusts weights) + T4 (survey → re-rank animation)
- [x] Deploy: Railway project tripai, backend at <backend-url> (auto-deploy from main)
- [ ] Deploy frontend service on Railway after T4 merges
- [ ] T4f date-range calendar on Free time (select fitting dates → windows for /recommendations)
- [ ] i18n PL/EN app-wide (frontend after #15) + backend lang
