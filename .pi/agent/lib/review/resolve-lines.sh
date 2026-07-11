#!/usr/bin/env bash
#
# resolve-lines.sh — map a position inside a unified diff to the real source
# line it refers to.
#
# WHY THIS EXISTS: reviewers read .review/diff.patch through a line-numbered
# view and sometimes report a finding's line as the line's *position within
# diff.patch* rather than the source-file line. This tool converts those patch
# offsets back to real `path:source_line` deterministically by walking the
# hunk headers (`@@ -a,b +c,d @@`), so findings can be verified/repaired.
#
# Usage:
#   resolve-lines.sh <diff.patch> <patch_line> [<patch_line> ...]
#
# Output (one line per requested offset):
#   <patch_line> -> <path>:<source_line>
#   <patch_line> -> (removed/header line — no source line)
#
# bash 3.2 compatible (no associative arrays).
#
set -euo pipefail

patch="${1:-}"
if [[ -z "$patch" || ! -f "$patch" ]]; then
  echo "usage: resolve-lines.sh <diff.patch> <patch_line> [...]" >&2
  exit 2
fi
shift

# Space-delimited list of wanted offsets for membership testing.
wanted=" $* "

path=""; newno=0; i=0
# Accumulate answers so we can print in the order requested.
results=""
while IFS= read -r line || [[ -n "$line" ]]; do
  i=$((i+1))
  hit=0
  case " $wanted " in *" $i "*) hit=1;; esac
  case "$line" in
    "+++ b/"*) path="${line#+++ b/}"; continue;;
    "+++ "*|"--- "*) continue;;
    "@@"*)
      plus="${line#*+}"; c="${plus%% *}"; c="${c%%,*}"
      [[ "$c" =~ ^[0-9]+$ ]] && newno=$((c-1))
      continue;;
    "diff "*|"index "*|"new file"*|"deleted file"*|"similarity "*|"rename "*|"Binary "*)
      continue;;
    "+"*) newno=$((newno+1)); [[ $hit -eq 1 ]] && results+="$i -> $path:$newno"$'\n';;
    "-"*) [[ $hit -eq 1 ]] && results+="$i -> (removed line in $path — no source line)"$'\n';;
    " "*) newno=$((newno+1)); [[ $hit -eq 1 ]] && results+="$i -> $path:$newno"$'\n';;
    *)    newno=$((newno+1)); [[ $hit -eq 1 ]] && results+="$i -> $path:$newno"$'\n';;
  esac
done < "$patch"

# Re-emit in the order the caller asked for.
for w in "$@"; do
  match="$(printf '%s' "$results" | grep -E "^$w -> " || true)"
  if [[ -n "$match" ]]; then
    printf '%s\n' "$match"
  else
    printf '%s -> (out of range or header line)\n' "$w"
  fi
done
