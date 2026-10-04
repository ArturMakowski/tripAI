#!/usr/bin/env bash
# Quality gate: a FRESH Claude session scores every slide preview 1-10 (clarity, design, judge-criteria fit).
# Usage: ./critic.sh en|pl   -> ../out/critique-<lang>.md
set -euo pipefail
cd "$(dirname "$0")"
LANG_=${1:-en}
# Score the real deck (out/private, built with TRIPAI_APP_URL) when it exists, else the public build.
PREV=$(cd ../out/preview && pwd)  # the public build: what is committed and shown
HOST=$(node -e 'try{console.log(new URL(process.env.TRIPAI_APP_URL).host)}catch{console.log("<none>")}')
FILES=$(ls "$PREV"/"$LANG_"-*.png | tr '\n' ' ')
claude -p --model claude-opus-5-5 --no-session-persistence --allowedTools Read --output-format text "You are a strict, independent pitch-deck critic for a hackathon jury (HackYeah 2026, AI open task).
Score each slide on CLARITY (one idea, readable from 3 m, no clutter), STORY (does it advance a clear story: persona Ola, Kraków,
free 7–11 Nov → TripAI tells her where and when, with receipts → why it's trustworthy → how it works → how we differ → business → close) and
HONESTY (claims match what the screenshots show; estimates labelled; no overclaiming; hypotheses marked).
Read each slide image with the Read tool: ${FILES}
Context (do not penalise): the deck language is '${LANG_}'; phone screenshots are real captures of the live app; '[app URL]' is a deliberate placeholder in the public build; prices marked 'estimate' are honest labels by design; the visual style is bold modern sans (Inter), green + coral.
For EVERY slide give integer scores 1-10 for clarity, story, honesty, and list concrete fixes for any score below 9 (which element, what to change).
Be harsh: 8 means a jury would be impressed. Output ONLY a markdown table: | slide | clarity | story | honesty | fixes | then one line 'MIN: <lowest score anywhere>'." \
  | sed "s|${HOST}|<frontend-url>|g"  # the report is committed; the repo is public
