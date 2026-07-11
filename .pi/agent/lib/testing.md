---
name: testing
purpose: language-agnostic test-quality framework for the test-gateway
---

# Testing framework

> **Test real failure modes, not theoretical ones.** Find bugs that ship,
> not bugs the standard library prevents. Document what cannot fail;
> don't write tests that exist only to lift coverage numbers.

## Decision matrix

For every error condition or behavior, classify with these four
questions, then look up the action:

1. **Can it happen in production?** (User input, network failure,
   resource exhaustion, state conflict.)
2. **Can it be simulated reliably?** (Without flaky timing or torturous
   setup.)
3. **Does testing it catch real bugs?** (Business logic vs. stdlib
   internals.)
4. **Is the recovery meaningful?** (Graceful handling vs. process
   death.)

| Can happen | Can simulate | Catches bugs | Recovery meaningful | Action               |
|------------|--------------|--------------|---------------------|----------------------|
| Yes        | Yes          | Yes          | Yes                 | Test thoroughly      |
| Yes        | Yes          | Yes          | No                  | Test error path      |
| Yes        | No           | Yes          | Yes                 | Document + integration |
| Yes        | No           | No           | No                  | Document only        |
| No         | *            | *            | *                   | Skip                 |

A `test_gate` finding for a "Skip" or "Document only" condition is
**not a real gap**. Approve with a note; don't demand a test.

## Reachable patterns (must test)

If new code matches any of these, a test-gate finding is real and the
coder must add coverage:

1. **User input validation.** Email format, required fields, range
   checks — users will send bad input.
2. **External dependencies.** HTTP calls, DB writes, file I/O. Network
   *will* fail; storage *will* return errors.
3. **Resource constraints.** Size limits, rate limits, capacity caps —
   users will exceed them.
4. **State transitions / state validation.** "Cannot operate on deleted
   user", "must be in state X to do Y" — state conflicts will occur.

For each, require: happy path (1) + realistic error paths (1–3) +
boundaries (1–2). 3–6 scenarios per behavior is typical; more needs
justification.

## Unreachable patterns (document, don't test)

If new code matches any of these, a test-gate finding is **not** a
real gap. Approve with a note, or accept a justified suppression:

1. **Post-construction validation.** Constructor validates
   dependencies; methods then re-check. The re-check is unreachable —
   test the constructor instead.
2. **"Cannot fail" operations.** Marshaling structs of basic types,
   integer-to-string conversion, string ops on validated input.
   Testing the failure path means corrupting memory.
3. **Error-handling-for-handled-errors.** A function that returns a
   default on parse failure has already absorbed the error in its
   contract. Test that bad input returns the default, not that parsing
   can fail.
4. **Resource-cleanup edge cases.** Logged-warning on close failure
   requires fs corruption; not reproducible.

For unreachable conditions, the right action is a code comment
explaining *why* it's unreachable, plus a test of the construction
path that *makes* it unreachable.

## Anti-patterns the gateway must catch

Even when the test_gate is silent, read the new tests in the diff for
these:

1. **Over-mocking.** Mocking stdlib calls or pure-data operations.
   Verify behavior on real outputs; mock only at boundaries you
   control.
2. **Testing implementation details.** Asserting on mock call counts
   instead of observable side effects. If the test breaks when the
   implementation is refactored without behavior change, it tests the
   wrong thing.
3. **Flaky timing.** Sleep-based ordering assertions. Use channels,
   wait groups, or a fake clock.
4. **Coverage padding.** Calling a function and asserting only
   "no error" on the happy path — no observable behavior verified.
   Hygiene rules in the test_gate catch tests with no assertion at
   all; the gateway catches the "one trivial assertion" version.
5. **Skipping under load.** Test-skip directives to silence a real
   bug. Skips are findings unless the suppression discipline is met.

## Suppression discipline

Suppressions (rule-disable directives, test-skip pragmas) are not
fixes. Accept them only when **all three** hold:

1. The flagged code already existed before this dispatch — was not
   introduced by the current coder iteration.
2. The rule is genuinely wrong about this specific case — match it
   against the unreachable-patterns list above.
3. The coder's `summary:` or `suppression:` line names which rule and
   why.

Anything less is a finding. Forward as `source: tests-missing` with a
`fix:` instructing the coder to either justify the suppression in the
summary or write the test.

Language-specific suppression syntax lives in `lang/<slug>.md`.

## Coverage targets (advisory)

Coverage percentages are not gates — meaningful tests are. For
context when judging "is this enough":

| Component type            | Target | Focus                                            |
|---------------------------|--------|--------------------------------------------------|
| Business logic            | 95%    | Validation, business rules, state transitions    |
| Integration / boundary    | 85%    | External-service interaction, error handling     |
| Infrastructure            | 75%    | Config, resource lifecycle                       |
| Protocol / API            | 90%    | Request/response, validation, error responses    |

Critical paths ≥ 95%. Overall 80–90% meaningful. A package at 60%
covering all reachable failure modes is fine. A package at 95% that
mocks everything and asserts call counts is not.

## What the test-gateway does **not** do

- Demand tests for unreachable conditions (skip per matrix).
- Demand integration tests when a unit test gives the same confidence.
- Re-test logic verified at a lower layer.
- Block on style preferences (test naming, file layout) unless a
  test_gate hygiene rule fires.
- Suggest broader test refactors. Future-direction belongs to
  `/review`.
