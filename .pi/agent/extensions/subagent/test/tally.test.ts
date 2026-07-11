import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentCostTally, formatAgentCostChip, formatAgentTokenStats } from "../progress.ts";

// Helper: build a usage object with a given cost and optional token fields.
function usage(
	cost: number,
	tokens: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }> = {},
) {
	return {
		cost,
		input: tokens.input ?? 0,
		output: tokens.output ?? 0,
		cacheRead: tokens.cacheRead ?? 0,
		cacheWrite: tokens.cacheWrite ?? 0,
	};
}

// ─── AgentCostTally.record ───────────────────────────────────────────────────

test("AgentCostTally: sums cost across distinct terminal runs", () => {
	const t = new AgentCostTally();
	assert.equal(t.record("a", usage(0.01), 0), true);
	assert.equal(t.record("b", usage(0.02), 0), true);
	assert.equal(t.total, 0.03);
	assert.equal(t.runCount, 2);
});

test("AgentCostTally: sums token totals across distinct terminal runs", () => {
	const t = new AgentCostTally();
	t.record("a", usage(0.01, { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }), 0);
	t.record("b", usage(0.02, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }), 0);
	assert.deepEqual(t.tokenTotals, { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
});

test("AgentCostTally: ignores in-flight runs (exitCode -1) until terminal", () => {
	const t = new AgentCostTally();
	// Running snapshots arrive repeatedly before the run closes.
	assert.equal(t.record("a", usage(0.05, { input: 5 }), -1), false);
	assert.equal(t.record("a", usage(0.05, { input: 5 }), -1), false);
	assert.equal(t.total, 0);
	assert.equal(t.runCount, 0);
	assert.deepEqual(t.tokenTotals, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	// Terminal snapshot for the same key is counted once.
	assert.equal(t.record("a", usage(0.05, { input: 5 }), 0), true);
	assert.equal(t.total, 0.05);
	assert.equal(t.runCount, 1);
	assert.equal(t.tokenTotals.input, 5);
});

test("AgentCostTally: dedupes a terminal run observed more than once", () => {
	const t = new AgentCostTally();
	assert.equal(t.record("a", usage(0.07, { input: 9 }), 0), true);
	assert.equal(t.record("a", usage(0.07, { input: 9 }), 0), false);
	assert.equal(t.record("a", usage(999, { input: 999 }), 1), false);
	assert.equal(t.total, 0.07);
	assert.equal(t.runCount, 1);
	assert.equal(t.tokenTotals.input, 9);
});

test("AgentCostTally: counts failed runs (they still cost tokens)", () => {
	const t = new AgentCostTally();
	assert.equal(t.record("a", usage(0.01, { output: 3 }), 1), true);
	assert.equal(t.total, 0.01);
	assert.equal(t.runCount, 1);
	assert.equal(t.tokenTotals.output, 3);
});

test("AgentCostTally: zero-cost runs count toward runCount but not total", () => {
	const t = new AgentCostTally();
	assert.equal(t.record("a", usage(0), 0), true);
	assert.equal(t.record("b", usage(0), 0), true);
	assert.equal(t.total, 0);
	assert.equal(t.runCount, 2);
});

test("AgentCostTally: non-finite or negative values contribute 0 but still count the run", () => {
	const t = new AgentCostTally();
	assert.equal(t.record("a", usage(Number.NaN, { input: Number.NaN }), 0), true);
	assert.equal(t.record("b", usage(Number.POSITIVE_INFINITY, { output: -5 }), 0), true);
	assert.equal(t.record("c", usage(-5, { cacheRead: Number.NaN }), 0), true);
	assert.equal(t.total, 0);
	assert.equal(t.runCount, 3);
	assert.deepEqual(t.tokenTotals, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("AgentCostTally: reset clears total, tokens, and dedupe set", () => {
	const t = new AgentCostTally();
	t.record("a", usage(0.01, { input: 5 }), 0);
	t.reset();
	assert.equal(t.total, 0);
	assert.equal(t.runCount, 0);
	assert.deepEqual(t.tokenTotals, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	// Same key may be reused after reset (a /new session reuses nothing, but
	// the dedupe set must not block a fresh tally).
	assert.equal(t.record("a", usage(0.02, { input: 7 }), 0), true);
	assert.equal(t.total, 0.02);
	assert.equal(t.tokenTotals.input, 7);
});

// ─── formatAgentTokenStats ───────────────────────────────────────────────────

test("formatAgentTokenStats: renders pi-footer-style breakdown with CH", () => {
	assert.equal(
		formatAgentTokenStats({ input: 24, output: 3400, cacheRead: 306000, cacheWrite: 21000 }),
		"↑24 ↓3.4k R306k W21k CH93.6%",
	);
});

test("formatAgentTokenStats: omits zero fields", () => {
	assert.equal(formatAgentTokenStats({ input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }), "↑100");
});

test("formatAgentTokenStats: no CH without cache activity", () => {
	assert.equal(
		formatAgentTokenStats({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }),
		"↑100 ↓50",
	);
});

test("formatAgentTokenStats: empty string for all-zero usage", () => {
	assert.equal(formatAgentTokenStats({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), "");
});

// ─── formatAgentCostChip ─────────────────────────────────────────────────────

test("formatAgentCostChip: hidden for genuinely-zero total", () => {
	assert.equal(formatAgentCostChip(0, 3), undefined);
});

test("formatAgentCostChip: hidden when a tiny nonzero total rounds to $0.000", () => {
	// (0, 0.0005) rounds to "0.000" at 3 decimals — must hide, not render
	// a misleading "agents: $0.000".
	assert.equal(formatAgentCostChip(0.0004, 1), undefined);
	assert.equal(formatAgentCostChip(0.00049, 2), undefined);
});

test("formatAgentCostChip: shows once the total rounds to a nonzero $x.xxx", () => {
	assert.equal(formatAgentCostChip(0.0005, 1), "agents: $0.001 (1 run)");
	assert.equal(formatAgentCostChip(1.228, 7), "agents: $1.228 (7 runs)");
});

test("formatAgentCostChip: singular vs plural run label", () => {
	assert.equal(formatAgentCostChip(0.5, 1), "agents: $0.500 (1 run)");
	assert.equal(formatAgentCostChip(0.5, 2), "agents: $0.500 (2 runs)");
});

test("formatAgentCostChip: 3-decimal precision matches pi's footer", () => {
	assert.equal(formatAgentCostChip(0.1239, 1), "agents: $0.124 (1 run)");
});

test("formatAgentCostChip: appends token breakdown when tokens are supplied", () => {
	assert.equal(
		formatAgentCostChip(77.337, 196, {
			input: 24,
			output: 3400,
			cacheRead: 306000,
			cacheWrite: 21000,
		}),
		"agents: $77.337 (196 runs | ↑24 ↓3.4k R306k W21k CH93.6%)",
	);
});

test("formatAgentCostChip: omits token section when all-zero (local/proxy models)", () => {
	assert.equal(
		formatAgentCostChip(1.5, 3, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
		"agents: $1.500 (3 runs)",
	);
});
