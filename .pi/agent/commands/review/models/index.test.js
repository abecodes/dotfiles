import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, pickReviewerModels, pickReviewerPanel, resolveModel, SYNTH_MODEL } from "./index.js";

const DEFAULT_AGENTS = ["architecture-reviewer", "implementation-reviewer", "maintainability-reviewer"];

test("resolveModel maps aliases to portkey ids; passes unknowns through", () => {
	assert.equal(resolveModel("opus"), "portkey/claude-opus-4-8");
	assert.equal(resolveModel("portkey/whatever"), "portkey/whatever");
});

test("author=sonnet -> opus / codex / gpt (no sonnet in the panel)", () => {
	const panel = pickReviewerModels("sonnet", DEFAULT_AGENTS);
	assert.deepEqual(
		panel.map((p) => p.alias),
		["opus", "codex", "gpt"],
	);
	assert.ok(!panel.some((p) => p.alias === "sonnet"));
	assert.equal(panel[0].model, MODEL.opus);
});

test("author=codex -> opus / sonnet / gpt (no codex in the panel)", () => {
	const panel = pickReviewerModels("codex", DEFAULT_AGENTS);
	assert.deepEqual(
		panel.map((p) => p.alias),
		["opus", "sonnet", "gpt"],
	);
	assert.ok(!panel.some((p) => p.alias === "codex"));
});

test("security slot (4 agents) wraps to reuse the strongest (opus)", () => {
	const panel = pickReviewerModels("sonnet", [...DEFAULT_AGENTS, "security-reviewer"]);
	assert.deepEqual(
		panel.map((p) => p.alias),
		["opus", "codex", "gpt", "opus"],
	);
});

test("author not in the pool keeps the full diverse panel", () => {
	const panel = pickReviewerModels("haiku", DEFAULT_AGENTS);
	assert.deepEqual(
		panel.map((p) => p.alias),
		["opus", "codex", "sonnet"],
	);
});

test("panel entries align to the agent order", () => {
	const panel = pickReviewerModels("sonnet", DEFAULT_AGENTS);
	assert.deepEqual(
		panel.map((p) => p.agent),
		DEFAULT_AGENTS,
	);
});

test("dual panel runs implementation on sonnet and codex", () => {
	const panel = pickReviewerPanel("sonnet", DEFAULT_AGENTS, { dual: true });
	assert.deepEqual(
		panel.map((p) => [p.agent, p.alias, p.outputName]),
		[
			["architecture-reviewer", "opus", "architecture-reviewer"],
			["implementation-reviewer", "sonnet", "implementation-reviewer-sonnet"],
			["implementation-reviewer", "codex", "implementation-reviewer-codex"],
			["maintainability-reviewer", "gpt", "maintainability-reviewer"],
		],
	);
	assert.equal(panel[1].model, MODEL.sonnet);
	assert.equal(panel[2].model, MODEL.codex);
});

test("non-dual panel adds stable output names without changing models", () => {
	const panel = pickReviewerPanel("codex", DEFAULT_AGENTS);
	assert.deepEqual(
		panel.map((p) => [p.agent, p.alias, p.outputName]),
		[
			["architecture-reviewer", "opus", "architecture-reviewer"],
			["implementation-reviewer", "sonnet", "implementation-reviewer"],
			["maintainability-reviewer", "gpt", "maintainability-reviewer"],
		],
	);
});

test("synth model stays cheap (sonnet)", () => {
	assert.equal(SYNTH_MODEL, MODEL.sonnet);
});
