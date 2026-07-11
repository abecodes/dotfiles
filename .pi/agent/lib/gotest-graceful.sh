#!/usr/bin/env bash
#
# gotest-graceful.sh — drop-in replacement for gotest-distill.sh that keeps the
# real `go test` run alive when the pi harness kills the bash tool call.
#
# WHY: the harness stops a command with `kill -KILL -<pgid>` (SIGKILL to the
# whole process group). SIGKILL is uncatchable, so Go's t.Cleanup / TestMain
# teardown / signal handlers never run, and any Docker containers the test
# started (they live in the daemon, outside the killed group) are orphaned.
#
# HOW: run the test in its OWN process group so the group-kill can't reach it,
# and have a guardian convert the kill — or our own timeout — into a *catchable*
# SIGTERM, so the test's signal handler (e.g. shared_container.go) tears the
# container down gracefully before exiting.
#
# Usage: gotest-graceful.sh -tags integration -count 1 -race ./...

set -o pipefail

# --- config -----------------------------------------------------------------
# Graceful budget: after this long we SIGTERM the run so its cleanup fires.
TIMEOUT="${GOTEST_REAP_TIMEOUT:-180}"
# Seconds to wait after SIGTERM before a last-resort SIGKILL.
GRACE="${GOTEST_REAP_GRACE:-15}"

dir="$(cd "$(dirname "$0")" && pwd)"

# Portable temp file (avoids the GNU-vs-BSD `-t` divergence). The X's become a
# RANDOM suffix, not a timestamp; lives in $TMPDIR and is reclaimed on reboot.
out="$(mktemp "${TMPDIR:-/tmp}/gotest-graceful.XXXXXX")" || exit 2

# --- (disabled) go test -timeout backstop -----------------------------------
# Left out intentionally: the wrapper's own graceful SIGTERM at $TIMEOUT handles
# hangs, and Go's -timeout is an ungraceful panic that skips cleanup. Re-enable
# if you want a goroutine dump as a last-resort diagnostic.
#
# args=("$@")
# case " ${args[*]} " in
#   *" -timeout "*|*" -test.timeout "*) : ;;          # respect caller's value
#   *) args=(-timeout "$((TIMEOUT + 30))s" "${args[@]}") ;;
# esac

# --- launch in isolated process groups --------------------------------------
# `set -m` makes each backgrounded job a leader of its OWN process group on both
# macOS and Linux, so `kill -KILL -<our pgid>` can't reach them. We turn monitor
# mode back off after launching to avoid job-control chatter; the groups persist.
set -m

"$dir/gotest-distill.sh" "$@" >"$out" 2>&1 &           # the real run, own group
runner=$!

wrapper=$$
(                                                       # guardian, own group
  deadline=$(( $(date +%s) + TIMEOUT ))
  while :; do
    kill -0 "$runner"  2>/dev/null || exit 0           # run finished → nothing to do
    kill -0 "$wrapper" 2>/dev/null || break            # harness killed wrapper → stop run
    [ "$(date +%s)" -ge "$deadline" ] && break         # graceful timeout hit → stop run
    sleep 0.2
  done
  kill -TERM -"$runner" 2>/dev/null                     # graceful: triggers cleanup handler
  end=$(( $(date +%s) + GRACE ))
  while [ "$(date +%s)" -lt "$end" ]; do
    kill -0 "$runner" 2>/dev/null || exit 0             # cleanup finished in time
    sleep 0.2
  done
  kill -KILL -"$runner" 2>/dev/null                     # last resort
) &

set +m

# --- normal path ------------------------------------------------------------
# No need to kill the guardian: on a clean finish its loop checks the runner
# FIRST and self-exits within one poll (≤0.2s). Not killing it avoids a stray
# job-control "Terminated" line on stderr.
# stderr redirect suppresses bash's redundant "Terminated" job notice when the
# guardian SIGTERMs the run (the timeout path); the real run output is in $out.
{ wait "$runner"; rc=$?; } 2>/dev/null
cat "$out"; rm -f "$out"        # forward the distilled output + exit code
exit "$rc"
