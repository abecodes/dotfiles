/**
 * Cross-extension rule-state holder.
 *
 * allow-list publishes its loaded rules here after session_start so other
 * extensions (subagent) can read them without fragile cross-extension
 * imports.
 *
 * Pattern: mirrors _shared/permission-rules.ts. Lives under _shared/ so
 * both allow-list and subagent can import without import cycles.
 *
 * Multi-instance gotcha: pi loads each extension as its own module graph,
 * so relative imports across extension boundaries (e.g. allow-list →
 * _shared/rule-state vs subagent → _shared/rule-state) do NOT dedupe
 * through node's ES module cache. Each extension would see its own private
 * `let _rules`. To make the singleton actually shared, state lives on
 * globalThis under a Symbol.for() key. There is exactly one globalThis per
 * V8 isolate, and Symbol.for() returns the same symbol across module
 * copies, so all instances see the same slot.
 *
 * If you add another stateful module to _shared/, follow this same pattern
 * (do NOT use a module-level `let`).
 */

import type { LoadedRules } from "./permission-rules.js";
import { canonicalToolName, parseRule } from "./permission-rules.js";
const STATE_KEY = Symbol.for("@pi-agent/allow-list/loaded-rules");
type Slot = { rules: LoadedRules | null };
function slot(): Slot {
	const g = globalThis as unknown as Record<symbol, Slot>;
	if (!g[STATE_KEY]) g[STATE_KEY] = { rules: null };
	return g[STATE_KEY];
}

export function publishLoadedRules(rules: LoadedRules): void {
	slot().rules = rules;
}

export function getLoadedRules(): LoadedRules | null {
	return slot().rules;
}

/**
 * Returns true iff any parent ask/deny rule targets a tool the agent has
 * been granted. Used by the subagent extension to decide whether to spawn
 * the child in `--mode rpc` (so inherited ask rules can prompt the user
 * via the parent UI) vs the cheaper `--mode json -p`.
 *
 * Conservative: tool-name match only (ignores patterns / arguments).
 * False positives → unnecessary RPC use (harmless).
 * False negatives → silent hard block of a user's ask rule (correctness bug).
 *
 * Comparison is case-insensitive to match ruleMatches() behaviour in
 * permission-rules.ts (users may write "bash(...)" or "Bash(...)";
 * both must bind when the agent declares a "bash" tool entry).
 */
export function couldRulesBindOnAgent(
	rules: LoadedRules,
	agentToolEntries: Array<{ name: string; patterns?: string[] }>,
): boolean {
	const restrictive = [
		...rules.global.ask, ...rules.global.deny,
		...rules.project.ask, ...rules.project.deny,
		...rules.session.ask, ...rules.session.deny,
	];
	if (restrictive.length === 0) return false;

	const agentToolNamesLower = new Set(
		agentToolEntries.map(e => canonicalToolName(e.name).toLowerCase()),
	);
	for (const raw of restrictive) {
		const parsed = parseRule(raw);
		if (parsed && agentToolNamesLower.has(parsed.tool.toLowerCase())) return true;
	}
	return false;
}
