---
name: review
description: Code review of one or more change sets — PRs, local git branches/worktrees, or non-git folders — all acquired into ~/Repos/reviews/ so the original is never touched. Optional cross-cut analysis when multiple are given. Each target gets architecture, implementation, and maintainability review (plus optional security) by isolated subagents; the skill synthesizes a digest.
---

# Code Review

Reviews one or more change sets. Each target is one of:
- **PR URL** (`https://.../pull/<n>`) → cloned off-tree under `~/Repos/reviews/<repo>-pr<n>/`.
- **Local git path** (`.`, `/abs/path`, `relative/path`, where `<path>/.git` exists) → rsync'd to `~/Repos/reviews/<basename>-<branch>-<sha>/`, reviewed against the detected base ref. Picks up uncommitted work too.
- **Non-git path** (any directory without `.git`) → rsync'd to `~/Repos/reviews/<basename>-fulltree-<ts>/`, given a synthetic baseline so every file appears as added; reviewed as a full-tree audit.

Mixed sets are allowed. **Originals are never modified** — all work happens in the copy/clone under `~/Repos/reviews/`.

Acquisition is delegated to a single dispatcher script: `~/.pi/agent/lib/review/acquire.sh`. It classifies the input, provisions the target (clone for PRs, rsync for local-git and full-tree), writes `<target>/.review/diff.patch`, `<target>/.review/log.txt`, and `<target>/.review/meta.json`, then prints the absolute target dir on stdout. How it provisions each mode internally is its own concern — the skill only ever invokes `acquire.sh`.

For each target the skill spawns the `architecture-reviewer`, `implementation-reviewer`, and `maintainability-reviewer` subagents in parallel (plus `security-reviewer` when `--security` is set). They each emit a prose body **plus** a JSON findings block. The skill parses the JSON, never the prose, and synthesizes a per-target `review.md`. With ≥2 targets the skill then chains the `cross-cut-reviewer` and writes a group `summary.md`.

**Inputs:** `$ARGUMENTS`

## Step 1: Parse arguments

From `$ARGUMENTS`, separate into flags and positional tokens.

Flags:
- `--security` — adds `security-reviewer` per target.
- `--no-maintainability` — drop the default-on `maintainability-reviewer` (refactor/design lens) for this run.
- `--no-eli5` — suppress the plain-English explanation block in `review.md` and the ELI5 bullet on slide bottoms.
- `--no-deck` — skip the HTML slide deck step entirely (Step 10).
- `--base <ref>` — override base-ref detection for **local git targets only** (forwarded to `acquire.sh`; ignored for PR or non-git inputs).
- `--group <name>` — display label for multi-target `summary.md`.

Positional tokens — light classification (the dispatcher does the real work; this is just for routing logic in later steps):
- Matches `^https://[^/]+/[^/]+/[^/]+/pull/\d+(/.*)?$` → **PR target**.
- Resolves to a directory with a `.git/` entry → **local-git target**.
- Resolves to a directory without `.git/` → **fulltree target**.
- Anything else (non-existent path, not a URL) → fail this token with a clear error and continue with the others.
- Zero positional tokens → treat `$PWD` as a single local target (will become local-git or fulltree depending on what's there).

State the parse result in one sentence, listing each target's mode and the active flags.


## Step 2: Pre-flight

- Verify `~/.pi/agent/lib/review/acquire.sh` is present and executable. If it is missing, abort with: "acquisition dispatcher missing at ~/.pi/agent/lib/review/acquire.sh — re-run setup."
- The acquire dispatcher handles its own preflight (gh auth, rsync availability, source-path checks) and emit one-line stderr errors on failure. The skill propagates those messages verbatim and drops the failing target.
- No `rm -rf` in this step. Each acquire script wipes and re-creates its own target dir on every run.

## Step 3: Capture intent (local targets only)

If any target is a local-git or fulltree target, ask the user in plain conversational prose (do **not** use `ask_user_question` — this needs a free-form answer):

> "Briefly describe what these changes are about (1–3 sentences). For full-tree audits, describe what the codebase is and what you'd like the reviewers to focus on. This will be fed to the reviewers as intent context."

Trim to 4000 chars; persist to `<group-output-dir>/intent.txt` (see Step 5 for `<group-output-dir>`). Skip in PR-only mode — PR title and body carry intent.

## Step 4: Per-target prep

### 4a. Acquire the target via the dispatcher

For each token, run the dispatcher and capture stdout (one line, absolute path). Forward `--base <ref>` only — all other flags are skill-internal.

```
<target> = $(REVIEWS_ROOT=<reviews-root> ~/.pi/agent/lib/review/acquire.sh <token> [--base <ref>])
```

`<reviews-root>` is `~/Repos/reviews` for single-target runs, or the group dir from Step 5 for multi-target runs. Setting `REVIEWS_ROOT` is the only mechanism the skill uses to nest targets under a group dir — the scripts honor that env var and refuse to write outside it.

If the dispatcher exits non-zero, capture its stderr (one line, prefixed `[acquire-…] error: …`), log it to the user, drop this target, continue with the others.

After success, read `<target>/.review/meta.json` once and keep it in memory for that target. Fields used downstream:
```
source         original input (URL or absolute source path)
repo           short display name
branch         branch name, "(detached)", or null when there is no branch
base_ref       human-readable base ref ("main", "origin/master", "review-base", …)
base_sha       short sha
head_ref       human-readable head ref ("pr-<n>", "HEAD", "review-head", …)
head_sha       short sha
dirty          true if the source had uncommitted changes
prompt_note    optional one-line note appended verbatim to each agent prompt
```

If `<target>/.review/diff.patch` is empty (zero bytes), skip the target with a one-line warning ("no changes between base and head — nothing to review") and continue.

### 4b. Detect Go content

Run `grep -lE '\.go$|^go\.mod$|^go\.sum$' <target>/.review/diff.patch`; set `<go-detected>` per target. Used only as a soft skip hint for `implementation-reviewer` test runs — the agent set itself is unchanged. Untracked files in the source repo do not need a separate check anymore: in git-worktree mode they're already part of the working-tree diff the script captured, and in full-tree mode every file is in the diff by construction.

## Step 5: Pick a group output dir (multi-target only)

If there are ≥2 targets, pick a group dir under `~/Repos/reviews/`:

```
<group-output-dir> = ~/Repos/reviews/<group-name>/
```

`<group-name>` = `--group <name>` if provided, else `review-<YYYY-MM-DD>-<6char>` where the 6-char suffix is the first 6 hex chars of `sha1` of the sorted target identifiers (URLs and abs-paths) joined by newlines. Use `shasum -a 1` on macOS.

For every Step 4a invocation in multi-target mode, set `REVIEWS_ROOT=<group-output-dir>` so each target lands at `<group-output-dir>/<target-name>/`. No symlink special case; mixed PR + local sets all nest cleanly because every acquire mode goes through the same env-var hook.

Intent (Step 3) is persisted to `<group-output-dir>/intent.txt`.

## Step 6: Run the per-target reviewers in parallel

For each target, issue a single `subagent({tasks: [...]})` call with all reviewer agents for that target in one batch. Across targets, issue these batches in parallel as well — one outer message containing N batches.

The default agent set per target is `architecture-reviewer`, `implementation-reviewer`, and `maintainability-reviewer`. Add `security-reviewer` when `--security` is set; drop `maintainability-reviewer` when `--no-maintainability` is set.

Each task in a batch:

```
{
  agent: "architecture-reviewer" | "implementation-reviewer" | "maintainability-reviewer" | "security-reviewer",
  cwd: "<target-abs-path>",
  task: "<see prompt skeleton below>"
}
```

Prompt skeleton — fill in placeholders from `meta.json`, send verbatim:

```
Review this change set. Your cwd is <target>. The diff is at .review/diff.patch and the commit log at .review/log.txt.

Repo: <repo>
Source: <source>
Base: <base_ref> @ <base_sha>
Head: <head_ref> @ <head_sha><" + uncommitted" if dirty>
Intent: <pr-body-truncated-to-2000-chars | user-intent-from-Step-3 | "(none provided)">

<prompt_note from meta.json, omit the line entirely if absent>

Line anchors: every finding carries an `anchor` — a short fragment copied verbatim from the flagged source line (your agent contract specifies the field). Report `line` as your best estimate; the orchestrator resolves the authoritative line by searching for `anchor` in the real file. So the anchor must be exact (character-for-character, no paraphrase); the line need not be. Do not copy diff.patch's own line numbering into either field.

Follow your agent contract. Reply with the prose review, then the fenced JSON block. Do not write to disk.
```

`implementation-reviewer` skips test runs only if `<go-detected>` is false **and** the diff contains no `*_test.go` paths — phrase this as one extra line: "No Go content detected; skip the test runs and report `skipped` for both."

## Step 7: Persist agent output per target

For each agent reply:
1. Save the full prose body (everything before the final ` ```json ` fence) to `<target>/.review/raw/<agent>.md`.
2. Parse the fenced JSON block. If parsing fails or the schema is wrong, log a warning, treat the agent's verdict as `NEEDS-CHANGES`, and continue. Save the raw block to `<target>/.review/findings/<agent>.json` either way.
3. **Resolve true line numbers (deterministic).** For each non-style finding, resolve its real source line from the verbatim `anchor` — do not trust the agent's `line` estimate:
   ```
   ~/.pi/agent/lib/review/anchor-line.sh <target>/<path> '<anchor>' <line>
   ```
   Set the finding's `line` to the script's stdout. The reported `line` is passed as the third arg only to disambiguate when the anchor occurs more than once (the script picks the match nearest the hint). Handle the exits:
   - exit 0 → use the printed line.
   - exit 3 (anchor not found verbatim) → keep the agent's reported `line` and surface a one-line warning to the user.
   - finding has no `anchor` (older agent output) → fall back to the patch-offset resolver `~/.pi/agent/lib/review/resolve-lines.sh <target>/.review/diff.patch <line>`.
   `endLine` stays as the agent's estimate (anchors resolve the start line only). Also rewrite any inline `path:line` mentions inside `problem`/`fix` to the resolved line. Resolve **once here**, before writing the findings JSON, `review.md`, and the deck — every downstream artifact then inherits the corrected line.

## Step 8: Synthesize per-target `review.md`

Compute the per-target verdict from the agents' verdicts: `BLOCKED > NEEDS-CHANGES > APPROVED` — pick the strongest.

Write `<target>/review.md`:

```markdown
# Review — <target-display-name>
- Source: <source-from-meta>
- Base: <base_ref> @ <base_sha> / Head: <head_ref> @ <head_sha>[ + uncommitted if dirty]
- Reviewed: <date -u +%FT%TZ>

## TL;DR
<2–4 sentences synthesizing what the change does and the headline concerns. Derived from the agents' Summary sections.>

## Verdict
**<DO NOT MERGE | NEEDS-CHANGES | APPROVED>** — <one-line rationale citing the strongest finding's title>.

## Findings (paste-ready)

For every finding with `style: false`, in severity order (BLOCKER → CRITICAL → HIGH → MEDIUM → LOW):

**[<SEVERITY>] [<CATEGORY>] <title>**
`<path>:<line>` (or `<path>:<line>-<endLine>`)

**Problem:** <problem>

**Suggested fix:** <fix; preserve fenced code blocks if present>

---

## ELI5

(Skip this entire section if `--no-eli5` was set.)

For every non-style finding above, in the same order:

### <title>
- **What's wrong:** <plain-English restatement, 1–2 sentences, junior-friendly>
- **Why it matters:** <one concrete failure mode>
- **How to fix:** <plain-English fix sketch, optionally a minimal example>

The skill produces these explanations itself from the JSON `problem` and `fix` fields — do not delegate this back to a subagent.

## Style notes

For every finding with `style: true`:

- `<path>:<line>` — <title>: <one-line problem>

## Raw agent outputs
- Architecture: `.review/raw/architecture-reviewer.md`
- Implementation: `.review/raw/implementation-reviewer.md`
- Maintainability: `.review/raw/maintainability-reviewer.md` (or "skipped — --no-maintainability set")
- Security: `.review/raw/security-reviewer.md` (or "skipped — --security not set")

## Test results (Go targets only)
- Untagged: <pass | fail | error | skipped>
- Integration (`-tags integration -count 1 -race`): <pass | fail | error | skipped>
```

## Step 9: Cross-cut review (multi-target only)

If there are ≥2 successful targets, chain into the cross-cut reviewer:

```
subagent({ chain: [
  {
    agent: "cross-cut-reviewer",
    cwd: "<group-output-dir>",
    task: "Cross-cut review of <N> targets. For each: <name> at <abs-path>, base <base-ref>, per-target report at <abs-path>/review.md, findings at <abs-path>/.review/findings/, diff at <abs-path>/.review/diff.patch. User intent: <intent>. Follow your agent contract; reply with prose then the fenced JSON block."
  }
]})
```

Save the prose body to `<group>/.review/raw/cross-cut-reviewer.md` and parse the JSON to `<group>/.review/findings/cross-cut.json`. Cross-cut findings carry their location in `evidence[].{path,line,snippet}`; resolve each evidence `line` deterministically the same way as Step 7 — `~/.pi/agent/lib/review/anchor-line.sh <target>/<path> '<snippet>' <line>` — before rendering `summary.md` / the group deck.

Write `<group>/summary.md`:

```markdown
# Group Review — <group-name>
- Reviewed: <timestamp>
- Targets: <count>

## Per-target verdicts
| Target | Verdict | Report |
|---|---|---|
| <name> | <verdict> | <relative-path-to-review.md> |
| ...

## Cross-cut verdict
**<APPROVED | NEEDS-CHANGES | BLOCKED>** — <one-line rationale>.

## Cross-cut findings (paste-ready)
<same paste-ready block format as per-target review.md, derived from the cross-cut JSON. Skip ELI5 here unless --no-eli5 is unset; cross-cut findings benefit from plain-English too.>

## Recommended commit/merge order
<from cross-cut-reviewer's `merge_order`>

## Group recommendation
**<DO NOT MERGE | NEEDS-CHANGES | APPROVED>** — `BLOCKED` if any per-target or cross-cut verdict is `BLOCKED`; `NEEDS-CHANGES` if any is `NEEDS-CHANGES`; otherwise `APPROVED`.

## Raw
- Cross-cut: `.review/raw/cross-cut-reviewer.md`
```

## Step 10: Render HTML slide deck(s)

Skip this step if `--no-deck` was set.

Produce a self-contained HTML slide deck per target, and (multi-target only) one for the group, reading findings straight from the JSON files written in Step 7/9. Do **not** re-prompt agents.

Paths:
- Per-target: `<target>/review.html` (sibling of `review.md`).
- Group: `<group-output-dir>/summary.html` (sibling of `summary.md`).

Hard requirements (mirror `~/.pi/agent/prompts/retro.md`'s deck contract):
- Single self-contained HTML file. No external CDN, no network. All CSS + JS inline. Must work offline by double-clicking.
- Dark theme default; `t` toggles light. Left/Right + Space advance; `?` toggles keyboard help; slide counter + progress bar in a corner.
- `@media print` stacks all slides one per page so the user can Save as PDF.
- Truncate long code blocks with `… (truncated, see review.md)` rather than letting them overflow the slide.
- Severity palette, used consistently on badges/cards/headers: BLOCKER red, CRITICAL deep-orange, HIGH amber, MEDIUM yellow, LOW slate.
- Monospace for code, quotes, and `path:line` references. Generous whitespace.

### Per-target deck slide order (skip slides with no content)

1. **Title** — source (from `meta.json`'s `source`), base→head with short SHAs, review date, files-changed + additions/deletions (from `diff.patch`), finding count badges by severity. The base→head pair is self-describing: `pr-<n>`, `HEAD`, and `review-head` each say what kind of review this is.
2. **Verdict** — the verdict word (`DO NOT MERGE` / `NEEDS-CHANGES` / `APPROVED`) at large size, one-line rationale, severity histogram.
3. **TL;DR** — the same 2–4 sentences as `review.md`'s TL;DR.
4. **Findings overview** — card grid, one card per non-style finding in severity order. Each card: severity badge, category, title, `path:line`, source agent (architecture / implementation / maintainability / security). Cards link/key-jump to the matching per-finding slide.
5. **Per finding (one slide per non-style finding, severity order)** — fixed layout:

   ```
   ┌──────────────────────────────────────────────────────────┐
   │ HEADER: [SEVERITY] [CATEGORY] Title · path:line · agent  │
   ├──────────────────────────────┬───────────────────────────┤
   │ ROW 1 LEFT (50%)             │ ROW 1 RIGHT (50%)         │
   │ "Issue"                      │ "Suggested fix"           │
   │ <problem prose + code>       │ <fix prose + code,        │
   │                              │  fenced blocks preserved> │
   ├──────────────────────────────┴───────────────────────────┤
   │ ROW 2 (100%) — "Why it matters / details"                │
   │ • Concrete failure mode                                  │
   │ • ELI5 restatement (omit if --no-eli5 was set)           │
   │ • Any extra notes / references the agent supplied        │
   └──────────────────────────────────────────────────────────┘
   ```

   Both row-1 panes scroll independently when content overflows; the bottom row scrolls as one. No syntax highlighting unless trivially achievable inline — a subtle border + monospace is enough.

   **Code blocks are never invented.** The agents' findings carry `problem`/`fix` prose plus an `anchor`, not a current-code snippet. So the ROW-1-LEFT ("Issue") code block, when present, MUST be a **verbatim slice of the real source** — read the file at the finding's resolved `line` (use `endLine`, or a few lines around the `anchor`) and paste those exact bytes. Mark any omission with a literal `…` and never paraphrase, rename, or reconstruct code from the prose. If a single clean slice isn't representative (e.g. a duplication spread across files, or a whole-function/file finding), show the real signature/first lines + an `…` rather than a made-up sketch, or omit the code block entirely. The ROW-1-RIGHT ("Suggested fix") block is the one place proposed/new code is allowed — take it only from the agent's `fix` field, and it is clearly labelled a suggestion. A reader must never see fabricated code presented as the current state of the file.
6. **Style notes** — single slide, scrollable bulleted list of every `style: true` finding as `path:line — title: one-liner`. One slide per style finding would be noise; collapse here.
7. **Test results** — small table: untagged (`pass | fail | error | skipped`) and integration `-tags integration -count 1 -race` (same set). On failure, show the first error excerpt under the table.
8. **Next actions** — checklist of BLOCKER + CRITICAL findings the author should address before re-review.

### Group deck slide order (multi-target only)

1. **Title** — group name, target count, date.
2. **Verdict** — group recommendation + one-line rationale.
3. **Per-target verdicts** — table: target name, verdict, finding count, relative path to per-target `review.html`.
4. **Cross-cut TL;DR** — from `cross-cut-reviewer`'s summary.
5. **Cross-cut findings** — one slide per non-style cross-cut finding using the same fixed layout as the per-target deck.
6. **Recommended merge order** — ordered list from `cross-cut-reviewer`'s `merge_order`, with the one-line rationale per item.
7. **Group next actions** — top blockers across the whole group.

### Open the deck

After writing, open the deck in the user's default browser. **Single-target run:** open `review.html`. **Multi-target run:** open only `summary.html` — per-target decks are reachable via the table on slide 3, and auto-opening N tabs is noisy.

Use the same portable one-liner as `retro.md`:

```bash
( open "$DECK" 2>/dev/null || xdg-open "$DECK" 2>/dev/null || start "" "$DECK" 2>/dev/null || powershell.exe -c "Start-Process '$DECK'" 2>/dev/null ) &
```

Don't fail the review if the open fails — the path is printed in Step 11 regardless.

## Step 11: Final reply

In one message, print:
- Per target: target name, `review.md` absolute path, `review.html` absolute path (omit if `--no-deck`), one-line verdict.
- Multi-target: `summary.md` absolute path, `summary.html` absolute path (omit if `--no-deck`), group verdict, recommended merge order.

## Notes for the orchestrator (you, when running this skill)

- **Parallelism is the point.** Per-target agent batches go in one `subagent({tasks: [...]})` call; multiple targets fan out across one outer message. Serialize only the cross-cut step.
- **Acquisition is delegated.** All mode-specific provisioning lives behind `~/.pi/agent/lib/review/acquire.sh` (which may delegate to internal helpers in the same dir — not the skill's concern). The skill never runs `git`, `gh`, `rsync`, or `git init` directly — it just calls the dispatcher and reads `meta.json`. Bug fixes for acquisition go in the lib scripts, not the skill prose.
- **The agents already carry the safety contract** in their tool list (architecture, maintainability, and security have no bash/edit/write) and prose. Do not append "do-not-modify" sentences to their prompts; they already know.
- **Do not pre-paste diff/log into agent prompts.** Agents have `read` and the diff/log are at known paths in their cwd.
- **Per-target failures isolate.** A failed acquire (gh error, missing rsync, no merge-base, empty source folder, agent timeout) leaves the others alone; surface the script's stderr line in the final reply.
- **Originals are never touched.** All acquisition modes copy/clone into `~/Repos/reviews/`. The user can keep working in the source tree concurrently — switch branches, edit files, rebase, whatever.
- **Resume is a per-target prompt.** If `<target>/review.md` already exists, ask the user before re-running that target rather than silently re-acquiring. The acquire scripts themselves are always-fresh on each call.
- **No `git fetch`** in local-git mode. Base is whatever `@{u}` / `origin/HEAD` / `origin/main` / `origin/master` already points at in the source repo. Pass `--base` if you want a different anchor.
- **`rm -rf` only paths under `~/Repos/reviews/`.** The acquire scripts enforce this via `REVIEWS_ROOT`; the skill should never `rm` outside it either.
- **Decks are derived, not authoritative.** `review.md` / `summary.md` remain the source of truth. The deck reads the same JSON findings; if the deck and the markdown disagree, fix the renderer, not the markdown.
- **Line numbers come from anchors, deterministically.** Every finding carries a verbatim `anchor` (per-target) or `evidence[].snippet` (cross-cut); Step 7/9 resolves the true source line by grepping it via `~/.pi/agent/lib/review/anchor-line.sh`, independent of the agent's `line` estimate. `resolve-lines.sh` remains only as a patch-offset fallback for legacy findings that lack an anchor. If a deck ever shows a wrong line, the anchor resolution was skipped — re-run it and rewrite the JSON + artifacts.
