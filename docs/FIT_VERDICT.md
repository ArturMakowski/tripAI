# AI fit verdict: "is this offer actually good for *you*?"

The deterministic scorer ranks; the **fit agent** gives a second, qualitative opinion that is grounded in the user's
Travel DNA (docs/TRAVEL_DNA.md) and the recommendation's evidence. It catches what a weighted sum can't:
a relax-seeker (q6=5) sent to a nightlife city, a crowd-avoider (q11=5) landing in carnival week, a planner (q2=5)
offered a trip with nothing bookable, "cheap" that is only cheap because the weather is bad.

## Contract (`tripai.models.FitVerdict`, on `Recommendation.fit`)
- `label`: `great_fit | good_fit | mixed | poor_fit`
- `confidence`: 0..1
- `summary`: one sentence, user-facing (PL/EN per UI language)
- `matches[]` / `concerns[]`: each `{text, dna: ["q6","q11"], evidence: [indexes into Recommendation.evidence]}`
- `model`, `inputs_hash` (same as the scorer's), `created_at`

## Grounding rules (enforced by an output validator → ModelRetry, then fallback)
1. Every match/concern cites ≥ 1 DNA card id **and/or** ≥ 1 evidence index that exists.
2. No numbers that aren't in the cited evidence (reuse the explain agent's number guard).
3. If the agent fails or no LLM key: deterministic fallback from score + DNA rules (label from score bands,
   concerns from hard rules like `dislikes ∋ crowds ∧ crowd score > 0.7`), `model = "rules"`.

## How it is used
- **Cards / receipt:** a fit badge + "Why it fits you" (matches) and "Watch out" (concerns), each concern links to the evidence.
  If label and score disagree (high score, `poor_fit`), show both openly ("Cheap and sunny, but you said you avoid crowds").
- **Never hides options silently:** `poor_fit` cards are collapsed under "Not your style (show anyway)".
- **Notifications (T5b):** only notify for `good_fit`/`great_fit`; the concern list travels with the notification.
- **Personalize = No (y2):** verdict still shown, but computed against neutral DNA and labelled so.
- **Cost:** only the top N (default 5) per request; cached by (inputs_hash, profile hash).

## Verifiability (for the jury)
`backend/tests/fit_eval/`: ~20 hand-labelled (DNA profile × offer) cases → `uv run python -m tripai.agents.fit_eval`
prints agreement with the labels (and with the rules fallback). Shown in the pitch as "AI agreement 17/20 on labelled cases".
