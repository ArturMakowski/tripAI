# Competitors (researched 2026-10-03)

**Verdict:** no product does the full loop: calendar/free time → deterministic, sourced where+when ranking → push → post-trip learning.
Every individual piece exists somewhere. Biggest threat: **Google Gemini** (Flight Deals, AI Mode, Personal Intelligence), not the startups.

## Already exists (don't pitch as new)
- Chat itineraries: commodity (Mindtrip, Layla, Booking, Tripadvisor, Wanderlog, ChatGPT, Perplexity)
- "Vague trip → cheap destination + dates": Google Flight Deals, Kayak AI Mode, Skyscanner Explore with AI, Kiwi AI Mode (Jun 2026), eSky MAIA (PL)
- Proactive deal push: Going, Jack's Flight Club, Fly4free
- Calendar-aware assistants: Gemini Personal Intelligence (Jan 2026), ChatGPT Pulse (general-purpose, mostly for trips already booked)
- In-trip disruption help: Expedia Romie, Kiwi "Nathan", Otto

## Genuinely novel in combination
1. **The trigger is your free time, not a query**: calendar → pushed, ranked where+when.
2. **Auditable ranking**: deterministic multi-factor score (price, weather, crowds, taste); every number has source + timestamp.
   Nobody shows a multi-factor score (Google gets closest, with price insights only).
3. **A post-trip survey that visibly changes your weights** (everyone else claims vague "learning").
4. **PL/EU regional-airport wedge**: booking in Google AI Mode is US-only; the Expedia ChatGPT app excludes the EU.

## Pitch
> "An auditable recommendation engine, not a chatbot." The LLM interviews and explains; a deterministic scorer decides.
> Trust gap: 89% of travellers want AI help, only 12% trust AI to decide alone (Booking.com survey).

Answer to "Google could add this": explainability + local (PL holidays, regional airports) + learning loop.

## Wedges adopted
- **Długi weekend radar**: PL holidays + per-voivodeship winter school holidays (ferie) + calendar → bridge-day windows ("take 1 day off → 4 days in Lisbon, score 87").
- **"Why this, why now" receipt**: score breakdown, sources, deltas vs summer and vs the next-best window, "what would flip it", inputs hash for reproducibility.
- **Live learning on stage**: survey "Barcelona crowds 2/5" → crowd weight up → live re-rank → push "Free 14–19 Jan → Rome".

## Caveats
Google Flight Deals coverage in PL unverified; Mindtrip's "learning" is a marketing claim; Hipmunk held US patent US8606801
("calendar-based suggestion of a travel option") — don't claim the concept was never done.
Sources: see the research notes (Mindtrip, 9to5google, kayak.com/news/ai-mode, antyweb.pl on eSky MAIA, openai.com Pulse, etc.).
