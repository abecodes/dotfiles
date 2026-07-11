# Group Review — release-2026-06-20

- Reviewed: 2026-06-20T18:00:00Z
- Targets: 2

## Per-target verdicts

| Target | Verdict | Report |
| --- | --- | --- |
| payments-svc-pr482 | DO NOT MERGE | payments-svc-pr482/review.md |
| wallet-svc-feature-rc1 | NEEDS-CHANGES | wallet-svc-feature-rc1/review.md |

## Cross-cut verdict

**BLOCKED** — strongest concern: amount vs amount_cents skew.

## Cross-cut findings (paste-ready)

**[CRITICAL] [CONTRACT_DRIFT] amount vs amount_cents skew** _(involves: payments-svc-pr482, wallet-svc-feature-rc1)_
`payments-svc-pr482:api/v1/payments.proto:52`, `wallet-svc-feature-rc1:internal/sync/refund.go:31`

**Problem:** payments-svc renames the field; wallet-svc still calls GetAmount(), which now returns 0 after the rename lands.

**Suggested fix:** Merge payments-svc first behind a flag, ship wallet-svc reading amount_cents, then flip the flag. Do not merge wallet-svc before the proto migration is consumed.

---

**[MEDIUM] [SEAM_TEST_GAP] No contract test across the seam** _(involves: payments-svc-pr482, wallet-svc-feature-rc1)_
`wallet-svc-feature-rc1:internal/sync/refund_test.go:1`

**Problem:** Neither side has a test that exercises the encoded payments message against the wallet decoder, so the skew above slipped through.

**Suggested fix:** Add a shared golden-message fixture and assert both encode/decode agree.

---

## Recommended commit/merge order

1. payments-svc-pr482
2. wallet-svc-feature-rc1

## Group recommendation

**DO NOT MERGE** — BLOCKED if any per-target or cross-cut verdict is BLOCKED; NEEDS-CHANGES if any is NEEDS-CHANGES; otherwise APPROVED.

## Raw

- Cross-cut: `.review/raw/cross-cut-reviewer.md`
