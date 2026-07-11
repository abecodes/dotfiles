---
name: commandify
description: Capture the orchestration we just did in this conversation — agent calls, tool calls, CLI steps — into a reusable, deterministic `/<name>` command script. Use when the user says "commandify this", "turn this into a command", "make this repeatable", "save this as a command", or "/commandify". Produces ~/.pi/agent/commands/<name>/index.js, drafted from the transcript, reviewed and lint-checked with the user, then registered via /reload.
---

# Commandify — turn this session's orchestration into a `/<name>` command

You are capturing the **repeatable orchestration** from this conversation as a
JS command script that the `command` extension runs. The plan becomes code
(deterministic control flow); the model is only invoked at the leaves via the
injected `c` API. Read `~/.pi/agent/extensions/command-runner/c-api.ts` for the
exact `c` surface and `~/.pi/agent/extensions/command-runner/DESIGN.md` for how scripts run
before you draft anything.

> Dependency: the command-runner extension (`~/.pi/agent/extensions/command-runner/`)
> must be installed for the generated `/<name>` to execute. If only this skill
> exists, you still produce the script — it just won't run until the runner is
> built. Say so if the runner is absent.

**Inputs:** `$ARGUMENTS` (optional desired command name / hint).

## Phase 0 — reconstruct what we did

You have a real advantage over a from-scratch capture: the orchestration is in
this transcript. Extract, in order:

- **Goal** — what the user was trying to accomplish.
- **Steps** — the ordered sequence of `subagent` calls (agent, prompt, cwd),
  direct tool calls (`read`/`grep`/`bash`/…), and `!`/CLI commands. Note which
  fed which (step N's output used in step N+1's prompt).
- **Fan-out** — any step you repeated over a list (each file, each target). That
  becomes `c.map`.
- **Synthesis** — where you combined multiple outputs into one. That becomes a
  final `c.agent` synthesis call, or a plain code merge.
- **Parameters** — what was specific to *this* run (a path, a PR URL, a concern)
  vs. fixed structure. The specific bits become `args`.
- **Corrections** — where the user redirected you. These become rules/comments
  baked into the prompts so the command doesn't repeat the mistake.

If the transcript is thin, fill gaps with `!git diff --stat` and `!git log --oneline -10`.

## Phase 1 — interview the user (use `ask_user_question`)

Never ask these as plain prose. One round per topic; stop early for a simple
2–3 step flow.

1. **Confirm the capture.** Present your Phase 0 summary, a suggested `name`
   (lowercase, hyphens) and one-line description. Ask: right scope? rename?
2. **Parameters.** Show what you'd turn into `args` and what you'd hard-code.
   Confirm what a future invocation supplies (`/<name> <args>`).
3. **Per-step detail** (only if >3 steps or branching): for each major step —
   what it produces that a later step needs, what model/agent tier it should use
   (`cheap` for recon, `heavy` for hard reasoning), and whether it fans out.
4. **Triggers.** Confirm when this command makes sense, for the description.

## Phase 2 — draft `index.js`

Write a single ES module against the `c` API. Shape:

```js
// /<name> — <one-line description>
// args: <what the user passes>
export default async function (c, args) {
  // 1. parse args
  // 2. orchestrate with c.agent / c.map / c.bash / c.read
  // 3. return the final report string
}
```

Rules:
- **Only reach the system through `c`.** No `import`/`require` of `fs`,
  `child_process`, `process`, `fetch`, no top-level dynamic `import()`. Use
  `c.bash` / `c.read` instead. (A helper `import "./helper.js"` of a sibling pure
  module is allowed; system access is not.)
- Keep each `c.agent` **prompt self-contained** — inline the material it must
  reason over (don't assume shared context). For recon/search use a cheap tier;
  reserve `heavy` for genuinely hard units.
- Fan out with `c.map(items, …)`; combine with a final `c.agent` synthesis call
  or plain string assembly; `return` the report.
- Add a short comment block at top: purpose, expected `args`, example invocation.

## Phase 3 — lint, review, save

1. **Lint the draft** (mechanical, before showing it):
   - reject any `require(`, `import … from "node:…"`, `import("…")` of a builtin,
     and bare `fs`/`child_process`/`process.`/`globalThis` system access →
     rewrite those steps to `c.bash` / `c.read`.
   - confirm the default export is `async (c, args)` and every path `return`s a
     string.
2. **Show the full script** as a ```js code block and confirm via
   `ask_user_question`: "Save this as `/<name>`?" (the user reviews best-effort;
   this is codegen, not a recording).
3. On approval, write `~/.pi/agent/commands/<name>/index.js` (create the dir).
   Use `--project` intent only if the user asked for a project-local command, in
   which case write `<cwd>/.pi/commands/<name>/index.js` instead.
4. Register it: queue `/reload` (or tell the user to `/reload`) so `/<name>` is
   live this session. Confirm: where it was saved, how to invoke
   (`/<name> <args>`), and that they can edit the `.js` directly to refine it.

## What you don't do

- Don't invent steps that weren't in the session. Capture what happened, then
  generalize the parameters — nothing more.
- Don't bake secrets or one-off absolute paths into the script; turn them into
  `args` or `c.bash` lookups.
- Don't hand-wave the lint. A script that bypasses `c` for system access defeats
  the whole point — rewrite it or flag it to the user.
- Don't claim the command is deterministic end-to-end. The **orchestration** is;
  the agent/CLI **outputs** are not. Say it that way.
