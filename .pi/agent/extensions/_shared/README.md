# _shared

Shared modules that **multiple** extensions need to call. Lives under
`_shared/` so importers (`allow-list`, `subagent`, …) can pull from one
canonical source without depending on each other.

Cross-extension imports outside `_shared/` are forbidden — they create
brittle coupling and import cycles. If you find yourself wanting one,
add the symbol here instead.

## Modules

| File | Stateful? | Purpose |
|---|---|---|
| `permission-rules.ts` | no | Rule grammar: `parseRule`, `ruleMatches`, `decideBash`, `canonicalToolName`, plus all the supporting types. Owned by allow-list, used by subagent. |
| `bash-parse.ts` | no | Bash command decomposer (`;`, `&&`, `\|\|`, `$(…)`, `<(…)`, heredocs, etc.) into per-leaf simple commands. |
| `rule-state.ts` | **yes** (globalThis-keyed) | Cross-extension singleton: allow-list publishes loaded rules at `session_start`; subagent reads them to decide whether to engage RPC mode. |
| `usage-store.ts` | **yes** (globalThis-keyed) | SQLite-backed usage tracking (`node:sqlite`). `usage-tracker` records LLM calls + queries for `/stats`; `lean-ctx` records token savings. Lazy-opened connection lives on a `globalThis` slot so both importers share one handle. Best-effort: never throws into the agent loop. See `usage-tracker/DESIGN.md`. |

## Critical convention: cross-extension state via `globalThis`

**Module-level mutable state (`let _x = …`) does NOT work for state shared
across extensions in this codebase.** Pi loads each extension as its own
module graph, so the same relative path imported from two different
extensions resolves to **two separate module instances**, each with its
own private `let`. allow-list writes to instance A, subagent reads NULL
from instance B, and the bug only manifests at runtime — every test that
imports the module once will pass.

The fix is to park state on `globalThis` under a `Symbol.for(...)` key.
There is exactly one `globalThis` per V8 isolate, and `Symbol.for()`
returns the same symbol value across module copies, so all instances
agree on the slot.

`rule-state.ts` is the canonical example:

```ts
const STATE_KEY = Symbol.for("@pi-agent/allow-list/loaded-rules");
type Slot = { rules: LoadedRules | null };
function slot(): Slot {
  const g = globalThis as unknown as Record<symbol, Slot>;
  if (!g[STATE_KEY]) g[STATE_KEY] = { rules: null };
  return g[STATE_KEY];
}
export function publishLoadedRules(rules: LoadedRules): void { slot().rules = rules; }
export function getLoadedRules(): LoadedRules | null { return slot().rules; }
```

Apply this pattern to any future stateful `_shared/` module. The
mechanism-level test in `rule-state.test.mjs` (the "multi-instance"
block) is the regression guard — copy its shape when adding new state.

## Tests

Standalone test harnesses using jiti (bundled with
`@earendil-works/pi-coding-agent`) so no global `tsx` install is needed:

```bash
node ~/.pi/agent/extensions/_shared/bash-parse.test.mjs
node ~/.pi/agent/extensions/_shared/rule-state.test.mjs
```

`permission-rules.ts` doesn't have its own harness here — its rule-grammar
bits are exercised through `allow-list/tokenizer.test.mjs` (decomposer
logic) and `subagent/test/spawn.test.ts` (rule producer side).

Run the harnesses after any change in this directory. Subtle bugs at
this layer cascade into every consuming extension.
