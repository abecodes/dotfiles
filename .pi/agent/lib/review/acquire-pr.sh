#!/usr/bin/env bash
#
# acquire-pr.sh — clone a PR off-tree for review. Invoked by acquire.sh; not
# called directly by the skill.
#
# Writes <REVIEWS_ROOT>/<repo>-pr<n>/ containing a clone checked out at the PR
# head, plus .review/{diff.patch,log.txt,meta.json}. diff.patch is
# merge-base(base,head)..head; log.txt is `git log --oneline base..head`.
#
# Args: <pr-url> [--base <ref>]   (--base is accepted but ignored for PRs)
# Prints the absolute target dir on stdout.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

err() { printf '[acquire-pr] error: %s\n' "$*" >&2; }

url="${1:-}"
if [[ -z "$url" ]]; then err "no PR URL given"; exit 2; fi

# Parse host/owner/repo/number from the URL.
rest="${url#https://}"
host="${rest%%/*}"; rest="${rest#*/}"
owner="${rest%%/*}"; rest="${rest#*/}"
repo="${rest%%/*}"; rest="${rest#*/}"   # rest now starts at "pull/<n>/..."
number="${rest#pull/}"; number="${number%%/*}"

if [[ -z "$host" || -z "$owner" || -z "$repo" || -z "$number" ]]; then
  err "could not parse host/owner/repo/number from URL: $url"; exit 2
fi
if ! [[ "$number" =~ ^[0-9]+$ ]]; then
  err "parsed PR number is not numeric: '$number' (from $url)"; exit 2
fi

ROOT="$(reviews_root)"
target="$ROOT/${repo}-pr${number}"

# Fetch PR metadata up front (fails fast on auth/host/not-found before we wipe).
scalars="$(gh pr view "$url" \
  --json number,headRefName,baseRefName,title,state,headRefOid,baseRefOid \
  --jq '.number, .headRefName, .baseRefName, (.title|gsub("\n";" ")), .state, .headRefOid, .baseRefOid' \
  2>/dev/null)" || { err "gh pr view failed for $url (auth/host/not-found?)"; exit 4; }

F=()
while IFS= read -r _line; do F+=("$_line"); done <<< "$scalars"
pr_number="${F[0]:-$number}"
head_branch="${F[1]:-}"
base_branch="${F[2]:-}"
title="${F[3]:-}"
state="${F[4]:-}"
head_oid="${F[5]:-}"
base_oid="${F[6]:-}"

if [[ -z "$head_branch" || -z "$base_branch" ]]; then
  err "gh returned empty head/base branch for $url"; exit 4
fi

# Body fetched separately (may be multi-line).
body="$(gh pr view "$url" --json body --jq '.body' 2>/dev/null || true)"

# Now it's safe to (re)create the target dir.
safe_wipe "$target"

# Clone the base repo (gh handles enterprise host + auth).
if ! gh repo clone "$host/$owner/$repo" "$target" -- -q 2>/dev/null; then
  err "gh repo clone $host/$owner/$repo failed"; exit 4
fi

# Fetch the PR head ref into a local branch and check it out.
if ! git -C "$target" fetch -q origin "pull/${number}/head:pr-${number}" 2>/dev/null; then
  err "could not fetch pull/${number}/head from origin"; exit 4
fi
git -C "$target" checkout -q "pr-${number}"

# Base = merge-base(base branch tip, head). Fall back to the recorded base OID
# if the base branch is gone from the remote.
base_full=""
if git -C "$target" rev-parse -q --verify "origin/${base_branch}" >/dev/null 2>&1; then
  base_full="$(git -C "$target" merge-base "origin/${base_branch}" HEAD 2>/dev/null || true)"
fi
if [[ -z "$base_full" ]]; then
  base_full="${base_oid}"
fi
if [[ -z "$base_full" ]]; then
  err "could not determine a base commit for PR #$number"; exit 4
fi

head_full="$(git -C "$target" rev-parse HEAD)"
base_short="$(git -C "$target" rev-parse --short "$base_full" 2>/dev/null || echo "${base_full:0:7}")"
head_short="$(git -C "$target" rev-parse --short HEAD)"

mkdir -p "$target/.review"
git -C "$target" diff "$base_full" HEAD > "$target/.review/diff.patch" 2>/dev/null || true
git -C "$target" log --oneline "$base_full..HEAD" > "$target/.review/log.txt" 2>/dev/null || true

# meta.json (json tags consumed by the skill).
{
  printf '{\n'
  printf '  "source": "%s",\n'        "$(json_escape "$url")"
  printf '  "repo": "%s",\n'          "$(json_escape "$repo")"
  printf '  "branch": "%s",\n'        "$(json_escape "$head_branch")"
  printf '  "base_ref": "%s",\n'      "$(json_escape "$base_branch")"
  printf '  "base_sha": "%s",\n'      "$(json_escape "$base_short")"
  printf '  "base_sha_full": "%s",\n' "$(json_escape "$base_full")"
  printf '  "head_ref": "%s",\n'      "$(json_escape "pr-${number}")"
  printf '  "head_sha": "%s",\n'      "$(json_escape "$head_short")"
  printf '  "head_sha_full": "%s",\n' "$(json_escape "$head_full")"
  printf '  "dirty": false,\n'
  printf '  "state": "%s",\n'         "$(json_escape "$state")"
  printf '  "title": "%s",\n'         "$(json_escape "$title")"
  printf '  "body": "%s"\n'           "$(json_escape "$body")"
  printf '}\n'
} > "$target/.review/meta.json"

printf '%s\n' "$target"
