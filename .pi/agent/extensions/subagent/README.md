# subagent

A pi extension that lets the running agent delegate work to specialized
subagents in isolated `pi -p` child processes. Provides two tools:

- `subagent_list` — list available agents and their descriptions.
- `subagent` — run one or more agents (single, parallel, or chained).

Agents live as Markdown files with YAML frontmatter under
`~/.pi/agent/agents/` (user scope) and `<cwd>/.pi/agents/` (project scope).
Frontmatter:

```yaml
---
name: my-agent
description: One-line summary used in the auto-injected list.
tools: read, grep, bash    # optional --tools allowlist for the child
model: portkey/claude-sonnet-4-6
thinking: xhigh            # optional, mapped to `pi --thinking <level>`
---
You are …
```

### Thinking level

`thinking:` (alias `thinkingLevel:`) sets the child pi process's reasoning
effort. Accepted values mirror pi's CLI: `off`, `minimal`, `low`, `medium`,
`high`, `xhigh`. Case-insensitive; whitespace is trimmed.

#### Unset / invalid values

Unknown levels, empty strings, and non-string values are silently dropped
(better than crashing the child on `pi --thinking <garbage>`). When the
field is dropped or absent, **subagent omits `--thinking` entirely** and the
child boots like any fresh `pi -p`: it walks pi's default-resolution chain
(scoped per-model config → `settings.json`'s `defaultThinkingLevel` →
hardcoded `medium`).

In particular this means the child does **not** inherit the running parent's
*currently selected* level. If you cycle the parent to `xhigh` and then
delegate to an agent without a `thinking:` field, the child still starts at
your configured default (typically `medium`), not `xhigh`. To pin a
specific level for an agent, set it explicitly in the frontmatter.

#### Unsupported levels are clamped

Not every model supports every level — `xhigh` in particular is opt-in per
model via `thinkingLevelMap`. When the chosen model's map omits the
requested level, pi's `clampThinkingLevel` silently snaps it to the nearest
supported level (preferring upward, then downward). No error, no warning.
So `thinking: xhigh` on a model whose map lacks it (Opus 4.5, GPT-4o, …)
becomes `high`. Pair `thinking: xhigh` with a model that actually
advertises it (e.g. `claude-opus-4-7`).

## Tool scoping (cross-extension protocol)

Agent frontmatter declares which tools the spawned child can call. The
`tools:` list is **exclusive**: the child sees only what's listed, gated by
the rule grammar allow-list uses for its config files.

```yaml
tools:
  - read
  - bash(go test:*, ./scripts/gotest-distill.sh:*)
  - lsp_diagnostics
```

Both forms work: comma-separated string (paren-aware split) and YAML list.
Trailing `:*` is optional. Same tool listed both scoped and unscoped collapses
to unscoped (the more permissive shape wins inside the agent's own list).

### How enforcement works

The subagent extension does **not** enforce permissions itself. It
serializes the `tools:` list into a permission-override env var and leaves
enforcement to the [allow-list](../allow-list/README.md) extension, which
already implements the rule grammar with full per-leaf bash decomposition
(`;`, `&&`, `||`, `$(…)`, `<(…)`, etc.) via the shared parser at
`~/.pi/agent/extensions/_shared/`.

**Protocol summary** (see allow-list's README for the canonical contract):

1. On agent spawn, subagent parses the frontmatter `tools:` list and emits
   a `RuleFile` of allow rules. Bare entries become bare allow rules
   (`read` → `"Read"`, matches any Read call); scoped entries become
   `Tool(prefix:*)` rules (`bash(go test:*)` → `"Bash(go test:*)"`).
2. The rule file is JSON-encoded into the env var
   `PI_SUBAGENT_PERMISSION_OVERRIDE` and passed to the child process.
3. allow-list (running in the child) reads the env var on `session_start`
   and builds the effective session rule file by merging:
   - `allow`: override only (parent project + global `allow` rules are
     dropped — they're the user's pre-approvals for their own
     interactive runs, not part of the agent contract).
   - `ask` / `deny`: parent project + global rules ARE inherited and
     unioned with the override's own `ask` / `deny` entries.

   Project + global rule sets are then wiped so resolution is
   session-only and self-contained.
4. allow-list's existing `tool_call` gate enforces the rules. Anything not
   covered falls through to unknown and blocks in non-interactive (`pi -p`)
   mode — which subagent always uses.

### Constrained-override semantic

The agent's frontmatter defines the *positive* tool surface; parent
`deny` and `ask` rules act as a defense-in-depth backstop.

Concrete consequences:

- A user-level `deny: Bash(rm -rf:*)` in `~/.pi/agent/permission.json`
  binds inside the subagent even if the agent declared bare `bash`.
  Parent denies always shadow agent allows because within-file precedence
  is `deny > ask > allow`.
- An agent's bare `read` entry IS further restricted by a project-level
  `Read(path:.aws/*)` deny.
- Parent `allow` rules do **not** widen the agent's surface. If the agent
  didn't declare `bash(npm:*)`, a user-level `allow: Bash(npm:*)` does
  not let it run npm.
- Parent `ask` rules **route to the parent UI** when the parent has a
  TUI (the typical interactive case) — see [RPC mode](#rpc-mode-interactive-permission-forwarding)
  below. The user sees one dialog per ask hit and decides per call.
  In contexts without a parent TUI (e.g. running pi headlessly), `ask`
  falls through to a hard block, same as in `pi -p`.
- Anything not listed in `tools:` and not covered by an inherited rule
  is **unknown**, and unknown-under-override always blocks hard — even in
  RPC mode. The agent's frontmatter is the positive surface contract;
  parent rules can only narrow it, never widen it. So an agent with
  `tools: bash(go test:*)` cannot run `git status` regardless of any
  parent allow.

### allow-list presence check

Because enforcement lives in allow-list, the subagent extension refuses to
spawn any agent that declared a `tools:` list when allow-list isn't loaded
— otherwise the override would silently no-op and the agent would inherit
the parent's permission.json instead of the exclusive contract its
frontmatter promised.

The check reads the `PI_ALLOW_LIST_ACTIVE` sentinel that allow-list sets in
its factory. If the env var isn't `"1"` and the agent has any tool entries
at all, the spawn fails with a message pointing at
`~/.pi/agent/extensions/allow-list/`.

Agents with no `tools:` field at all are unaffected by this check — they
continue to inherit the parent's full pi inventory and the user's
permission.json.

## RPC mode (interactive permission forwarding & nested progress)

Whenever the parent has a TUI we spawn the child in `pi --mode rpc`
instead of the cheap `pi --mode json -p`. RPC mode buys two upstream
channels we cannot get otherwise:

1. **Permission prompts**: inherited `ask`/`deny` rules running in the
   child route back to the parent UI so the user can decide per call.
2. **Nested grandchild progress**: when an agent itself spawns subagents
   (e.g. `implement` calling `coder` then `gateway`), the inner runs
   stream live snapshots upstream as `setStatus("subagent:…", …)`. See
   [Nested progress streaming](#nested-progress-streaming) below.

The cost vs. JSON mode is one stdin pipe + a prompt handshake —
negligible compared to the long silence the user otherwise sees during
long subagent runs. With no parent UI (headless `pi -p` at the top),
there's nothing to push to so we stay in JSON mode and skip the
handshake.

### What the parent's pump does

The child emits all its `ctx.ui.*` calls as `extension_ui_request` JSON
lines on stdout (per pi's RPC protocol — see
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`).
The parent's pump (`subagent/index.ts:handleExtensionUIRequest`) handles
them in three ways:

| Method category | Examples | Behaviour |
|---|---|---|
| **Dialog** | `select`, `confirm`, `input` | Serialized through a per-`execute()` mutex (so parallel children don't stack prompts). Renders via `ctx.ui.custom()` using the custom `Dialog` component in `subagent/dialog.ts`. Response written back to child stdin. |
| **Forwarded** | `notify` | Called on the parent's `ctx.ui` directly. Low noise, useful surface for one-shot child notifications (e.g. "allow-list: rules loaded"). |
| **Captured** | `setWidget` | Buffered per-child by `widgetKey`. NOT forwarded to parent UI — mixing child-internal widget chrome into the parent's terminal causes layout bleed. Captured content is replayed inside the next dialog as context lines (`DialogParams.extraLines`). |
| **Routed (subagent prefix)** | `setStatus` whose `statusKey` starts with `subagent:` | Intercepted as nested-progress events. At the topmost user pi (`getCurrentDepth() === 0`) the snapshot is decoded into the per-run progress map and the parent widget re-renders. At every intermediate hop the call is forwarded upward verbatim via `ctx.ui.setStatus(key, text)` so it eventually reaches depth 0. See [Nested progress streaming](#nested-progress-streaming). |
| **Dropped** | `setStatus` (other keys), `setTitle`, `set_editor_text`, `setHeader`, `setFooter`, working/editor methods | Silently ignored. The parent owns its own chrome; the child is headless from the user's perspective. |

Unknown methods (e.g. a future `editor`) get an immediate
`{cancelled: true}` response so the child never hangs waiting.

### Lifecycle

1. **Spawn handshake.** Child spawned with `stdio[0]: "pipe"`, then
   parent writes `{type: "prompt", message: "Task: …"}` to its stdin.
   (RPC mode does not accept a positional task arg, unlike json mode.)
2. **Pump loop.** Each line on the child's stdout is JSON-parsed and
   dispatched. `extension_ui_request` events route to the handler
   above; everything else (`message_end`, `agent_end`, etc.) flows
   through the existing aggregation path unchanged.
3. **Shutdown.** The RPC protocol has no "exit" command — by convention
   the child exits when it sees EOF on stdin. On `agent_end`, the pump
   calls `proc.stdin.end()`. The child shuts down cleanly, the existing
   `proc.on("close")` resolves the run promise, no hang.

### Cancellation paths

The forwarded dialog supports two cancellation paths, both routed
through `Dialog.cancel()` (idempotent):

- **Child crash.** `proc.once("close", () => dialog?.cancel())` fires
  if the child dies mid-prompt. Dialog dismisses; `{cancelled: true}`
  written back over stdin (no-op if stdin already closed).
- **Abort signal.** `signal?.addEventListener("abort", …)` fires when
  the user aborts the parent run. Same dismiss path.

There is intentionally **no parent-side timeout**. The user is the
principal; the agent waits for them, not the other way around. If a
child legitimately needs a deadline, the RPC protocol allows it to
include a `timeout` field in its own `extension_ui_request`
(child-side auto-resolves) — we don't impose one from above.

### Cross-extension wiring

The subagent extension reads loaded rules from
`_shared/rule-state.ts:getLoadedRules`. allow-list publishes them in
its `session_start` handler. See [`_shared/README.md`](../_shared/README.md)
for the multi-instance singleton convention this relies on (`globalThis`-
keyed slot, not module-level `let`) — critical, easy to break.

### Recursive subagents

When `MAX_SUBAGENT_DEPTH > 1` (default 2), prompts cascade up the
chain. Each level is a parent to its child and a child to its parent;
the pump at each level forwards to the next. The user at the top sees
one dialog regardless of depth. Verified by mental trace; not
integration-tested.

## Nested progress streaming

Motivation: when an `implement` agent spawns `coder` and `gateway` as its
own subagents, the user's pi never directly watches those grandchildren.
The user sees `implement`'s tool widget update on each of its own
`message_end` events, but the inner runs (which can take minutes) appear
as a static `→ subagent {agent: "coder", …}` line until they finish.

Fix: every `runSingleAgent` invocation generates a unique progress key
(`subagent:<childDepth>:<agentName>:<runId>`) and pushes a snapshot of
the child's `usage`, `model`, `lastToolCall`, and `exitCode` upstream on
every `emitUpdate()` via `ctx.ui.setStatus(progressKey, JSON.stringify(…))`.
The last snapshot is sent right after the child's exit code resolves and
carries the terminal `exitCode` plus a frozen usage total. Entries are
NOT cleared after that — the user wants to see the receipt (turns,
tokens, $) of every grandchild in the parent's final widget, not just
while they're running. The receiving pi's `nestedProgress` map naturally
goes out of scope when its own `runSingleAgent` returns, so entries
don't leak across separate top-level invocations.

The `setStatus(key, undefined)` channel still works on the receiver side
(deletes the entry from the map) — it's just unused by the producer
today. Reserved for future cases where an explicit clear is wanted
(timeout sweeps, manual dismissal, etc.).

The push is gated on `getCurrentDepth() > 0` — we never call
`ctx.ui.setStatus` from the topmost pi because pi's interactive mode
renders extension status entries in the user's footer; a JSON blob there
is worse than useless.

### Routing at the receiver

`handleExtensionUIRequest` in `subagent/index.ts` recognizes
`subagent:`-prefixed `setStatus` events before the generic
fire-and-forget table. The routing decision is centralized in
`progress.ts:decideProgressRouting`:

- **Render** (depth 0): decode the JSON payload into a
  `NestedProgressEntry`, store under `progressKey` in the per-run
  `nestedProgress` map, trigger `emitUpdate()` so the parent's
  `SubagentDetails.nestedProgress` updates and the widget re-renders.
- **Forward** (depth > 0): re-emit `ctx.ui.setStatus(key, text)`
  verbatim so the next hop up the chain handles it. Eventually reaches
  depth 0.

### Wire format

Payload shape (encoded JSON in `statusText`, see `progress.ts` for the
canonical TypeScript types):

```ts
{
  depth: number;            // 1 = direct child of user pi, 2 = grandchild, …
  agentName: string;
  taskPreview: string;      // truncated to 200 chars
  step?: number;            // chain mode
  exitCode: number;         // -1 = running
  usage: { input, output, cacheRead, cacheWrite, cost, contextTokens, turns };
  model?: string;
  lastToolCall?: { name: string; argsPreview?: string };
  stopReason?: string;
}
```

Decoders are tolerant: malformed payloads are silently dropped on the
receiver side rather than throwing, so a broken upstream cannot poison
the parent. See `progress.ts:decodeSnapshot` for the validation rules
and `test/progress.test.ts` for coverage.

### Rendering

Nested entries are surfaced as a "Subagents:" block at the bottom of
the existing single/chain/parallel widget renderers (both collapsed
text and expanded `Container` views). One row per entry, indented by
depth so the tree shape is visible. Per-row icons distinguish state:
⏳ running, ✓ success, ✗ error.

Rows are ordered by **call order** — each entry carries a monotonic
`seq` stamped the first time its `progressKey` is seen (and preserved
across updates), so rows appear in the order subagents were launched
rather than alphabetically by name. `progressKey` is the tiebreak for
any legacy entry without a `seq`. Depth drives indentation only, not
ordering.

When more than one row is present, a "Totals by agent:" rollup follows,
summing turns / token usage / cost per agent name (e.g. `coder ×2`),
listed in first-appearance order. `contextTokens` and `model` are
omitted from the rollup (point-in-time / per-run, not additive).

Entries persist after their child completes (they no longer auto-clear
on success) so the parent's final widget shows the receipt for every
grandchild that ran during this invocation, with frozen terminal usage
totals. The map naturally goes out of scope when the parent's own
`runSingleAgent` returns — entries don't leak across separate top-level
invocations.

#### Cross-step persistence in chain mode

Each chain step's `runSingleAgent` owns its own per-step nested map
that dies with the step. To keep step N's grandchildren rows visible
after step N+1 starts, the chain orchestrator (`subagent` tool's chain
branch) maintains a chain-level accumulator keyed by `progressKey`
(uuid-suffixed, never collides across steps). Each `chainUpdate` merges
the current step's nested entries into it, never deleting; final
success and error returns include the accumulated snapshot so the
final chain widget shows every grandchild that ran across every step.
Parallel mode uses an analogous index-aligned `allNestedProgress`
buffer.

## Depth guard

A child subagent can't spawn its own grandchildren past
`PI_SUBAGENT_MAX_DEPTH` (default 2). Belt-and-suspenders behind pi's
`--tools` allowlist (which already excludes `subagent` from agent toolsets).

## `spawnSubagent` (public wrapper)

`index.ts` exports `spawnSubagent(opts): Promise<AgentResult>` — the one
supported entry point for other code (notably the command-runner's `c.agent`)
to spawn a subagent. It wraps the internal `runSingleAgent` without changing
its signature: resolves the named agent, applies per-spawn `model`/`thinking`/
`tools` overrides (by cloning the roster entry, so the allow-list presence
guard still fires), honors `timeoutMs` via an `AbortController`, and maps the
internal `SingleResult` onto the public `AgentResult` (`toAgentResult`, in
`helpers.ts`). `AgentResult`/`AgentUsage` live in `helpers.ts` (the producer)
and are re-exported by command-runner's `c-api.ts`, so the dependency runs
command-runner -> subagent, never the reverse. The `subagent` tool's own path
is unchanged.

## Tests

```bash
cd ~/.pi/agent/extensions/subagent
# Pure modules (no pi runtime):
node --test --experimental-strip-types \
  test/spawn.test.ts test/progress.test.ts test/model-alias.test.ts test/result-map.test.ts
# Tests that import a pi-runtime module need the resolve hook:
node --import ./test/pi-resolve.mjs --test --experimental-strip-types \
  test/agents.test.ts test/dialog.test.ts test/spawn-wrapper.test.ts
```

`spawn.test.ts` covers depth guards, spawn-arg construction, frontmatter
parsing (including the scoped `tool(prefix:*)` syntax), and the producing
side of the cross-extension permission protocol. The consuming side (read
& merge) is tested in allow-list.

`progress.test.ts` covers the nested-progress wire format: key
construction & sanitization, encode/decode roundtrips, malformed-payload
tolerance, the depth-based routing decision, and the
`lastToolCallFromMessages` helper that extracts the "what's it doing now"
segment from streamed assistant messages.
