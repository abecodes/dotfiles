#!/usr/bin/env bash
#
# _common.sh — shared helpers for the acquire-* scripts. Sourced, not run.
# Internal to the acquire dispatcher; the review skill never references it.
#
# Provides:
#   reviews_root           -> echoes the resolved (realpath'd, mkdir -p'd) root
#   ensure_under_root DIR  -> aborts unless DIR is inside the reviews root
#   safe_wipe DIR          -> rm -rf DIR (only if inside the reviews root), mkdir -p
#   json_escape STR        -> echoes a JSON-escaped string (no surrounding quotes)

# Resolve REVIEWS_ROOT to an absolute, existing path and echo it.
reviews_root() {
  local root="${REVIEWS_ROOT:-$HOME/Repos/reviews}"
  mkdir -p "$root"
  # realpath after mkdir so symlinks/.. are collapsed.
  realpath "$root"
}

# Abort unless $1 is strictly inside the reviews root.
ensure_under_root() {
  local dir="$1" root
  root="$(reviews_root)"
  case "$dir/" in
    "$root"/*) : ;;  # ok
    *)
      printf '[acquire] error: refusing to operate outside REVIEWS_ROOT (%s): %s\n' \
        "$root" "$dir" >&2
      exit 3
      ;;
  esac
}

# rm -rf a target dir (guarded) and recreate it empty.
safe_wipe() {
  local dir="$1"
  ensure_under_root "$dir"
  rm -rf "$dir"
  mkdir -p "$dir"
}

# Minimal JSON string escaper: backslash, double-quote, newline, tab, CR.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  printf '%s' "$s"
}
