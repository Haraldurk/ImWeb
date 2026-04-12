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

# ── Find the newest capture by timestamp prefix ───────────────────────────────
NEWEST=$(ls -t "${BRAINSTORMS_DIR}"/[0-9]*-* 2>/dev/null | head -1 || true)

if [[ -z "$NEWEST" ]]; then
  echo -e "${YELLOW}⚠  No timestamp-prefixed capture files found in ${BRAINSTORMS_DIR}/${RESET}"
  exit 1
fi

PREFIX=$(basename "$NEWEST" | cut -d'-' -f1)
echo -e "${CYAN}Using capture prefix: ${PREFIX}${RESET}"

AUDIO_FILE="${BRAINSTORMS_DIR}/${PREFIX}-audio.webm"
IMAGE_FILE="${BRAINSTORMS_DIR}/${PREFIX}-screenshot.png"
JSON_FILE="${BRAINSTORMS_DIR}/${PREFIX}-state.json"
NOTES_FILE="${BRAINSTORMS_DIR}/${PREFIX}-notes.txt"
[[ -f "$AUDIO_FILE"  ]] || AUDIO_FILE=""
[[ -f "$IMAGE_FILE"  ]] || IMAGE_FILE=""
[[ -f "$JSON_FILE"   ]] || JSON_FILE=""
[[ -f "$NOTES_FILE"  ]] || NOTES_FILE=""

# Abort only if state JSON is missing (always produced by a capture)
if [[ -z "$JSON_FILE" ]]; then
  echo -e "${YELLOW}⚠  No state.json found for prefix ${PREFIX} in ${BRAINSTORMS_DIR}/${RESET}"
  exit 1
fi

[[ -n "$AUDIO_FILE"  ]] && echo -e "  ${GREEN}✓${RESET} Audio     : $(basename "$AUDIO_FILE")"  || echo -e "  ${YELLOW}-${RESET} Audio     : (none for this capture)"
[[ -n "$IMAGE_FILE"  ]] && echo -e "  ${GREEN}✓${RESET} Screenshot: $(basename "$IMAGE_FILE")"  || echo -e "  ${YELLOW}-${RESET} Screenshot: (none for this capture)"
echo -e "  ${GREEN}✓${RESET} State JSON: $(basename "$JSON_FILE")"
[[ -n "$NOTES_FILE"  ]] && echo -e "  ${GREEN}✓${RESET} Notes     : $(basename "$NOTES_FILE")"  || echo -e "  ${YELLOW}-${RESET} Notes     : (none for this capture)"
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

# ── Temporarily hide .gitignore so Gemini CLI can read all project files ──────
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
GITIGNORE="${PROJECT_ROOT}/.gitignore"

restore_gitignore() {
  [[ -f "${GITIGNORE}.bak" ]] && mv "${GITIGNORE}.bak" "${GITIGNORE}"
}
trap restore_gitignore EXIT INT TERM

[[ -f "$GITIGNORE" ]] && mv "$GITIGNORE" "${GITIGNORE}.bak"

gemini \
  --yolo \
  --output-format text \
  -p "$PROMPT" \
  > "$OUTPUT_FILE"

echo -e "\n${BOLD}${GREEN}✓ Specification written to:${RESET}"
echo -e "  ${OUTPUT_FILE}"
