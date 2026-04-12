#!/usr/bin/env bash
# process-ideas.sh — Feed the latest Dev Capture files to Gemini CLI for analysis.
# Usage: ./process-ideas.sh
# Requires: gemini CLI on PATH (npm i -g @google/gemini-cli)

set -euo pipefail

BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

BRAINSTORMS_DIR="$(cd "$(dirname "$0")/Brainstorms" && pwd)"

echo -e "${BOLD}${CYAN}=== ImWeb Dev Capture → Gemini ===${RESET}"
echo -e "${CYAN}Scanning ${BRAINSTORMS_DIR} for latest captures…${RESET}"

# ── Find the most recent file of each type ────────────────────────────────────
AUDIO_FILE=$(ls -t "${BRAINSTORMS_DIR}"/*-audio.webm     2>/dev/null | head -1 || true)
IMAGE_FILE=$(ls -t "${BRAINSTORMS_DIR}"/*-screenshot.png 2>/dev/null | head -1 || true)
JSON_FILE=$(ls  -t "${BRAINSTORMS_DIR}"/*-state.json     2>/dev/null | head -1 || true)
NOTES_FILE=$(ls -t "${BRAINSTORMS_DIR}"/*-notes.txt      2>/dev/null | head -1 || true)

# Abort if core files are missing
if [[ -z "$AUDIO_FILE" || -z "$IMAGE_FILE" || -z "$JSON_FILE" ]]; then
  echo -e "${YELLOW}⚠  Could not find all capture files in ${BRAINSTORMS_DIR}/${RESET}"
  echo    "   Expected: *-audio.webm, *-screenshot.png, *-state.json"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} Audio     : $(basename "$AUDIO_FILE")"
echo -e "  ${GREEN}✓${RESET} Screenshot: $(basename "$IMAGE_FILE")"
echo -e "  ${GREEN}✓${RESET} State JSON: $(basename "$JSON_FILE")"
if [[ -n "$NOTES_FILE" ]]; then
  echo -e "  ${GREEN}✓${RESET} Notes     : $(basename "$NOTES_FILE")"
else
  echo -e "  ${YELLOW}-${RESET} Notes     : (none found, skipping)"
fi
echo

# ── Read files inline so they travel in the text prompt ──────────────────────
STATE_JSON=$(cat "$JSON_FILE")
NOTES_TEXT=""
if [[ -n "$NOTES_FILE" ]]; then
  NOTES_TEXT=$(cat "$NOTES_FILE")
fi

# ── Compose the prompt ────────────────────────────────────────────────────────
SYSTEM_PROMPT="You are an expert technical product manager. Review the provided audio note, text notes, annotated screenshot, and JSON state from my WebGL app. Write a highly structured technical specification in Markdown. Include: 1. The Core Idea/Bug, 2. Required UI Changes, 3. Required Logic/Shader Updates, 4. Relevant state mappings."

NOTES_SECTION=""
if [[ -n "$NOTES_TEXT" ]]; then
  NOTES_SECTION="
- **Text notes**:

${NOTES_TEXT}
"
fi

PROMPT="${SYSTEM_PROMPT}

---

## Files for this analysis

- **Screenshot**: ${IMAGE_FILE}
- **Audio note**: ${AUDIO_FILE}
- **Parameter state (JSON)**:

\`\`\`json
${STATE_JSON}
\`\`\`
${NOTES_SECTION}
Please read the screenshot and audio files from disk (paths provided above) and produce the full Markdown specification."

# ── Output file ───────────────────────────────────────────────────────────────
OUTPUT_FILE="${BRAINSTORMS_DIR}/Idea-$(date +%s).md"

echo -e "${BOLD}Running Gemini CLI…${RESET}"
echo -e "${CYAN}Model : default${RESET}"
echo -e "${CYAN}Output: ${OUTPUT_FILE}${RESET}"
echo

# Pass Brainstorms dir so Gemini's file-read tool can access the image/audio,
# use --yolo to auto-approve tool calls, -p for headless, pipe output to file.
gemini \
  --include-directories "${BRAINSTORMS_DIR}" \
  --ignore-repo-rules \
  --yolo \
  --output-format text \
  -p "$PROMPT" \
  > "$OUTPUT_FILE"

echo -e "\n${BOLD}${GREEN}✓ Specification written to:${RESET}"
echo -e "  ${OUTPUT_FILE}"
