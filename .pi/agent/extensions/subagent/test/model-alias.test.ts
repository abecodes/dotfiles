import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModelAlias, type ModelRegistryLite } from "../helpers.ts";

// Mirror of the relevant slice of the live registry: portkey caps Opus at 4-8,
// a hypothetical "anthropic" provider carries higher + date-stamped snapshots,
// plus a double-digit minor to exercise numeric (not lexical) ordering.
function makeRegistry(): ModelRegistryLite {
	const ids: Array<[string, string]> = [
		["portkey", "claude-opus-4-6"],
		["portkey", "claude-opus-4-7"],
		["portkey", "claude-opus-4-8"],
		["portkey", "claude-sonnet-4-6"],
		["portkey", "claude-haiku-4-5"],
		["anthropic", "claude-opus-4-5"],
		["anthropic", "claude-opus-4-5-20251101"], // dated snapshot of 4-5
		["anthropic", "claude-opus-4-9"],
		["anthropic", "claude-opus-4-10"], // numeric > 4-9, lexical < "4-9"
	];
	return { getAll: () => ids.map(([provider, id]) => ({ provider, id })) };
}

test("provider-scoped alias resolves to that provider's latest version", () => {
	assert.equal(
		resolveModelAlias("portkey/claude-opus", makeRegistry()),
		"portkey/claude-opus-4-8",
	);
});

test("provider scoping never claims a version the provider lacks", () => {
	// anthropic has 4-10/4-9 but portkey tops out at 4-8.
	assert.equal(
		resolveModelAlias("portkey/claude-opus", makeRegistry()),
		"portkey/claude-opus-4-8",
	);
	assert.equal(
		resolveModelAlias("anthropic/claude-opus", makeRegistry()),
		"anthropic/claude-opus-4-10",
	);
});

test("numeric ordering: 4-10 beats 4-9 (not lexical)", () => {
	assert.equal(
		resolveModelAlias("anthropic/claude-opus", makeRegistry()),
		"anthropic/claude-opus-4-10",
	);
});

test("clean version preferred over date-stamped snapshot", () => {
	// Only 4-5 and 4-5-20251101 exist for this narrowed family slice.
	const reg: ModelRegistryLite = {
		getAll: () => [
			{ provider: "anthropic", id: "claude-opus-4-5" },
			{ provider: "anthropic", id: "claude-opus-4-5-20251101" },
		],
	};
	assert.equal(resolveModelAlias("anthropic/claude-opus", reg), "anthropic/claude-opus-4-5");
});

test("concrete id passes through unchanged", () => {
	assert.equal(
		resolveModelAlias("portkey/claude-opus-4-8", makeRegistry()),
		"portkey/claude-opus-4-8",
	);
	assert.equal(
		resolveModelAlias("portkey/claude-sonnet-4-6", makeRegistry()),
		"portkey/claude-sonnet-4-6",
	);
});

test("bare alias resolves to a bare latest id (provider-agnostic)", () => {
	// Highest claude-opus id across all providers is 4-10.
	assert.equal(resolveModelAlias("claude-opus", makeRegistry()), "claude-opus-4-10");
});

test("single-version families resolve to the sole entry", () => {
	assert.equal(
		resolveModelAlias("portkey/claude-sonnet", makeRegistry()),
		"portkey/claude-sonnet-4-6",
	);
	assert.equal(
		resolveModelAlias("portkey/claude-haiku", makeRegistry()),
		"portkey/claude-haiku-4-5",
	);
});

test("unknown family / typo is left as authored", () => {
	assert.equal(
		resolveModelAlias("portkey/claude-supernova", makeRegistry()),
		"portkey/claude-supernova",
	);
	// Wrong provider for an otherwise-real family: no in-scope candidates.
	assert.equal(resolveModelAlias("openai/claude-opus", makeRegistry()), "openai/claude-opus");
});

test("non-numeric family suffix is not treated as a version", () => {
	const reg: ModelRegistryLite = {
		getAll: () => [{ provider: "x", id: "claude-opus-thinking" }],
	};
	// "claude-opus-thinking" doesn't start the version tail with a digit.
	assert.equal(resolveModelAlias("x/claude-opus", reg), "x/claude-opus");
});

test("missing model or registry is a no-op", () => {
	assert.equal(resolveModelAlias(undefined, makeRegistry()), undefined);
	assert.equal(resolveModelAlias("portkey/claude-opus", undefined), "portkey/claude-opus");
});

test("registry that throws does not block the spawn", () => {
	const reg: ModelRegistryLite = {
		getAll: () => {
			throw new Error("boom");
		},
	};
	assert.equal(resolveModelAlias("portkey/claude-opus", reg), "portkey/claude-opus");
});
