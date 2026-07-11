#!/usr/bin/env bash
#
# anchor-line.sh — resolve a finding's true source line from a verbatim anchor.
#
# WHY THIS EXISTS: reviewers estimate a finding's line number, but the estimate
# can be off (e.g. a diff.patch offset instead of the source line). Each finding
# also carries an `anchor`: a short verbatim fragment of the flagged source line.
# This tool locates that fragment in the real file and returns the authoritative
# line number — deterministically, with no heuristic guessing. The agent's
# estimate is used only to disambiguate when the anchor occurs more than once.
#
# Usage:
#   anchor-line.sh <file> <anchor> [hint_line]
#
# Output (stdout): the resolved 1-based line number, nothing else.
# Exit codes:
#   0  resolved (unique match, or disambiguated/first match — see stderr)
#   3  anchor not found in file        (caller keeps the agent's estimate)
#   2  bad usage / file missing
#
# Notes:
#  - Matching is literal (grep -F): regex metacharacters in the anchor are safe.
#  - The anchor is matched as a substring of a line, so leading indentation in
#    the source does not need to be reproduced in the anchor.
#  - On multiple matches: if hint_line is given, the match nearest the hint is
#    chosen; otherwise the first match. A one-line note is written to stderr.
#
set -euo pipefail

file="${1:-}"; anchor="${2:-}"; hint="${3:-}"
if [[ -z "$file" || -z "$anchor" ]]; then
  echo "usage: anchor-line.sh <file> <anchor> [hint_line]" >&2
  exit 2
fi
if [[ ! -f "$file" ]]; then
  echo "anchor-line: file not found: $file" >&2
  exit 2
fi

# Collect matching line numbers (literal substring match).
lines=()
while IFS= read -r n; do lines+=("$n"); done < <(grep -nF -- "$anchor" "$file" 2>/dev/null | cut -d: -f1)

count=${#lines[@]}
if [[ $count -eq 0 ]]; then
  echo "anchor-line: anchor not found in $file: $anchor" >&2
  exit 3
fi
if [[ $count -eq 1 ]]; then
  printf '%s\n' "${lines[0]}"
  exit 0
fi

# Multiple matches — disambiguate.
if [[ -n "$hint" && "$hint" =~ ^[0-9]+$ ]]; then
  best="${lines[0]}"; bestd=2147483647
  for n in "${lines[@]}"; do
    d=$(( n > hint ? n - hint : hint - n ))
    if [[ $d -lt $bestd ]]; then bestd=$d; best=$n; fi
  done
  echo "anchor-line: $count matches in $file for anchor; chose $best nearest hint $hint" >&2
  printf '%s\n' "$best"
else
  echo "anchor-line: $count matches in $file for anchor; chose first (${lines[0]}); make the anchor more specific" >&2
  printf '%s\n' "${lines[0]}"
fi
exit 0
