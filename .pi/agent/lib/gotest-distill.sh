#!/usr/bin/env bash
#
# gotest-distill.sh — run `go test` and print only failures, or "OK".
#
# Usage (invoked by absolute path from the pi agent config; runs from cwd):
#   ~/.pi/agent/lib/gotest-distill.sh ./...
#   ~/.pi/agent/lib/gotest-distill.sh -tags integration -count 1 -race ./...
#
# Behavior:
#   - Runs `go test -json <args>` from the current directory.
#   - On all-pass: prints `OK: <pkgs> packages, <tests> tests` and exits 0.
#   - On any failure (test fail, build error, panic, setup error): prints
#     one block per failing (package, test) with the relevant output lines
#     filtered to file:line / FAIL / panic / Error / goroutine markers,
#     then exits 1.
#
# Requires: go, jq.

set -o pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "gotest-distill: jq not found in PATH" >&2
  exit 2
fi

tmp=$(mktemp -t gotest-distill.XXXXXX) || exit 2
err=$(mktemp -t gotest-distill-err.XXXXXX) || exit 2
trap 'rm -f "$tmp" "$err"' EXIT

go test -json "$@" >"$tmp" 2>"$err"
status=$?

# If we got no JSON at all, treat stderr as a setup/build error and bail.
if [ ! -s "$tmp" ]; then
  echo "=== gotest-distill: no JSON events ==="
  if [ -s "$err" ]; then cat "$err"; fi
  exit "${status:-1}"
fi

# jq program: aggregate output by (pkg,test); list failures in first-seen
# order; count passing pkgs/tests; print summary or filtered failure blocks.
jq_program='
  # `Package` is set on test events; build errors use `ImportPath`.
  def key(e): "\((e.Package // e.ImportPath) // "?")\t\(e.Test // "")";
  def pkgOf(k): k | split("\t") | .[0];
  def testOf(k): k | split("\t") | .[1];

  # Outputs: map of key -> concatenated Output strings.
  (reduce .[] as $e ({};
    if ($e.Action == "output" or $e.Action == "build-output") then
      .[key($e)] = ((.[key($e)] // "") + ($e.Output // ""))
    else . end
  )) as $outs |

  # Failure list, order-preserving, unique.
  (reduce .[] as $e ({list:[],seen:{}};
    if ($e.Action == "fail" or $e.Action == "build-fail") then
      (key($e)) as $k |
      if (.seen[$k] // false) then .
      else {list: (.list + [$k]), seen: (.seen + {($k): true})}
      end
    else . end
  ) | .list) as $fails_all |

  # Counts.
  (reduce .[] as $e ({pkgs:{}, tests:0};
    if $e.Action == "pass" then
      if (($e.Test // "") == "")
      then .pkgs[$e.Package // "?"] = true
      else .tests += 1 end
    else . end
  )) as $stats |

  # Compute filtered "kept" lines per fail. Strip our-own-header boilerplate:
  #   --- FAIL: TestName (0.01s)        (we render our own header)
  #   FAIL    pkg [build failed]        (ditto)
  #   FAIL    pkg 0.123s                (ditto)
  ($fails_all | map(
    . as $k |
    ($outs[$k] // "") as $raw |
    ($raw
      | split("\n")
      | map(select(
          test("\\.go:[0-9]+:")
          or test("^panic:")
          or test("^\\s*Error[: ]")
          or test("^\\s*goroutine\\s+[0-9]+")
        ))
    ) as $kept |
    {key: $k, kept: $kept}
  )) as $entries |

  # If any fail carries informative kept lines, drop the empty-kept ones
  # (they are redundant noise like a stray `Action:fail` follow-up after a
  # build-fail, or a parent test whose only output was the per-subtest header).
  ($entries | any(.kept | length > 0)) as $any_informative |
  ($entries | map(. as $e | select(
    ($e.kept | length) > 0 or ($any_informative | not)
  ))) as $fails |

  if ($fails | length) == 0 then
    "OK: \($stats.pkgs | length) packages, \($stats.tests) tests"
  else
    ( $fails
      | map(
          (.key) as $k |
          (.kept) as $kept |
          (pkgOf($k)) as $pkg |
          (testOf($k)) as $test |
          "--- FAIL " + $pkg + (if $test != "" then "::" + $test else "" end) +
          ( if ($kept | length) > 0
            then "\n" + ($kept | join("\n"))
            else ""
            end
          )
        )
      | join("\n\n")
    )
  end
'

# Slurp the JSONL stream into an array, then run the program.
result=$(jq -rs "$jq_program" "$tmp")
jq_status=$?

if [ $jq_status -ne 0 ]; then
  echo "=== gotest-distill: jq failed (status $jq_status) ===" >&2
  echo "Raw stderr from go test:" >&2
  cat "$err" >&2
  exit 2
fi

printf '%s\n' "$result"

# Exit 1 if any failures were detected, else propagate go test's status.
case "$result" in
  OK:*) exit "$status" ;;
  *)    exit 1 ;;
esac
