#!/usr/bin/env bash
#
# acquire.sh — review-skill acquisition dispatcher.
#
# The ONLY entry point the review skill is meant to call. It classifies the
# input token and delegates to a mode-specific helper:
#
#   PR URL              -> acquire-pr.sh
#   local dir (.git)    -> acquire-local.sh   (git-worktree mode)
#   local dir (no .git) -> acquire-local.sh   (full-tree audit mode)
#
# On success it prints ONE line to stdout: the absolute target dir under
# $REVIEWS_ROOT, containing the cloned/copied tree plus a populated
# .review/ ({diff.patch,log.txt,meta.json}). All diagnostics go to stderr,
# prefixed "[acquire] error: ...". Exit non-zero on any failure; partial
# target dirs are left for inspection but the caller drops the target.
#
# Env:
#   REVIEWS_ROOT  Root under which all targets are written (and the only
#                 tree any helper is permitted to rm -rf / write into).
#                 Default: $HOME/Repos/reviews
#
# Usage:
#   REVIEWS_ROOT=/path acquire.sh <token> [--base <ref>]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

err() { printf '[acquire] error: %s\n' "$*" >&2; }

if [[ $# -lt 1 ]]; then
  err "no target token given (usage: acquire.sh <token> [--base <ref>])"
  exit 2
fi

token="$1"; shift

# Remaining args (only --base <ref> is meaningful; forwarded verbatim to the
# local helper, ignored by the PR helper).
extra_args=("$@")

# PR URL: https://<host>/<owner>/<repo>/pull/<n>[/...]
pr_re='^https://[^/]+/[^/]+/[^/]+/pull/[0-9]+(/.*)?$'

if [[ "$token" =~ $pr_re ]]; then
  exec "$SCRIPT_DIR/acquire-pr.sh" "$token" ${extra_args[@]+"${extra_args[@]}"}
fi

# Otherwise it must resolve to a directory (git or non-git); the local helper
# distinguishes the two modes itself.
if [[ -d "$token" ]]; then
  exec "$SCRIPT_DIR/acquire-local.sh" "$token" ${extra_args[@]+"${extra_args[@]}"}
fi

err "token is neither a PR URL nor an existing directory: $token"
exit 2
