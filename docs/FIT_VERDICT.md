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
- **Cost:** only the top N (default 5) per request.
  - **Cache:** cached by a stable key: trip (city, dates, tags, highlights, weather, crowd) × style profile (DNA,
    interests, dislikes, temperature, luxury; no user id, budget or prices) × language × engine/prompts.
  - **Prefetch:** the fast phase prefetches the top verdicts.
  - **Speculation:** GPT starts speculatively only when Jev takes > 1 s.
- **Style, not price:** the verdict judges the person's style (weather, crowds, taste). Price vs budget is shown by the
  budget status and value badge, never as "not your style". q9 (price-driven) adds a named "expensive" concern
  that never downgrades the label.
- **A named minus:** `mixed` / `poor_fit` always lists ≥ 1 concrete concern. If the engine's concerns don't survive
  grounding, the rules' grounded concerns are used; if the rules have none either, the rules verdict is shown.
- **Sticky label:** the first label shown for a profile + trip stays on reload. This covers a rules fallback at the
  deadline and an engine failing in time. A later AI verdict replaces it only if it agrees on the label, so a
  disagreeing AI verdict isn't shown until the cache TTL (6 h) expires (product decision: stability over freshness).

## Verifiability (for the jury)
`backend/tests/fit_eval/`: ~20 hand-labelled (DNA profile × offer) cases → `uv run python -m tripai.agents.fit_eval`
prints agreement with the labels (and with the rules fallback). Shown in the pitch as "AI agreement 17/20 on labelled cases".

## Engines (decided 2026-10-03): Jev decides, GPT explains, rules back-stop
`TRIPAI_FIT_ENGINE=jev|llm|rules` (default `jev` when a TypeSafe key is set). Jev runs via **pydantic-ai's
`TypeSafeModel`** (`pydantic-ai-slim[typesafe]`, model `typesafe:jev-latest`; key from `TYPESAFE_API_KEY` or `TYPESAFEAI_API_KEY`).
- One Pydantic `output_type` per decision: `label` (implemented as an ordered rubric 0..3 = poor/mixed/good/great: a
  4-way pick-one split its confidence over neighbouring labels, ~0.4, so the gate made everything `mixed`) + one `bool` per DNA
  check (e.g. `crowd_conflict`, `relax_conflict`, `budget_conflict`, `pace_conflict`, `novelty_match`), field docstrings /
  `BoolCriteria` as the question text. Calibrated confidences from `result.response.provider_details['confidence']`
  become `FitVerdict.confidence` and per-point confidence.
- Jev can't write text: `summary` and the wording of matches/concerns come from GPT-6 Luna (or a template), which may only
  phrase Jev's decisions + cited evidence. `FitVerdict.model` records the engine, e.g. `typesafe:jev-1.13.0+openai:gpt-6-luna`.
- Low confidence (< 0.6 on label) → `mixed` + "we're not sure; here's why", never a confident wrong label.
- Fallback chain: Jev → LLM → rules (pydantic-ai `FallbackModel` where it fits).
- Smoke test (3 Oct): Barcelona Aug 95% crowds → poor_fit 0.93, 657 ms; Valletta Jan 20% crowds → great_fit 0.97, 284 ms.

Other Jev decision points: notification gate (`worth_interrupting: bool`, push only if p ≥ 0.8), chat interview → DNA
(`int` score per q1..q12 from free text, follow-up when confidence < 0.6), guardrail on user free text
(`prompt_injection`, `off_topic`). The fit eval prints jev vs llm vs rules: agreement, p50 latency, cost.

Implemented in T1e (`tripai.agents.jev`, see README), with one change decided on 3 Oct: **cascade instead of
collapse**. When Jev's label confidence is >= 0.5 (`TRIPAI_JEV_ESCALATE_BELOW`), Jev decides. Below that, the
decision escalates to GPT-6 Luna (System 2) under the same grounding validator, then to rules. The 0.6 -> `mixed`
rule applies only when the final engine is GPT and its self-rated confidence is low. `FitVerdict.model` says who
decided. Per-point confidence is applied as a filter (a check is shown only at P(yes) >= 0.7), because `FitPoint`
has no confidence field yet (a contract change is its own PR).
Live eval (3 Oct, 20 cases): cascade 16/20 exact, 20/20 within one, p50 ~3.0 s, ~$0.00022, 15% escalated;
Jev alone 14/20, 20/20, ~0.5 s, ~$0.0001; GPT-6 Luna alone 14/20, 20/20, ~6.5 s, ~$0.0003; rules 10/20, 18/20.
