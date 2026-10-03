# Pitch: 10-slide PDF + product video (EN + PL)

Sources: the user's Obsidian vault (UAM lecture "Prezentacja projektu przed inwestorem", "Launch Video Craft"
in wiki/concepts/code-rendered-motion-design.md, wiki/concepts/ai-trust-through-verifiable-workflows.md),
docs/CONCEPT.md, docs/COMPETITORS.md, docs/FIT_VERDICT.md (eval table), HackYeah brief.

## Message
- **Elevator pitch:** FOR people with free days but no plan, WHO want great trips without travel-agency guesswork,
  TripAI IS a proactive AI travel planner THAT tells you where AND when to go, from your free time, budget and
  Travel DNA, UNLIKE chat planners and fare search, every number is sourced and the ranking is reproducible.
- **Positioning:** "An auditable recommendation engine, not a chatbot."
- **Three layers:** Jev decides (fit, confidence), a fixed formula ranks (sourced numbers), GPT explains (grounded only).

## Deck: 10 slides, 16:9, 30/20/10 rule (big font, one idea per slide, diagrams > text)
1. **Hook:** "You have free days. We tell you where and when." Hero phone screenshot (a real card).
2. **Problem:** a persona (Kraków, 1,000 PLN, long weekend in Nov). Travel agencies are opaque; chat AI plans
   are unverifiable (89% want AI help, 12% trust it to decide: Booking.com survey, COMPETITORS.md).
3. **Solution / use case:** the story in 4 phone frames: swipe Travel DNA → calendar/radar → ranked where+when
   → receipt.
4. **How it works:** pipeline diagram: calendar + DNA → connectors (Travelpayouts, Google Flights/Hotels via
   SerpApi, Open-Meteo, Eurostat) → fixed scorer → Jev fit check (→ GPT if unsure) → grounded explanation → user.
5. **AI's role and tech decisions:** pydantic-ai, Jev (TypeSafe) System-1 classifier, GPT-6 Luna, DBOS durable
   scans, Supabase with RLS, two-phase fast/full. **Eval table:** cascade 16/20 vs Jev 14/20, GPT 14/20,
   rules 10/20; 0.5 s vs 6.5 s.
6. **Verify and stay in control:** source + timestamp on every number, inputs hash, "what would flip it",
   hard budget, nothing booked without confirm, personalisation off switch, Jev guardrail.
   Quote: "if an AI answer is hard for the user to check, that difficulty is a product smell."
7. **Learning loop + proactive:** swipe on offers / post-trip survey change weights visibly; DBOS daily scan →
   push only when Jev p ≥ 0.8.
8. **Competition / why us:** feature matrix excerpt (COMPETITORS.md): Google, Kayak, Mindtrip, eSky MAIA vs
   TripAI. Our wedge: free-time trigger + auditable score + visible learning + PL long weekends.
9. **Business model + limitations (honest):** affiliate commission, premium alerts, never paid ranking.
   Limits: not a tour operator, Calendar OAuth still sample data, small eval set (20), SerpApi quota.
10. **Completeness + team:** live URL + QR, ~23 PRs merged, 365+ backend / 147 frontend tests, every PR
    reviewed by a fresh agent; [Team name] / [Members] placeholders; AI-use disclosure line.
    End card (poster): name + URL.

**Style:** warm white, black UI, one accent (TripAI green #1f5a45 or the app's token), Inter/Geist,
real screenshots in phone frames. Generate as HTML → PDF (Playwright), EN + PL from one source.

## Video: 60–70 s, 16:9, 4K master, design for mute, captions + ~120 BPM royalty-free music + SFX
- **0–3 s:** product mid-action (cards re-ranking as the slider moves) + caption "Masz wolne 7–11 listopada." /
  "You're free 7–11 Nov."
- **3–10 s:** the turn: "Gdzie i kiedy? Już nie zgadujesz." Swipe Travel DNA (fast).
- **10–45 s:** **slow on the core:** the radar picks a long weekend → ranked cards with fit badges → open the
  receipt: sources/timestamps, Jev "Why it fits you / Watch out" → budget banner. Cursor highlights one thing.
- **45–58 s:** text-only card: "Jev decides · Formula ranks · GPT explains · Every number sourced", then a push
  notification arrives.
- **58–70 s:** poster: TripAI + URL, held 3–4 s.

**Production:** record the LIVE Railway app with Playwright (device iPhone 14, deterministic data via warmed
cache / demo profile), composite into HTML scenes (phone frame on warm-white canvas, big centred captions) with a
seek(t) timeline, capture frames, encode with ffmpeg. Gates: plan → 5 stills → animatic → full → audio.
**Banned:** crossfades, blur-ins, 3D, particles, glows, holds > 1 s. Music must be royalty-free with a licence
note (Mixkit). Loudness −14 LUFS. Outputs: tripai-pitch-en.mp4 / tripai-pitch-pl.mp4.
