# Review — wallet-svc-feature-rc1

- Source: /Users/dev/repos/wallet-svc
- Base: origin/main @ 44ad910 / Head: HEAD @ c0ffee1 + uncommitted
- Reviewed: 2026-06-20T18:00:00Z

## TL;DR

wallet-svc adds the refund-sync worker and an HTTP handler. The headline risk is a deadlock on an unbuffered channel in the error path; there's also a layering leak from the handler into storage.

## Verdict

**NEEDS-CHANGES** — strongest concern: Deadlock on unbuffered channel.

## Findings (paste-ready)

**[HIGH] [CONCURRENCY] Deadlock on unbuffered channel**
`internal/sync/refund.go:31` · _implementation · codex_

**Problem:** `done` is unbuffered and the only sender runs after the receiver returns on the error path, so a failed sync blocks the worker forever.

**Suggested fix:** Buffer the channel (`make(chan struct{}, 1)`) or `select` with a context cancel.

---

**[MEDIUM] [LAYERING] Handler reaches into storage**
`internal/sync/handler.go:18` · _architecture · opus_

**Problem:** The HTTP handler imports the `storage` package directly instead of going through the service layer, coupling transport to persistence.

**Suggested fix:** Inject a service interface and call that; keep `storage` behind it.

---

**[LOW] [DOCUMENTATION] Package lacks doc.go**
`internal/sync/sync.go:1` · _maintainability · gpt_

**Problem:** `internal/sync` has no package comment; `go doc` shows nothing for a non-trivial package.

**Suggested fix:** Add a `doc.go` with a package overview.

---

## ELI5

### Deadlock on unbuffered channel
- **What's wrong:** A worker waits to hand off a signal that nobody is listening for on the error path.
- **Why it matters:** A single failed sync hangs the worker forever.
- **How to fix:** Give the channel a small buffer or use a cancellable select.

### Handler reaches into storage
- **What's wrong:** The web handler talks straight to the database package.
- **Why it matters:** Transport and persistence get tangled, making both harder to change/test.
- **How to fix:** Call a service interface that owns storage.

### Package lacks doc.go
- **What's wrong:** The package has no overview comment.
- **Why it matters:** Newcomers can't tell what it's for at a glance.
- **How to fix:** Add a short doc.go.

## Style notes

- `internal/sync/handler.go:7` — Unused import: `errors` is imported but unused. _(implementation · codex)_

## Raw agent outputs

- Architecture: `.review/raw/architecture-reviewer.md`
- Implementation: `.review/raw/implementation-reviewer.md`
- Maintainability: `.review/raw/maintainability-reviewer.md`
- Security: skipped — --security not set

## Test results

- Untagged: pass
- Integration (`-tags integration -count 1 -race`): skipped
