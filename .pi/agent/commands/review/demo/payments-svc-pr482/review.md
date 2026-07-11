# Review — payments-svc-pr482

- Source: https://github.example.com/acme/payments-svc/pull/482
- Base: main @ a1b2c3d / Head: pr-482 @ 9f8e7d6
- Reviewed: 2026-06-20T18:00:00Z

## TL;DR

PR #482 reworks the refund and ledger paths and adds provider config. It carries two ship-stoppers — a nil dereference that crashes the refund worker for wallet refunds, and an unversioned proto change that makes every charge decode to zero — plus a data race, a framework bypass, and a committed live secret.

## Verdict

**DO NOT MERGE** — strongest concern: Nil deref on refund path.

## Findings (paste-ready)

**[BLOCKER] [CORRECTNESS] Nil deref on refund path**
`internal/refund/service.go:134-137` · _implementation · codex_

**Problem:** `refund.Account` is only populated for card payments; for wallet refunds it stays nil and `acct.Balance` panics, taking down the whole refund worker.

**Suggested fix:** Guard the lookup and fail the single refund instead of the worker:
```go
acct := r.accounts.Find(refund.AccountID)
if acct == nil {
    return fmt.Errorf("refund %s: account %s not found", refund.ID, refund.AccountID)
}
acct.Balance += refund.AmountCents
```

---

**[CRITICAL] [CONTRACT] Unversioned breaking API change**
`api/v1/payments.proto:52` · _architecture · opus_

**Problem:** `amount` (int64) was renamed to `amount_cents` on the existing `v1` message. Deployed clients still send `amount`, which now silently decodes to 0 — every charge becomes free.

**Suggested fix:** Introduce the field as `v2` or add `amount_cents` alongside a deprecated `amount`, and migrate consumers before removing it. Never repurpose a tag on a shipped message.

---

**[HIGH] [CONCURRENCY] Race on shared ledger map**
`internal/ledger/cache.go:88` · _implementation · codex_

**Problem:** `entries` is read in `Get` and written in `Apply` from multiple goroutines with no lock — `go test -race` flags it and balances can corrupt under load.

**Suggested fix:** Protect with a `sync.RWMutex` (RLock in `Get`, Lock in `Apply`), or switch to `sync.Map` if the access pattern is write-light.

---

**[HIGH] [FRAMEWORK_BYPASS] Direct SQL bypasses repository**
`internal/refund/service.go:201-240` · _architecture · opus_

**Problem:** `service.go` opens a raw `*sql.DB` and hand-writes queries, bypassing the `ledger.Repository` abstraction every other package uses — duplicating retry/tracing/tx logic that already exists.

**Suggested fix:** Route the reads through `ledger.Repository`; if it lacks a method, add it there so retries and tracing stay in one place.

---

**[HIGH] [SECRET_EXPOSURE] Hardcoded provider API token**
`config/providers.go:17` · _security · opus_

**Problem:** A live Stripe-style secret is committed in source. Anyone with repo read access can move money; it also leaks into build logs and images.

**Suggested fix:** Load it from the secret manager at runtime and rotate the exposed token immediately:
```go
token := secrets.MustGet(ctx, "payments/provider_token")
```

---

**[MEDIUM] [ERROR_HANDLING] Webhook error swallowed**
`internal/webhook/handler.go:76` · _implementation · codex_

**Problem:** The error from `process(evt)` is assigned to `_`, so a failed webhook returns 200 and the provider never retries — events are lost silently.

**Suggested fix:** Return a 5xx on failure so the provider redelivers, and log with the event id.

---

**[MEDIUM] [PERFORMANCE] N+1 query in invoice list**
`internal/invoice/list.go:44-49` · _maintainability · gpt_

**Problem:** For each invoice the handler issues a separate `LoadLineItems` query — a 200-invoice page fires 201 queries and dominates p99 latency.

**Suggested fix:** Batch with a single `WHERE invoice_id IN (...)` and group in memory, or use a join.

---

**[LOW] [DOCUMENTATION] Exported func undocumented**
`internal/refund/service.go:60` · _maintainability · gpt_

**Problem:** `func Reconcile(...)` is exported but has no doc comment; `go doc` shows nothing for a non-obvious entry point.

**Suggested fix:** Add a `// Reconcile …` comment describing the invariant it restores.

---

## ELI5

### Nil deref on refund path
- **What's wrong:** For wallet refunds the account object is empty, and the code reads a field off the empty thing.
- **Why it matters:** It crashes the whole refund worker, so no refunds go out until someone restarts it.
- **How to fix:** Check the account exists; if not, fail just that one refund with a clear error.

### Unversioned breaking API change
- **What's wrong:** A field that clients already send was renamed without bumping the version.
- **Why it matters:** Old clients keep sending the old name, it reads as 0, and every charge becomes free.
- **How to fix:** Add the new field next to the old one (or make a v2) and migrate clients first.

### Race on shared ledger map
- **What's wrong:** Two goroutines touch the same map at once without a lock.
- **Why it matters:** Under load the balances can corrupt and the race detector fails the build.
- **How to fix:** Wrap reads/writes in a mutex (or use sync.Map).

### Direct SQL bypasses repository
- **What's wrong:** This file talks to the database directly instead of through the shared data layer.
- **Why it matters:** Retries and tracing live in the shared layer; bypassing it loses them and duplicates logic.
- **How to fix:** Call the repository; add a method there if one is missing.

### Hardcoded provider API token
- **What's wrong:** A real payment secret is written straight into the code.
- **Why it matters:** Anyone who can read the repo can spend money, and it leaks into logs and images.
- **How to fix:** Read it from the secret manager at runtime and rotate the leaked one now.

### Webhook error swallowed
- **What's wrong:** If handling a webhook fails, the code still says 'OK'.
- **Why it matters:** The provider thinks it succeeded and never retries, so events vanish.
- **How to fix:** Return an error status on failure so it gets redelivered.

### N+1 query in invoice list
- **What's wrong:** It runs one extra database query per invoice in the list.
- **Why it matters:** A big page fires hundreds of queries and gets slow.
- **How to fix:** Fetch all line items in one query and group them in memory.

### Exported func undocumented
- **What's wrong:** A public function has no explanation.
- **Why it matters:** Callers can't tell what guarantee it provides.
- **How to fix:** Add a one-line doc comment.

## Style notes

- `internal/refund/types.go:12` — Rename amt → amountCents: `amt` is ambiguous about units; the codebase standard is explicit `…Cents`. _(architecture · opus)_
- `internal/ledger/cache.go:19` — gofmt: align struct tags: Struct tags aren't gofmt-aligned. _(implementation · codex)_

## Raw agent outputs

- Architecture: `.review/raw/architecture-reviewer.md`
- Implementation: `.review/raw/implementation-reviewer.md`
- Maintainability: `.review/raw/maintainability-reviewer.md`
- Security: `.review/raw/security-reviewer.md`

## Test results

- Untagged: fail
- Integration (`-tags integration -count 1 -race`): pass
