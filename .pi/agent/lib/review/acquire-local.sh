#!/usr/bin/env bash
#
# acquire-local.sh — copy a local directory off-tree for review. Invoked by
# acquire.sh; not called directly by the skill.
#
# Two modes, chosen automatically:
#   git mode      (<path>/.git exists): rsync the whole tree (incl. .git and
#                 uncommitted work) to <root>/<base>-<branch>-<sha>/, review
#                 against a detected/overridden base ref. diff.patch is
#                 base..worktree (so it includes uncommitted changes);
#                 log.txt is `git log --oneline base..HEAD`.
#   full-tree     (no .git): rsync to <root>/<base>-fulltree-<ts>/, synthesize
#                 a git baseline so every file appears as added; diff.patch is
#                 the all-added patch, log.txt is empty.
#
# Args: <path> [--base <ref>]   (--base overrides base detection in git mode)
# Prints the absolute target dir on stdout.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

err() { printf '[acquire-local] error: %s\n' "$*" >&2; }

src="${1:-}"; shift || true
if [[ -z "$src" ]]; then err "no path given"; exit 2; fi
if [[ ! -d "$src" ]]; then err "not a directory: $src"; exit 2; fi

# Optional --base <ref>.
base_override=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) base_override="${2:-}"; shift 2 || { err "--base needs a ref"; exit 2; } ;;
    *) shift ;;
  esac
done

src_abs="$(realpath "$src")"
base_name="$(basename "$src_abs")"
ROOT="$(reviews_root)"
ts="$(date -u +%Y%m%d-%H%M%S)"

sanitize() { printf '%s' "$1" | tr '/ ' '--'; }

if [[ -d "$src_abs/.git" ]]; then
  # ---- git mode -----------------------------------------------------------
  branch="$(git -C "$src_abs" symbolic-ref --quiet --short HEAD 2>/dev/null || echo '(detached)')"
  head_full="$(git -C "$src_abs" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$head_full" ]]; then err "no HEAD commit in $src_abs"; exit 4; fi
  head_short="$(git -C "$src_abs" rev-parse --short HEAD)"

  # Resolve a base ref without fetching.
  base_ref=""
  if [[ -n "$base_override" ]]; then
    base_ref="$base_override"
  elif up="$(git -C "$src_abs" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    base_ref="$up"
  else
    for cand in origin/HEAD origin/main origin/master main master; do
      if git -C "$src_abs" rev-parse -q --verify "$cand" >/dev/null 2>&1; then
        base_ref="$cand"; break
      fi
    done
  fi
  if [[ -z "$base_ref" ]]; then
    err "could not detect a base ref (pass --base <ref>)"; exit 4
  fi
  if ! git -C "$src_abs" rev-parse -q --verify "$base_ref" >/dev/null 2>&1; then
    err "base ref does not resolve: $base_ref"; exit 4
  fi

  base_full="$(git -C "$src_abs" merge-base "$base_ref" HEAD 2>/dev/null || git -C "$src_abs" rev-parse "$base_ref")"
  base_short="$(git -C "$src_abs" rev-parse --short "$base_full")"

  dirty=false
  [[ -n "$(git -C "$src_abs" status --porcelain 2>/dev/null)" ]] && dirty=true

  target="$ROOT/${base_name}-$(sanitize "$branch")-${head_short}"
  safe_wipe "$target"
  rsync -a "$src_abs/" "$target/"

  mkdir -p "$target/.review"
  # base..worktree captures committed + uncommitted (review picks up dirty work).
  git -C "$target" diff "$base_full" > "$target/.review/diff.patch" 2>/dev/null || true
  git -C "$target" log --oneline "$base_full..HEAD" > "$target/.review/log.txt" 2>/dev/null || true

  {
    printf '{\n'
    printf '  "source": "%s",\n'        "$(json_escape "$src_abs")"
    printf '  "repo": "%s",\n'          "$(json_escape "$base_name")"
    printf '  "branch": "%s",\n'        "$(json_escape "$branch")"
    printf '  "base_ref": "%s",\n'      "$(json_escape "$base_ref")"
    printf '  "base_sha": "%s",\n'      "$(json_escape "$base_short")"
    printf '  "base_sha_full": "%s",\n' "$(json_escape "$base_full")"
    printf '  "head_ref": "%s",\n'      "HEAD"
    printf '  "head_sha": "%s",\n'      "$(json_escape "$head_short")"
    printf '  "head_sha_full": "%s",\n' "$(json_escape "$head_full")"
    printf '  "dirty": %s\n'            "$dirty"
    printf '}\n'
  } > "$target/.review/meta.json"

  printf '%s\n' "$target"
  exit 0
fi

# ---- full-tree mode -------------------------------------------------------
target="$ROOT/${base_name}-fulltree-${ts}"
safe_wipe "$target"
# Copy the source tree (no .git by construction in this mode).
rsync -a "$src_abs/" "$target/"

mkdir -p "$target/.review"
# Synthesize a baseline: init a repo, stage everything, diff against the empty
# tree so every file shows up as added.
empty_tree="$(git -C "$target" hash-object -t tree /dev/null 2>/dev/null || echo 4b825dc642cb6eb9a060e54bf8d69288fbee4904)"
(
  cd "$target"
  git init -q 2>/dev/null || true
  git add -A 2>/dev/null || true
  git -c core.quotepath=false diff --cached "$empty_tree" > ".review/diff.patch" 2>/dev/null || true
)
: > "$target/.review/log.txt"

{
  printf '{\n'
  printf '  "source": "%s",\n'        "$(json_escape "$src_abs")"
  printf '  "repo": "%s",\n'          "$(json_escape "$base_name")"
  printf '  "branch": null,\n'
  printf '  "base_ref": "review-base",\n'
  printf '  "base_sha": "%s",\n'      "${empty_tree:0:7}"
  printf '  "base_sha_full": "%s",\n' "$(json_escape "$empty_tree")"
  printf '  "head_ref": "review-head",\n'
  printf '  "head_sha": "fulltree",\n'
  printf '  "head_sha_full": "fulltree",\n'
  printf '  "dirty": false\n'
  printf '}\n'
} > "$target/.review/meta.json"

printf '%s\n' "$target"
