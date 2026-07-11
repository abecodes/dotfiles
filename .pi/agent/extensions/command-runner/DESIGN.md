# command-runner — deterministic, replayable orchestration as `/<name>` commands

A small extension that runs **user-authored, LLM-drafted orchestration scripts**
as slash commands. The plan lives in code (a `.js` module); the model is only
invoked at the leaves (`c.agent`). The orchestration runs identically every
time; the agent/LLM/CLI *results* still vary.

Sibling pieces:
- **`c-api.ts`** — the typed contract for the `c` handle injected into scripts.
- **`~/.pi/agent/skills/commandify/SKILL.md`** — turns "what we just did" into one
  of these scripts (gather → interview → draft → review/lint → write → reload).

> Status: **v0 draft.** This dir intentionally has **no `index.ts`**, so pi does
> not load it as an extension yet. The runner (`index.ts`) is the next step;
> this doc is the spec to react to.

## Layout

```
~/.pi/agent/commands/
  <name>/
    index.js        # export default async (c, args) => string
    helpers.js?     # optional — real ES module, can be imported by index.js
    <data files>?   # optional static inputs the script reads via c.read
```

`~/.pi/agent/commands/` is **our** convention, scanned by this extension — it is
not a pi-native discovery path (extensions / skills / prompts are).

## Discovery & registration

- On **`session_start`** and **`resources_discover`**, scan `commands/*/index.js`
  and `pi.registerCommand(<name>, …)` for each. So every command is `/<name>` in
  any fresh session. (Same pattern pi-workflow uses for saved workflows.)
- For **same-session** pickup right after `/commandify` writes a new command:
  call **`ctx.reload()`** (re-emits `session_start` + `resources_discover`). The
  skill ends by queuing `/reload`. Without it, the command appears next launch.

## Execution model

The command handler:

1. `const mod = await import(pathToFileURL(<name>/index.js).href)` — native ESM
   import. `.js` needs no transpile; if we ever allow `.ts`, add pi's jiti loader.
2. Build a `CommandApi` instance bound to this invocation (`args`, cwd, a fresh
   progress map, a concurrency limiter).
3. `const report = await mod.default(c, args)`.
4. Deliver `report` into the conversation (`pi.sendMessage`, displayed) and clear
   the widget.

Runs **synchronously within the turn** (no background/vm — see the long async
discussion: we deliberately dropped the durable/background engine). The tool
widget shows `c.log` / `c.phase` progress and a per-`c.agent` row reusing the
subagent renderer.

## `c` → existing infrastructure

| `c` method | Implementation | Gated? |
|---|---|---|
| `c.agent(req)` | the **extracted** subagent spawn — `buildSpawnArgs` (depth.ts) + the `runSingleAgent` collect loop (currently inside `subagent/index.ts`; extract to a shared `subagent/spawn.ts`). Sets `PI_SUBAGENT_PERMISSION_OVERRIDE` via `buildPermissionOverrideEnv` and respects the depth guard. | **Yes** — agents spawned from a command are allow-list-gated exactly like the `subagent` tool's agents. |
| `c.map(items, fn)` | concurrency-capped fan-out (default cap **4**, overridable per call but hard-ceilinged so a command can't spawn hundreds of `pi`s). | n/a |
| `c.all(ps)` | `Promise.all`. | n/a |
| `c.bash(cmd)` | `pi.exec(...)`. Runs as the trusted command process. | **No** — see trust model. |
| `c.read(path)` | `fs.readFile`. | **No** |
| `c.write(path, content)` | `fs.mkdir -p` + `fs.writeFile`. Runs as the trusted command process. | **No** |
| `c.ask(params)` | `ctx.ui.custom()` mounting the **ask-user-question** `Dialog` (same questionnaire contract as the tool). Headless → `{cancelled:true, error:"no_ui"}`. | n/a |
| `c.log` / `c.phase` | progress lines / grouping in the command's tool widget. | n/a |

`model` resolution order inside `c.agent`: tier name (`subagent-models.json`, if
we adopt tiers) → literal `provider/id` → `resolveModelAlias` against the live
registry. `thinking` via `parseThinkingLevel`.

## Trust model — why no `node:vm`

Command scripts are **your own, LLM-drafted, human-reviewed code in
`~/.pi/agent/commands/`** — the same trust level as pi extensions / skills /
agents, all of which pi runs **with full system permissions by design**. A
command-runner adds **no new attack surface**: anyone who can write here can
drop an extension in `~/.pi/agent/extensions/` and get unsandboxed execution
anyway.

`node:vm` is explicitly **not a security boundary** (Node's docs: "do not use it
to run untrusted code"; context escapes are one-liners). It would only block
*accidental* ambient access, at the cost of losing `import`/helpers/npm and
forcing a hand-rolled vm + type-stripper + module-linker. Not worth it.

So: scripts run **unsandboxed** via native `import()`. The safety that matters
is kept where it matters — `c.agent`'s subagents stay allow-list-gated — and
`/commandify` adds a **review + lint** step that flags raw
`fs`/`child_process`/`process`/`require`/dynamic-`import` use and rewrites it to
`c.*`, catching accidental footguns at authoring time rather than via a fake
runtime cage.

## Concurrency

A single shared limiter caps total concurrent `c.agent` spawns per command
(default 4, matching the subagent tool's parallel cap). `c.map`'s per-call
`concurrency` can lower but not raise the ceiling.

## Open items (decide while building the runner)

1. **Cancellation.** Command handlers don't reliably get `ctx.signal` (pi marks
   it "usually undefined … in extension commands"). A long synchronous command
   may not be Esc-cancellable. Options: the runner owns an `AbortController` and
   wires a `/stop`-style escape, or we accept "short fan-outs only" for v0. This
   is the in-turn cost we already discussed — long jobs want the background
   engine we chose not to build.
2. **Output size.** A fan-out report can be large; truncate with `truncateHead`
   and write the full report to a temp file (pi's tool-output convention).
3. **Failure surfacing.** If any `c.agent` returns `ok:false`, mark the command
   result `isError` and prefix the report, so a partial run can't look clean
   (mirrors pi-workflow's failure banner).
4. **`spawn.ts` extraction.** Pull `runSingleAgent` out of `subagent/index.ts`
   into a shared module both the tool and this runner import — avoid a second
   copy of the spawn/collect loop.
