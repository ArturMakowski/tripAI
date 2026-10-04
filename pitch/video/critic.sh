#!/bin/bash
# Fresh critic session for the gate stills (no context from the building session). Usage: ./critic.sh en [extra note]
set -e
cd "$(dirname "$0")"
LANG_=${1:-en}
DIR=$(cd ../out/stills && pwd)
claude -p --model claude-opus-5-5 --allowedTools Read --add-dir "$DIR" --add-dir "$(pwd)" --add-dir "$(cd ../../docs && pwd)" <<PROMPT
You are a strict motion-design critic for a 65-second product launch video (16:9, 1080p/4K) for TripAI, a travel
planner. You did not make it; default to REJECT. Read these files:
- $(pwd)/plan.md (beat map, rules, look)
- $(pwd)/../../docs/PITCH.md (brief; see its Banned list)
- The five gate stills: $DIR/${LANG_}-opening.png (t=1.5 s), $DIR/${LANG_}-composition.png (t=11.4 s),
  $DIR/${LANG_}-product.png (t=39.2 s), $DIR/${LANG_}-transition.png (t=41.12 s, middle of the fastest transition),
  $DIR/${LANG_}-end.png (t=63 s, end card). Open each image and look closely (zoom in mentally on text and edges).
Hard rules (any violation caps the score at 5): no deployment URL anywhere; prices never featured (no caption/zoom/
highlight pointing at a price); no internal tech names (model/engine/infra) on screen; nothing from the banned list
(crossfades, blur-ins, 3D, particles, glows); deck look (cream, deep green, serif headline, hand-written accent).
Also judge: hierarchy and one focal point per frame, legibility at phone size after X compression, safe margins,
off-grid or cramped elements, whether the end card works as a poster, whether it feels premium and dynamic.
${2:-}
Output exactly:
SCORES: opening=X/10 composition=X/10 product=X/10 transition=X/10 end=X/10 OVERALL=X/10
TOP 5 FIXES: numbered, each "still → what is wrong → exact fix".
VERDICT: SHIP or REJECT (ship only if OVERALL >= 8 and every still >= 7).
PROMPT
