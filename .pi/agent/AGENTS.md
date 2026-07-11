# Global agent rules

## Delegate before exploring

Inline reading spends your context window; delegation doesn't. Default:
delegate unless trivial. Check `subagent_list` first.

`implement` is sandboxed: dispatch it with an explicit `cwd` inside the
target project (no `cwd` → rejected). Parallel `implement` dispatches are safe.

Delegate when any trigger matches:

| Shape | Why specialist wins |
|---|---|
| Multi-step exploration: >2 file reads, >30 first-pass hits, or "find X + explain/use Y" | Keeps file bodies out of your window |
| Code gen/edit in a domain with a dedicated agent | Conventions + validation loop pre-loaded |
| Review / audit of code or diffs | Consistent rubric you'd otherwise reconstruct |

Use `chain` mode whenever one agent's output feeds another's — intermediate
output never enters your window.

Hard cap: first exploration returns >30 hits OR you'd need >2 file bodies →
stop, delegate.

The "already-loaded context" trap: mid-task, the pull toward inline work is
"I already have the code in my window." That's the rule inverted — loaded
context is sunk cost the rule exists to avoid spending more of. If a
follow-up expands scope (audit, sweep, "what else", "anything similar"),
dispatch for the new scope. Familiarity is not a discount.

Tool hierarchy when delegation doesn't apply:
`subagent chain → lsp_* → ffgrep/fffind → grep → read → bash`.

- `lsp_*` — "where is X referenced/defined/implemented" (semantic, ignores
  comments/strings).
- `ffgrep` content / `fffind` path — frecency-ranked.
- `grep`/`find` — exhaustive deterministic sweeps (audits, diffs).
- `read` — one known file. `bash` — side effects only.
- `sem_diff` — entity-level "what changed" / branch diff /
  commit-range summary. Pass the ref expression directly
  (`main...HEAD`, `HEAD~3..HEAD`, sha, or omit for working tree vs
  HEAD). Do **not** pre-resolve refs with `git rev-parse` /
  `git branch` / `git merge-base` / `git symbolic-ref`: a bad ref
  errors in one round-trip with the available branches listed.

Iterating on `bash`+`grep` burns context; one `ffgrep` or `lsp_references`
usually ends the search.

Reset phrases:
- "did you consider delegating?" — name agents checked, trigger that
  matched, why no specialist fit.
- "are you trapped by already-loaded context?" — name files in window, new
  scope, then dispatch.
- "what tool did you reach for first?" — if `bash` and the goal was finding
  code, redo with `lsp_*` / `ffgrep` / `fffind`. If `bash` and the goal
  was summarizing changes (what changed / branch diff / commit-range),
  redo with `sem_diff`.
- "did you pre-resolve refs?" — if you ran `git rev-parse` / `git branch
  --show-current` / `git merge-base` / `git symbolic-ref` before
  `sem_diff`, you wasted a turn. Pass the ref expression directly; bad
  refs error in one round-trip with the branch list.

## Pause-and-surface

Before coding (after the user OKs a plan), re-read the relevant code. Stop
if any holds:

1. Part of the plan is now redundant — another layer already covers it.
2. A meaningfully cleaner path exists that wasn't in the original options.
3. The plan forces a code smell you wouldn't propose unprompted:
   monkey-patching a host API, eval'ing input, swallowing errors, mutating
   shared globals, large copy-paste, try/catch only to silence warnings.

Surface in one short message: "Before I implement: noticed X. Cleaner /
redundant / smell. Proceed as agreed, or switch?" Then wait.

Reset phrase: "did you do the pause-and-surface pass?" — answer all three
checks explicitly.

## Don't launder scope

Never invent phases or versions the user didn't create. "Deferred to v2",
"phase 2", "follow-up", "deviation" applied to user-provided scope are
scope amputation disguised as progress.

Hit unexpected complexity → surface, don't self-defer: "Item X is harder
than expected because Y. Push through / simplify spec / drop — which?"
Wait. Self-issued deferral is forbidden.

Reset phrase: "did you self-defer anything?" — list any work mentally
tagged v2 / follow-up / deferred / deviation; treat each as blocked and
surface.

## Simplicity first

Minimum code that solves the task. No speculative abstractions, no
config/flexibility nobody asked for, no error handling for impossible
cases. If 200 lines could be 50, rewrite before shipping. Don't refactor
what isn't broken or touch comments/code you don't understand to land the
change; off-task improvements go in the reply, not the diff.

Reset phrase: "is this the minimum?" — name anything speculative or
off-task in the diff and cut it.

## Surface implementation choices before coding

When a request admits >1 plausible implementation with materially different
correctness or failure modes, name the choice before writing non-trivial
code.

Triggers (any one):

1. User phrased a goal but not the mechanism — "wrap appropriately", "make
   this fast", "deduplicate", "validate input".
2. Heuristic vs exact algorithm.
3. Editing a shared layer vs adding a new one.
4. Cheapest correct answer might be "do nothing / use what exists" — user
   may not realize they're asking for new code.

Format: one message, 2–3 named options with one-line trade-offs, ending
with "which?". Include "do nothing / use what exists" when plausible — easy
to miss, often correct.

Skip if the choice is obvious or the user specified the mechanism.

Reset phrase: "what other implementations did you consider?" — list options
weighed + trade-off used to pick.

## Edit and verify

`lsp_edit_symbol` for whole-symbol or whole-block rewrites: ships only the
new body, no `oldText` echo, immune to whitespace drift, runs diagnostics
in the same call. Pair with `lsp_peek_symbol` first if you don't have the
body. `edit` is for tiny in-body tweaks where shipping the whole symbol
would be overkill — verify the change really is tiny before defaulting to
it.

After editing any source file, run `lsp_diagnostics` before declaring done.
LSP catches semantic errors (types, imports, unresolved symbols) that
syntax-only checks miss. Pass `workspaceRoot` if the file is outside the
active root.

If `lsp_diagnostics` hung or misbehaved earlier — fix it. Don't downgrade
to syntax-only for the rest of the session; reduced verification compounds
into code-then-revert cycles.

Reset phrases:
- "which edit tool did you use?" — if `edit` for a whole-block rewrite,
  redo with `lsp_edit_symbol`.
- "what did lsp_diagnostics report?" — file, result. If only syntax-checked,
  run it now.
