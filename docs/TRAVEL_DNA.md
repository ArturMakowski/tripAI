# Travel DNA (DNA Podróżnika): swipe profile spec

Source: team questionnaire (short version). 12 statements (1–5) + 2 yes/no, asked as **swipe cards**.
The mapping to `TasteProfile` + `Weights` is **deterministic** and lives in the backend (`tripai.profile.dna`),
exposed as `POST /profile/dna`. The frontend only collects answers and renders the returned reasons.

## Swipe semantics
| Gesture (button / key) | Statement card | Yes/no card |
|---|---|---|
| ← left (`←`) | 1 "Nie ja" / Not me | Nie / No |
| ↓ down (`↓`) | 3 "Zależy" / Depends | – |
| → right (`→`) | 4 "To ja" / That's me | Tak / Yes |
| ↑ up (`↑`) | 5 "Bardzo ja!" / So me | – |
Undo is always available. The result screen shows every answer as an editable 1–5 dot scale (so 2 is reachable there).

## Cards (id · PL · EN)
| id | PL | EN |
|---|---|---|
| q1 | Lubię odkrywać miejsca, których jeszcze nie znam. | I love discovering places I don't know yet. |
| q2 | Podczas podróży wolę mieć zaplanowany każdy dzień. | I prefer every travel day to be planned. |
| q3 | Lubię spontanicznie zmieniać plany podczas podróży. | I like changing plans spontaneously. |
| q4 | Ważniejsze są dla mnie doświadczenia niż komfort. | Experiences matter more to me than comfort. |
| q5 | Chętnie poznaję lokalną kuchnię i kulturę. | I'm keen on local food and culture. |
| q6 | Szukam przede wszystkim odpoczynku i relaksu. | Above all I look for rest and relaxation. |
| q7 | Lubię aktywnie spędzać czas (pieszo, rower, woda). | I like being active (hiking, cycling, water). |
| q8 | Często wybieram miejsca mniej turystyczne. | I often pick less touristy places. |
| q9 | Cena ma duży wpływ na wybór kierunku i atrakcji. | Price strongly drives where I go and what I do. |
| q10 | Jestem skłonny zapłacić więcej za wyjątkowe doświadczenie. | I'll pay more for a unique experience. |
| q11 | Lubię podróżować z dala od tłumów. | I like travelling away from crowds. |
| q12 | Chętnie wracam do miejsc, które już znam. | I happily return to places I know. |
| y1 | Czy chcesz odkrywać nowe miejsca każdego dnia? | Do you want to discover new places every day? |
| y2 | Czy aplikacja ma dopasowywać rekomendacje do Twojego stylu? | Should the app tailor recommendations to your style? |

## Mapping (n(a) = (a − 1) / 4 ∈ [0, 1]; missing answer = 3)
**Weights** (then normalised to sum 1):
- price   = 0.25 + 0.35·n(q9) − 0.15·n(q10)
- crowds  = 0.10 + 0.20·avg(n(q8), n(q11))
- taste   = 0.20 + 0.15·n(q4) + 0.10·n(q10)
- weather = 0.20 + 0.05·n(q6)

**Interests** (tag → 0..1): food = n(q5) · culture = n(q5) · history = 0.8·n(q5) · beach = n(q6) · wellness = n(q6) ·
hiking = n(q7) · nature = max(n(q7), 0.6·n(q6)) · offbeat = avg(n(q8), n(q11)) · discovery = avg(n(q1), 1 − n(q12)).

**Dislikes:** `crowds` if q8 ≥ 4 or q11 ≥ 4.

**Luxury:** budget if q9 ≥ 4 and q10 ≤ 2 · luxury if q10 ≥ 4 and q4 ≤ 2 · comfort if q4 ≤ 2 · else standard.

**Traits** (stored raw in `TasteProfile.traits`): pace = n(q2) − n(q3) (>0.25 structured, < −0.25 spontaneous, else balanced),
novelty = discovery. y1 → `daily_discovery` (itinerary/explain prefers a new attraction per day).
y2 → `personalize`. **If No: neutral default weights, interests kept only as filters, and post-trip feedback does not
change the profile** (user control; stated on screen).

## Response: `POST /profile/dna`
`{user_id, answers: {q1..q12: 1..5}, yes_no: {y1: bool, y2: bool}}` →
`{profile: TasteProfile, weights: Weights, reasons: [{field: "weights.crowds"|"interests.food"|..., value, because: ["q8","q11"], text}]}`.
Every derived value lists the card ids that produced it, so the UI can say "because you swiped *So me* on …".
