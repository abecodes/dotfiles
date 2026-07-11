---
name: go
formatter:
  cmd: abefmt -w
smoke:
  cmd: go build ./...
gate:
  - name: lint
    cmd: custom-gcl run
  - name: test-untagged
    cmd: ~/.pi/agent/lib/gotest-distill.sh ./...
  - name: test-integration
    cmd: ~/.pi/agent/lib/gotest-graceful.sh -tags integration -count 1 -race ./...
    optional: true
test_gate:
  - name: abetest
    cmd: abetest ./...
---

# Go conventions

## Tool surface

Bash is restricted to:

- `go build`, `go test`, `go vet`, `go run`
- `gofumpt`, `golines`, `golangci-lint`, `custom-gcl`
- `abefmt` (canonical formatter — see "Formatting discipline" below)
- `gotest-distill.sh`
- read-only `git` (`diff`, `status`, `log`, `rev-parse`, `ls-files`)

## Formatting discipline

`abefmt` is a gofumpt superset: gofumpt is its first pass, then it adds
line-budget reflow, trailing-comment lifting, splitter, structured-
logger key/value grouping, and prose-comment wrapping. Idempotent.

> **After every edit / write / lsp_edit_symbol, run `abefmt -w <file>`
> on the file you just touched.** Before moving on to the next edit,
> not at the end.

Don't invoke `gofumpt` or `golines` directly — `abefmt` is the
canonical pipeline.

## Verification

1. **Baseline — iter 1 only.** Confirm `go build ./...` is clean before
   any edit. If red on entry, stop and escalate.
2. **After each cohesive change.** `abefmt -w <touched-files>`, then
   `go build ./...` and `go test ./...` on the touched packages.
3. **Before returning.** `abefmt -l <changed-files>` empty,
   `gotest-distill.sh ./...` reports `OK`, `custom-gcl run` empty.

## Test execution across modules (`go.work`)

Applies to anyone running the `gate:` `test-*` commands (gateway, reviewer).
`go test ./...` only enters the **current** module — it does NOT cross module
boundaries even inside a `go.work`. Before running the distiller, check the
target for a `go.work` file and read its `use (...)` entries. If more than one
module is listed (e.g. `.` plus `./framework`), run the test command from
**each** module dir, not just the root, and treat the runs as a single suite
(worst result wins per slot). The moderation pipeline's
`moderation-skelly-service` is the canonical case: the root module covers
`cmd/` + `shared/`, and `./framework` covers everything under `framework/`.
Reporting only the root-module run gives a false green when the change is in
framework.

## Style and idioms

`custom-gcl` and the abelizer analyzers enforce most Go conventions
mechanically: error wrapping with `%w`, no `_ = err`, receiver
consistency, encapsulation gates, threshold rules, naming. **The linter
is canonical.** Don't relitigate its decisions by hand. If you disagree
with a rule on a specific case, surface it via your `noticed:` line —
don't suppress.

## Anti-patterns

- `t.Skip("flaky")` to dodge a real failure. If flaky, fix or delete.
- `//nolint:<rule>` without justification. Allowed only when (a) the
  flagged code pre-existed this dispatch, (b) the rule is wrong about
  this case, (c) your summary names which rule and why.
- `//nolint:missing-test` to skip a test. Allowed only when the
  function matches an unreachable pattern (post-construction
  validation, "cannot-fail" operation) and your summary names the
  pattern.
- `_ = err` to silence a check. Handle or don't capture.
- New package or new top-level abstraction without naming the existing
  alternative you considered.

## Failure shapes (reading findings)

- **Build / smoke red:** structural / type / import error. Compiler
  output is the truth.
- **Lint red:** `custom-gcl` flagged something. Read `path:line:rule`,
  fix, don't suppress.
- **Tests red:** `gotest-distill.sh` printed `--- FAIL <pkg>::<test>`
  blocks, already filtered to file:line / Error / panic / goroutine.
- **Review red:** diff-level concern the linter doesn't catch. Read
  the `fix:` line; that's the action.
- **tests-missing:** new code without adequate coverage. Each finding
  has a concrete `fix:` hint. Write the test, or — if the function
  genuinely matches an unreachable pattern — suppress with
  `// nolint:<rule>` and name the pattern in your summary.

## Test gate — abetest reference (test-gateway only)

`abetest` prints diagnostics in this shape (per-method mode, default):

```
<file>:<line>:<col>: <pkg.anchor>: <RULE-ID>(<details>) [id:<8hex>] [fix:<hint>]
```

Group findings per `<pkg.anchor>` (one entry per function), not per
diagnostic line — the per-method mode already groups for you.

Rule mapping (what the test-gateway applies when judging):

| Rule                    | Real gap when…                                                                 | Justified suppression when…                                  |
|-------------------------|--------------------------------------------------------------------------------|--------------------------------------------------------------|
| `MISSING-TEST`          | exported func/method has reachable behavior (input validation, side effect)    | thin wrapper over stdlib / "cannot fail" / pure delegation   |
| `SCENARIO-CONTEXT`      | function actually responds to cancellation / deadline (long-running, I/O)      | function ignores ctx (passes through to a no-op)             |
| `SCENARIO-ERROR`        | error param drives a real branch (logged, returned, retried differently)       | error is opaque pass-through (function never inspects it)    |
| `SCENARIO-RETURN-ERROR` | callers must distinguish nil vs. non-nil (retry, fallback, user-facing message)| pure happy-path getter that "cannot fail" in practice        |
| `TEST-NO-ASSERTIONS`    | always — a test with no assertion is dead weight                               | never                                                        |
| `TABLE-NAMED-CASES`     | always — names are part of the test's debuggability                            | never                                                        |
| `TEST-NO-CLEANUP`       | always — leaks compound across the suite                                       | never (use `t.TempDir`/`t.Context` if applicable)            |
| `TEST-PARALLEL`         | independent tests in a long-running package                                    | tests share fixtures or mutate global state                  |

Hygiene rules (bottom four) forward as-is. Coverage rules (top four)
go through the framework's reachable/unreachable pattern check.

Suppression syntax: `// nolint:<rule>` on or above the function
declaration (lower-case rule name, e.g. `// nolint:missing-test`,
`// nolint:scenario-context`).
