#!/usr/bin/env bash
# Quality gate: a FRESH Claude session scores every slide preview 1-10 (clarity, design, judge-criteria fit).
# Usage: ./critic.sh en|pl   -> ../out/critique-<lang>.md
set -euo pipefail
cd "$(dirname "$0")"
LANG_=${1:-en}
# Score the real deck (out/private, built with TRIPAI_APP_URL) when it exists, else the public build.
if [ -d ../out/private/preview ]; then PREV=$(cd ../out/private/preview && pwd); else PREV=$(cd ../out/preview && pwd); fi
HOST=$(node -e 'try{console.log(new URL(process.env.TRIPAI_APP_URL).host)}catch{console.log("<none>")}')
FILES=$(ls "$PREV"/"$LANG_"-*.png | tr '\n' ' ')
claude -p --model claude-opus-5-5 --no-session-persistence --allowedTools Read --output-format text "You are a strict, independent pitch-deck critic for a hackathon jury (HackYeah 2026, AI open task).
The judges score: (1) usefulness and the problem solved, (2) the role of AI and how well it is justified/measured,
(3) verifiability and user control (can the user check AI output, stay in control), (4) innovation vs existing products,
(5) completeness/working product, (6) business sense and honesty about limits. Presentation rules: 10 slides, 16:9,
big fonts (30pt+ body), one idea per slide, diagrams over text, warm white + black + one green accent.

Read each slide image with the Read tool: ${FILES}
(The deck language is '${LANG_}'. Phone screenshots are real captures of the live app; the app UI itself is mostly English
and its copy can NOT be changed for this deck, only recaptured/cropped. Fixed by the brief, do not penalise: the literal placeholders
'[Team name]' / '[Members]' (the team fills them in), the full app URL under the QR (it is the real deployment), the 10-slide structure
1 hook, 2 problem, 3 solution in 4 phones, 4 pipeline, 5 AI role + eval, 6 verify/control, 7 learning + proactive, 8 competition: the 'ChatGPT can do this' answer as structural differences + MCP roadmap (the eval is deliberately NOT used against ChatGPT),
9 business + limits, 10 completeness + team + QR. Invented market numbers are worse than none.)

For EVERY slide give integer scores 1-10 for clarity, design, criteria_fit, and list the concrete fixes that would raise any score below 9
(be specific: which element, what to change). Be harsh: 8 means 'a jury would be impressed', 10 is flawless.
Check legibility from 3 metres, crowding, overlaps, cut-off text, alignment, empty space, typos/grammar ${LANG_} copy.
Output ONLY a markdown table: | slide | clarity | design | criteria_fit | fixes | then one line 'MIN: <lowest score anywhere>'." \
  | sed "s|${HOST}|<frontend-url>|g"  # the report is committed; the repo is public
