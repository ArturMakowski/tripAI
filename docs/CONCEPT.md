# TripAI — concept (HackYeah 2026, AI open task)

## One-liner
Tell us who you are and when you're free — TripAI proactively tells you **where and when** to go,
and shows you why it's the best deal.

> "You're free 14–19 Jan. Go to Rome: return flights from KRK for 260 PLN, hotels −35% vs. summer,
> low crowds in winter, 14°C and sunny. Matches your love of food and history."

## Core hook: proactive where + when (reverse search)
The user never types a destination. Inputs: taste profile (interview), budget/luxury level,
origin airport, free days (calendar). Output: ranked trip cards (destination + dates + total cost),
pushed proactively when a good window/deal appears.

## User control & verifiability (explicit judging requirement)
- Every price/fact carries **source + timestamp**.
- "Why this?" panel: score breakdown (price, weather, crowds, taste fit).
- **LLM never invents numbers**: LLM = interview, preference extraction, explanations, tool orchestration.
  Ranking = deterministic scoring function over fetched data.
- Optimisation slider: price ↔ comfort ↔ experience; re-ranks live.
- Nothing is booked/sent without explicit user confirmation.

## Learning loop
Post-trip survey → updates taste profile → better next recommendations.

## In-trip (stretch)
Disruption (cancelled flight/bus) → replan proposal → user approves.

## Business model
Affiliate commission on bookings; premium in-trip support. Paid placement never alters ranking;
sponsored items are labelled separately (trust is the product).

## Known limitations (state them to judges)
- Not a tour operator: no Package Travel Directive / UFG coverage; books via partners.
- Historical price seasonality partly seeded/cached where no live API exists.
- Europe-first (origin: Polish airports) for data density.

## Stack (decided)
Python first: pydantic-ai agents, optionally DBOS for durable workflows (proactive scans, replanning),
Supabase (Postgres + auth). Next.js mobile-first web frontend if needed.

## Demo story (~3 min)
1. Short interview → taste profile.  2. Calendar → free window found.
3. Proactive cards: where + when + cost + why + sources; slider re-ranks.
4. Confirm → booking handoff.  5. (stretch) Disruption → replan.  6. Post-trip survey → profile updates.

## Positioning (after competitor research, see COMPETITORS.md)
"An auditable recommendation engine, not a chatbot." Differentiators: free-time-triggered proactive picks,
sourced deterministic score, visible learning from feedback, PL "długi weekend" radar.
