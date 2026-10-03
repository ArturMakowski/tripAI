# Demo-day checklist (SerpApi free tier: 30 searches/day, resets 00:00 UTC = 02:00 PL)

The exact-date hotel prices (and many exact flight prices) come from SerpApi. With 30/day, protect them for the demo:

1. **Freeze**: no live SerpApi from workers/e2e/local runs on demo day (tests use fixtures / phase=fast).
2. **Lower the public cap** the evening before: `railway variables -s backend --set TRIPAI_SERPAPI_DAILY_CAP=0`
   (fast phase + cache still work; testers see labelled estimates).
3. **~1 h before the demo**: set the cap back to 30, then warm the demo path once:
   `cd backend && uv run python -m tripai.warm` (prod-equivalent env; shared Supabase cache + budget).
   Check `/api/health` → `serpapi_budget.used` (expect ~10–15) and open the demo profile's top cards:
   they must show `price_status: exact` with real hotel names (no "inne daty" / "średnia w mieście").
4. **Set the cap back to 0** after warming, so stray traffic can't burn the rest. Cached results keep serving.
5. **Smoke test**: `cd e2e && npm run e2e:replay` (no model calls) plus a manual walkthrough on a phone.
6. **Fallback**: if exact prices are missing, demo with honest estimates and say why (it's a feature: we never
   show other-dates prices as yours).

Upgrading SerpApi ($25 / 1,000 searches) removes most of this: then set the daily cap to ~150 and warm freely.
