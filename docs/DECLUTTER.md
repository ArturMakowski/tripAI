# Declutter spec (design audit of the live app, iPhone 14, 3 Oct)

Words above the fold / total today: home 77/79 · deck 61/61 · DNA result 119/436 · profile 77/117 ·
windows 123/354 · trips 118/570 · receipt 144/607 · confirm 110/110 · survey 79/99 · inbox 83/83.
Screenshots: scratchpad/declutter/ (president's machine).

## Global rules
- ≤ 25 words above the fold (excl. header/nav). Headline ≤ 6 words + optional subline ≤ 10. No paragraph > 2 lines.
- One primary action per screen, visible without scrolling (sticky CTA if needed).
- Numbers before sentences: "13 °C · 0% rain · crowds 2%".
- Chips/icons instead of explanations: source = small chip `ⓘ Open-Meteo · 3 Oct`; tap → bottom sheet.
- Secondary sections are collapsed rows/sheets: "Evidence (8) ›", "What would flip it ›", "Audit ›".
- No dev chrome for users: remove the "Live API" pill (move to /credits or debug), never show model IDs.
- One language per screen (no "Lista" on EN). 4/8/16/24 spacing; ≤ 2 text styles per card.

## Always visible (trust) vs. one tap away
- **Visible:** total price + one compact source chip per line item; score ring; 4 factor bars/stars with points;
  "AI-written · sourced" chip; fit badge; "Nothing is booked" on confirm; "No paid rankings".
- **One tap away:** full evidence list; deal-comparison method; counterfactuals and "what would flip it"; next-best
  window; swipe quotes behind fit claims; formula explanation; data-confidence breakdown; inputs hash + scorer
  version; AI model id; cached-quote disclaimer.

## Per screen
**Trips (→ 25 / ≈220):**
- Notification toast must not cover the H1 (only when coming from the inbox, or auto-dismiss after 3 s).
- Remove the explainer subline. Collapse the weights legend behind "Weights ›".
- Window banner → chip "📅 1–3 Jan · other dates ›". "Live prices in" → 2 s toast, once.
- Cards: drop the "You're free" pill. One line of copy per card (AI one-liner clamped, or chips). Fit badge without
  "confidence 50%". The whole card is tappable with "›". Footer → "No paid rankings."

**Receipt (→ 25 / ≈200 visible):**
- Keep the hero. The "why" is clamped to 2 lines + More. The caption becomes the chip "🤖 AI-written · sourced".
- Remove the model-id/confidence line (→ Audit sheet). Fit block = badge only. Fit claims = bold claim only, with
  the swipe quotes behind "Because you swiped… ›". Remove the duplicate sights chips.
- Score: bars/stars + "85/100"; formula sentence → ⓘ.
- Receipt lines: flight, hotel, total with chips. The median-comparison sentence → chip
  "31% below typical (1,449 PLN)".
- Comparisons: show one runner-up row, the rest behind "Compare ›". Move the cached-quote disclaimer to confirm.
- Evidence → "Evidence · 8 sources ›" with short labels. Remove the stock-photo (serper:images) row — not evidence.
- Data confidence → chip "Data 69% live". What would flip it → collapsed, at most 1 line. Inputs hash → "Audit ›".

**Confirm (→ 40):**
- Line items as "label … amount" with chip + "est." tag.
- Disclaimer → "You book on the partner site. Prices may change." Checkbox: "I'll confirm the final price myself."

**Home (→ 25, CTA above fold):** collage about 30% smaller; 3 bullets → chips "Sourced prices · Transparent score
· You book".

**DNA result (→ 25 / ≈120):**
- About 20 "na podstawie: „Bardzo ja!"…" lines → ⓘ + sheet. Remove the explainer.
- Weights → one stacked bar. Interests → chips without numbers.
- "Edit answers (14) ›" collapsed. One CTA; the rest become text links.

**Profile (→ 25 / ≈70):** subline "Tap to edit. Trips re-rank."; tips → one-time tooltip; footer paragraph → ⓘ.

**Free time (→ 25 / ≈150):**
- Subline "From your calendar + PL holidays."
- Remove the calendar instructions (use an in-calendar hint) and the empty-state sentence.
- Radar: drop the explainer; show 2 cards + "+N more ›". "Already free" → compact list. Legend → ⓘ.

**Inbox (→ 25):** one-line explainer, one "Run scan now" button.

**Survey (→ 25):** "4 taps · tunes your ranking."

## Top 5 (impact ÷ effort)
1. Receipt collapses (Evidence / Flip / Audit sheets, chips, remove model id and stock-photo row): −400 words.
2. Trips cards: one line, tappable, no pill; delete explainer, duplicate live-prices text and window banner.
3. Home chips + CTA above the fold; toast never covers the H1.
4. DNA result: ⓘ instead of about 20 "na podstawie" lines; collapse answers (−300 words).
5. Global: remove the Live API pill, fix language mixing, one-line explainers on Free time / Profile / Inbox.
