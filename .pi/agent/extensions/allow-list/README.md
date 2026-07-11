# allow-list

A pi extension that gates every tool call against allow / ask / deny rules.

## Files

- `~/.pi/agent/permission.json` — global rules
- `<cwd>/.pi/permission.json` — per-project rules (override global on conflict)

Either file is optional. Missing files = empty rule set.

## Format

```json
{
  "allow": [
    "Edit",
    "Read",
    "Write",
    "WebSearch",
    "WebFetch(domain:docs.anthropic.com)",
    "Bash(git diff:*)",
    "Bash(git status --porcelain)",
    "Bash(./:*)"
  ],
  "ask": [
    "Bash(git push:*)",
    "Bash(rm:*)"
  ],
  "deny": [
    "Bash(python:*)",
    "Bash(sed:*)"
  ]
}
```

### Pattern syntax

| Pattern | Matches |
|---|---|
| `Edit` | Any call to the `edit` tool. |
| `Bash(git status --porcelain)` | The literal command `git status --porcelain`. |
| `Bash(git diff:*)` | Any command whose tokens start with `git diff` (boundary required → `git difftool` does **not** match). |
| `Bash(./:*)` | Any command starting with `./` (no boundary required because `./` doesn't end on a word char). |
| `WebFetch(domain:example.com)` | A `WebFetch` whose URL host is `example.com` or any subdomain. |
| `subagent(agent:scout)` | A `subagent` call invoking the `scout` agent. Generic `Tool(key:value)` form — see below. |

#### Generic `Tool(key:value)` form

For any tool not handled by the special cases above (`Bash`, `WebFetch`,
`Task`), a rule body of the form `key:value` matches a string-valued top-level
argument: `Tool(key:value)` matches when `input[key] === value`.

Leading `~` / `~/` is expanded to the user's home directory on both sides
before comparison, so `Edit(path:~/.pi/agent/AGENTS.md)` matches whether the
tool was called with the tilde form or the absolute form. Non-tilde strings
pass through unchanged, so existing rules are unaffected. Other tilde forms
(`~user/...`, embedded `~`) are left literal.

For *generic* tools (anything other than `subagent`) whose input is an
aggregated array (`tasks: [...]` / `chain: [...]`), the match aggregates over
entries: allow / ask rules require *every* entry to satisfy `key:value`,
deny rules match if *any* entry does.

#### `subagent` aggregation (single / parallel / chain)

`subagent` is special-cased: a parallel `tasks: [...]` or sequential
`chain: [...]` call is decomposed into per-agent leaves and each leaf is
classified independently against the rule set. The leaf verdicts are then
aggregated like Bash chains:

- any leaf denied (by any rule) → the whole call is **denied**
- every leaf allowed (possibly by *different* rules) → the whole call is
  **allowed**
- otherwise → the user is prompted with a per-leaf overview, with a
  shortcut to save permanent allow rules for all unmatched agents at once

So with `allow: subagent(agent:scout)` and `allow: subagent(agent:tracer)`,
a chain `[scout, tracer]` runs without prompting even though no single rule
matches every entry. A chain `[scout, worker]` (no rule for `worker`) still
prompts.

Tool names are case-insensitive. Pi's lowercase built-ins map to canonical names: `bash`→`Bash`, `read`→`Read`, `write`→`Write`, `edit`→`Edit`, `grep`→`Grep`, `find`→`Find`, `ls`→`List`. Custom/extension tool names match by their registered name.

### Resolution order

For each tool call:

1. Check **session** rules (in-memory, see below). Within them, `deny` > `ask` > `allow` (most-restrictive wins).
2. If no session rule matches, fall back to the **project** file with the same precedence.
3. If still no match, fall back to **global**.
4. If still no match → prompt the user (unknown).

#### Session rules (in-memory)

The prompt offers an **✅ Allow for this session** option in addition to
“Allow once” and the permanent-rule saves. Picking it goes through the same
suggested-pattern picker as a permanent allow rule, but writes the result to
an in-memory `session` rule set instead of `permission.json`. The rule
matches like a normal allow for the rest of this pi run; restarting pi (or
starting a new session) wipes it. Multi-leaf prompts (Bash chains, subagent
parallel/chain) get an equivalent “Allow all unmatched for this session”
button that batches every pending pattern into the session set in one shot.

### Decisions

- **allow** → tool runs.
- **deny** → tool blocked with the rule reason.
- **ask** → user is asked; "No" blocks.
- **unknown** → user is asked. Options:
  - Allow once / Deny once.
  - **Allow for this session** — save an in-memory rule that lasts for this pi run only (pattern picker, no scope picker).
  - Save a permanent allow / ask / deny rule. Pick a suggested pattern (or type a custom one), then pick scope (global or project).

In non-interactive contexts (`-p`, no UI), `ask` and unknown both block.

### Bash command decomposition

A single Bash tool call often chains commands with `;`, `&&`, `||`, `|`, `&`,
newlines, `for`/`while`/`if` constructs, and `$(...)` / `<(...)` substitutions.
Rather than match the full concatenated string against rules, the extension
decomposes the command into its constituent simple commands ("leaves") and
classifies each one independently:

- Any leaf hitting a **deny** rule (top-level **or** inside `$(...)` /
  `<(...)` / a loop body) blocks the whole call.
- All leaves matching **allow** rules → the call passes silently.
- Otherwise (some unknown / `ask`) → you get a multi-leaf review prompt with:
  - `✅ Allow this whole call once` (no rules saved)
  - `🛑 Deny this call`
  - `📌 Save permanent allow rules for all unmatched (N patterns)` — batch-saves
    one suggested rule per unique unmatched leaf.
  - `🔧 Configure each unmatched subcommand individually…` — per-leaf prompt;
    you can save different verdicts per pattern, or use "Allow this subcommand
    for this call (no rule saved)" to skip a leaf without persisting anything.

Leading `VAR=val` assignments and modifier words (`time`, `nohup`, `exec`,
`command`, `builtin`) are stripped from each leaf for matching, so
`SUDO_ASKPASS=foo sudo cmd` matches `Bash(sudo:*)` and `time go build` matches
`Bash(go build:*)`. The original (non-stripped) form is shown in prompts.

Heredoc bodies (`<<EOF … EOF`, `<<-EOF`, `<<'EOF'`) are skipped so they don't
get classified as commands. Process substitution (`<(…)`, `>(…)`) and command
substitution (`$(…)`, `` `…` ``) recurse, so `diff <(cat a) <(cat b)` requires
rules for `Bash(diff:*)` AND `Bash(cat:*)`.

## Cross-extension protocol

The rule grammar (parser, matcher, classifier, bash decomposer) lives in
`~/.pi/agent/extensions/_shared/permission-rules.ts`. Other extensions can
import from there to speak the same syntax without re-implementing it.

allow-list exposes two env-var contracts to other extensions in the same
parent process:

| Env var | Direction | Purpose |
|---|---|---|
| `PI_ALLOW_LIST_ACTIVE` | allow-list → others | Set to `"1"` in allow-list's factory. Other extensions can read this in the parent process to detect that allow-list is loaded before relying on it for enforcement. |
| `PI_SUBAGENT_PERMISSION_OVERRIDE` | others → allow-list | A JSON-encoded `{allow, ask, deny}` rule file. Read on `session_start`. **Triggers constrained-override mode**: the override's `allow` list IS the only positive surface for this run (parent allow rules are dropped). Parent project + global `deny` and `ask` rules are inherited as a defense-in-depth backstop. The merged rule file becomes the session set; resolution is session-only. |

Current consumer of the protocol:

- **subagent** (`~/.pi/agent/extensions/subagent`) parses the agent's
  `tools:` frontmatter list (bare entries like `read` and scoped entries
  like `bash(go test:*)`) and ships the entire list as a permission override
  to the spawned child. Bare tool entries become bare allow rules; scoped
  entries become `Tool(prefix:*)` rules. allow-list in the child enforces
  them through its existing `tool_call` gate. The subagent extension
  refuses to spawn an agent that declares a `tools:` list when allow-list
  isn't active (failing closed; the alternative would silently run the
  agent under the parent's permissions instead of the exclusive contract
  its frontmatter promised).

  When the parent has a TUI and any inherited `ask`/`deny` rule could
  bind on one of the agent's tools, subagent additionally spawns the
  child in RPC mode and pumps `extension_ui_request` events back to the
  parent so the user can answer ask prompts. See
  [`subagent/README.md` → RPC mode](../subagent/README.md#rpc-mode-interactive-permission-forwarding).

**Unknown-under-override = hard block.** When
`PI_SUBAGENT_PERMISSION_OVERRIDE` is set, allow-list short-circuits any
tool-call leaf with no rule match (`decision === null`) to a deny
before the prompt path. This applies on every code path (Bash review,
subagent review, generic tool fallback) and runs before the
`!ctx.hasUI` check, so it fires even in RPC mode. Reason: the agent's
frontmatter is the positive surface contract; if a tool isn't declared,
it blocks regardless of whether the user could be prompted.

**Constrained-override semantic.** When the override is present:

- The agent's frontmatter `tools:` list defines the *positive surface*:
  parent project + global `allow` rules are dropped, because they
  represent the user's pre-approvals for their own interactive runs, not
  part of the agent's contract.
- Parent project + global `deny` and `ask` rules are *inherited* as a
  defense-in-depth backstop. A user-level `deny: Bash(rm -rf:*)` in
  `~/.pi/agent/permission.json` will bind inside the subagent even if the
  agent declared bare `bash`. A project-level `Read(path:.aws/*)` deny
  also binds, restricting an agent's bare `read` entry as expected.

Mechanically the override and inherited deny+ask rules are merged into a
single session rule file; within-file precedence (`deny > ask > allow`)
guarantees an inherited deny shadows an override allow without needing to
change cross-scope resolution.

**Note on `ask` in subagents.** When the parent pi process has a TUI,
inherited `ask` rules **route to the parent UI** via the subagent
extension's RPC pump — the user sees one dialog per ask hit and decides
per call, exactly as they would in their own runs. See
[`subagent/README.md` → RPC mode](../subagent/README.md#rpc-mode-interactive-permission-forwarding)
for the mechanism.

When there is no parent TUI (running pi headlessly, no UI in the spawn
chain), `ask` falls through to a hard block in the subagent, same as in
standalone `pi -p`. So `ask: Bash(git push:*)` will always prompt in
interactive use, but quietly block in CI / scripted runs.

### Cross-extension contract: `_shared/rule-state.ts`

In the parent process, allow-list publishes its loaded rules in the
`session_start` handler:

```ts
import { publishLoadedRules } from "../_shared/rule-state.js";
// after loading + override merge:
publishLoadedRules(rules);
```

The subagent extension reads them via `getLoadedRules` to compute
`couldRulesBindOnAgent` — if any inherited `ask`/`deny` rule could bind
on a tool the agent has been granted, subagent spawns the child in
`--mode rpc` instead of `--mode json -p`. Without that signal the child
would silently hard-block on the user's ask rules, since `pi -p` has no
UI.

The rule-state module uses a `globalThis`-keyed singleton instead of a
module-level `let`, because pi loads each extension as its own module
graph and relative imports across extension boundaries don't dedupe.
See [`_shared/README.md`](../_shared/README.md) for the convention.

## Slash command

- `/permissions` — interactive menu
- `/permissions list` — print all rules grouped by scope and verdict
- `/permissions add` — add a rule via prompts
- `/permissions remove` — pick a rule to delete
- `/permissions reload` — re-read both JSON files from disk
  - **Note:** this only reloads the rule files, not the extension code itself.
    If you've edited `index.ts` you need to restart pi for the change to take
    effect.
- `/permissions decompose <cmd>` — debug helper. Tokenises a bash command and
  prints each extracted leaf with the rule it would match (or "no rule"). No
  side effects — useful when you want to know *why* something matched
  (or didn't) without running it.

## Tests

The bash decomposition is heuristic. A standalone tokenizer test harness lives
at `tokenizer.test.mjs`. It uses jiti (bundled with pi) to load the TypeScript
source directly, so no global `tsx` install is needed:

```bash
node ~/.pi/agent/extensions/allow-list/tokenizer.test.mjs
```

The test covers the splitter, substitution extraction, heredoc stripping,
`<(…)` / `>(…)` process substitution, the `time` / `SUDO_ASKPASS=` strip
behaviour, and the two real-world bash chains that motivated decomposition.
Run it after every change to the parser.
