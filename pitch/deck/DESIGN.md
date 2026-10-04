# Deck design rules

Sources: the vault notes `wiki/concepts/ai-assisted-design.md` (de-slopping: remove stuff, no accumulated
decoration, no interchangeable copy, real references, design from the product's own system) and
`code-rendered-motion-design.md` (few words, big; reading order headline → evidence → action).

## Rules
1. The deck uses the app's own design system (`frontend/app/globals.css`): paper `#f8f4ec`, card `#fffdf8`,
   line `#e3ddd2`, ink `#14231c`, pine `#215c48` (primary), clay `#c66843` (small labels, one highlight),
   Fraunces 500 for display, Geist for text, cards with a 1.5 px line border and ~30 px radius, pill buttons.
2. One idea per slide. Reading order: small clay label → Fraunces headline → one piece of evidence.
3. Evidence is real: app screenshots as captured, numbers with a source. Never redraw app UI.
4. Every element earns its place: no decorative icons, badges or banners; each claim said once in the deck.
5. No shadows (some PDF viewers turn them into grey boxes); only static font files (no Type 3 glyphs).
