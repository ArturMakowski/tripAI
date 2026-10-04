# Demo-day checklist

## State (4 Oct, warmed)
- **Demo path is warm**: Kraków (KRK) · 7–11 Nov · 1 person (and 2 people). Top 10 cities have **exact** flight + hotel
  prices with real hotel names (Larnaca, Catania, Heraklion, Palma, Dubrovnik, Nice, Málaga, Naples, Munich, Oslo);
  restaurants + things to do cached for the top 8 in PL and EN. Measured on prod: first results ~1–1.7 s, full
  ranking ~5 s on a fresh profile, < 1.2 s on reload.
- **SerpApi throttling is off** for the demo: `TRIPAI_SERPAPI_DAILY_CAP=1000`, `TRIPAI_SERPAPI_REQUEST_CAP=25`. The only
  limit is SerpApi's free plan (250/month; ~136 left on 4 Oct, resets 1 Nov). A *fresh* search (other dates/airports)
  costs up to ~25; cached ones cost 0.
- e2e replay against prod: 15/15.

## Demo script (≈ 2 min, phone or narrow browser)
1. Open the app → **"Zaczynamy"** (welcome).
2. **Travel DNA**: swipe the 14 cards (right = to ja, up = bardzo ja, down = zależy, left = nie ja). Say: "no forms,
   just swipes".
3. **One confirm**: "7–11 lis · najbliższy długi weekend · 1 osoba · Kraków" is pre-filled → **"Pokaż wyjazdy"**.
   (If it proposes other dates, tap *Zmień* and pick 7–11 Nov: that's the warm path.)
4. **Ranked list**: point at where + when, the exact all-in price, the fit badge; swipe one row right ("Chcę tam" →
   "Zapamiętane…"), one left (+ undo). Persona card on top.
5. **Trip page** (e.g. Catania): flight + hotel by name, map/transfers, restaurants & things to do, "why now";
   tap **ⓘ Źródła** → every number has a source and a date.
6. **Plan it** → hand-off links for the trip's own dates (we don't book).
7. **Moje podróże**: watched trip, target price; **Powiadomienia**: the daily scan pings only when it matters.
8. Close on the deck's last slide: "Long weekend 7–11 Nov. Where would you go?"

## Before going on stage
- [ ] Open the app once on the presenting device (warms the frontend), switch language as needed.
- [ ] Re-run the demo path on prod: `/trips` for 7–11 Nov shows `exact` prices (no "szacunek") on the top cards.
- [ ] `cd e2e && npm run e2e:replay` (no SerpApi; ~3 min) → 15/15.
- [ ] Check the quota: `curl -s "https://serpapi.com/account.json?api_key=$SERPAPI_API_KEY" | jq .plan_searches_left`
      (free endpoint). Keep ≥ 30 for a re-warm.
- [ ] Don't run local live searches or recordings with SerpApi on the day.

## Re-warm (if the cache expired or dates changed)
Run the same request the app makes, with a wider refine (top 12) so any DNA's top picks are covered:
`TRIPAI_PROVIDER=live TRIPAI_USE_FIXTURES=0 TRIPAI_FIXTURE_SOURCES=gcal TRIPAI_LIVE_TOP_N=12
TRIPAI_SERPAPI_REQUEST_CAP=40 uv run python -m tripai.warm --profile <ola.json>` (or POST `/recommendations` with
`windows=[7–11 Nov]`, `limit=15`), then verify on prod as above. Cost: ≤ ~30 searches when cold.

## If something fails
- Prices show "~X · szacunek": the exact-date price isn't cached for that city/date. Say it plainly: we never pass
  off other-dates prices as yours. Then open a warm city (Catania, Larnaca).
- Slow "Refining…": the first results are already usable; the AI texts arrive within ~5 s or fall back to the rules
  verdict.
- After the demo: set `TRIPAI_SERPAPI_DAILY_CAP` back to a small number (e.g. 30) so testers can't drain the month.
