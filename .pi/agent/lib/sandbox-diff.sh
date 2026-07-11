#!/usr/bin/env bash
#
# sandbox-diff.sh — compute "what this run changed" for the implement gateways,
# inside a sandbox worktree. Replaces diff-with-untracked.sh.
#
# The baseline is the sandbox run baseline: PI_SANDBOX_BASE, the dirty-tree
# snapshot the worktree was branched from. It is exported into the descendant
# env by the subagent sandbox, so the gateways never have to be told it. Falls
# back to `--base <ref>` or HEAD (for an un-sandboxed run), then to the empty
# tree (fresh repo). New untracked files are made visible with a transient
# intent-to-add, undone before exit — touching nothing real, and the worktree
# index is throwaway anyway.
#
# Modes:
#   diff    [-C <dir>] [--base <ref>] [<pathspec>...]
#       Unified diff of the work tree vs the baseline, INCLUDING new untracked
#       files. The literal change-set the gateway reviews.
#   touched [-C <dir>] [--base <ref>] [<pathspec>...]
#       One line per text-changed file:
#           <path><TAB><startLine>-<endLine>[,<startLine>-<endLine>...]
#       Line numbers are NEW-file ranges (added/modified lines), so a gateway
#       can intersect a finding's line with what actually changed. Files with no
#       reviewable new lines (pure deletes, binary, content-less renames) are
#       omitted here — the gateway falls back to file-level scope for those via
#       the `diff` output.
#
# bash 3.2 compatible (macOS system bash).
set -euo pipefail

err() { printf '[sandbox-diff] error: %s\n' "$*" >&2; }

mode="diff"
case "${1:-}" in
  diff|touched) mode="$1"; shift ;;
esac

repo="."
base="${PI_SANDBOX_BASE:-}"
while true; do
  case "${1:-}" in
    -C)     repo="${2:-}"; [[ -z "$repo" ]] && { err "-C needs a directory"; exit 2; }; shift 2 ;;
    --base) base="${2:-}"; [[ -z "$base" ]] && { err "--base needs a ref"; exit 2; }; shift 2 ;;
    *) break ;;
  esac
done

if ! git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  err "not inside a git work tree: $repo"
  exit 1
fi

# Resolve the baseline: explicit/env > HEAD > empty tree.
if [[ -z "$base" ]]; then
  if git -C "$repo" rev-parse --verify -q HEAD >/dev/null; then
    base="HEAD"
  else
    base="$(git -C "$repo" hash-object -t tree /dev/null 2>/dev/null || echo 4b825dc642cb6eb9a060e54bf8d69288fbee4904)"
  fi
fi

# Transient intent-to-add so untracked-new files appear in the diff; undone on
# exit (only the files we marked).
marks_file="$(mktemp)"
cleanup() {
  if [[ -s "$marks_file" ]]; then
    while IFS= read -r -d '' f; do
      git -C "$repo" reset -q -- "$f" >/dev/null 2>&1 || true
    done < "$marks_file"
  fi
  rm -f "$marks_file"
}
trap cleanup EXIT

untracked=()
while IFS= read -r -d '' f; do untracked+=("$f"); done \
  < <(git -C "$repo" ls-files -z --others --exclude-standard -- "$@")
if [[ "${#untracked[@]}" -gt 0 ]]; then
  git -C "$repo" add -N -- "${untracked[@]}"
  printf '%s\0' "${untracked[@]}" > "$marks_file"
fi

emit_diff() {
  git -C "$repo" -c core.quotepath=false diff "$base" -- "$@"
}

case "$mode" in
  diff)
    emit_diff "$@"
    ;;
  touched)
    # Parse unified-diff hunk headers into per-file NEW-line ranges. Keyed on the
    # `+++ b/<path>` line (handles paths with spaces; skips deleted /dev/null).
    emit_diff "$@" | awk '
      /^\+\+\+ /{
        p=$0; sub(/^\+\+\+ b\//,"",p);
        if (p=="/dev/null") { cur=""; next }
        cur=p; if (!(cur in seen)) { seen[cur]=1; ord[++n]=cur }
        next
      }
      /^@@ /{
        if (cur=="") next
        h=$0; sub(/^@@ -[0-9,]+ \+/,"",h); sub(/ @@.*/,"",h)
        split(h, a, ","); s=a[1]+0; c=(a[2]==""?1:a[2]+0)
        if (c==0) next
        e=s+c-1
        r[cur]=r[cur] (r[cur]==""?"":",") s"-"e
      }
      END { for (i=1;i<=n;i++) print ord[i]"\t"r[ord[i]] }
    '
    ;;
esac
