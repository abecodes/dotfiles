import { test } from "node:test";
import assert from "node:assert/strict";
import {
	ALLOW_LIST_ACTIVE_ENV_VAR,
	SUBAGENT_DEPTH_ENV_VAR,
	SUBAGENT_MAX_DEPTH_ENV_VAR,
	SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR,
	DEFAULT_MAX_SUBAGENT_DEPTH,
	buildPermissionOverrideEnv,
	buildSpawnArgs,
	checkDepthOk,
	getCurrentDepth,
	getMaxDepth,
	hasToolEntries,
	isAllowListActive,
	toolEntriesToRuleFile,
} from "../depth.ts";
import {
	MAX_CHAIN_PREVIOUS_OUTPUT_CHARS,
	MAX_STDERR_BYTES,
	appendBoundedStderr,
	normalizeTools,
	parseThinkingLevel,
	parseToolEntries,
	stripCarriageReturn,
	truncatePreviousOutput,
} from "../helpers.ts";

// ---------------------------------------------------------------------------
// Depth guard helpers
// ---------------------------------------------------------------------------

test("getCurrentDepth: unset env returns 0", () => {
	assert.equal(getCurrentDepth({}), 0);
});

test("getCurrentDepth: parses numeric env value", () => {
	assert.equal(getCurrentDepth({ [SUBAGENT_DEPTH_ENV_VAR]: "3" }), 3);
});

test("getCurrentDepth: garbage env value falls back to 0", () => {
	assert.equal(getCurrentDepth({ [SUBAGENT_DEPTH_ENV_VAR]: "not-a-number" }), 0);
	assert.equal(getCurrentDepth({ [SUBAGENT_DEPTH_ENV_VAR]: "-5" }), 0);
});

test("getMaxDepth: defaults when unset", () => {
	assert.equal(getMaxDepth({}), DEFAULT_MAX_SUBAGENT_DEPTH);
});

test("getMaxDepth: respects override", () => {
	assert.equal(getMaxDepth({ [SUBAGENT_MAX_DEPTH_ENV_VAR]: "5" }), 5);
});

test("checkDepthOk: at parent depth (0) is allowed", () => {
	const r = checkDepthOk({});
	assert.equal(r.ok, true);
	assert.equal(r.current, 0);
	assert.equal(r.limit, DEFAULT_MAX_SUBAGENT_DEPTH);
});

test("checkDepthOk: at limit is rejected", () => {
	const r = checkDepthOk({ [SUBAGENT_DEPTH_ENV_VAR]: String(DEFAULT_MAX_SUBAGENT_DEPTH) });
	assert.equal(r.ok, false);
});

test("checkDepthOk: above limit is rejected", () => {
	const r = checkDepthOk({ [SUBAGENT_DEPTH_ENV_VAR]: "10" });
	assert.equal(r.ok, false);
});

test("checkDepthOk: respects custom limit", () => {
	const env = {
		[SUBAGENT_DEPTH_ENV_VAR]: "3",
		[SUBAGENT_MAX_DEPTH_ENV_VAR]: "5",
	};
	const r = checkDepthOk(env);
	assert.equal(r.ok, true);
	assert.equal(r.current, 3);
	assert.equal(r.limit, 5);
});

// ---------------------------------------------------------------------------
// buildSpawnArgs: pure arg-shape verification
// ---------------------------------------------------------------------------

test("buildSpawnArgs: minimal agent emits the standard pi -p preamble", () => {
	const args = buildSpawnArgs({}, "find auth code", null);
	assert.deepEqual(args.slice(0, 4), ["--mode", "json", "-p", "--no-session"]);
	assert.equal(args[args.length - 1], "Task: find auth code");
	// no model, no tools, no system prompt
	assert.ok(!args.includes("--model"));
	assert.ok(!args.includes("--tools"));
	assert.ok(!args.includes("--append-system-prompt"));
});

test("buildSpawnArgs: includes --model when set", () => {
	const args = buildSpawnArgs({ model: "claude-haiku-4-5" }, "t", null);
	const i = args.indexOf("--model");
	assert.notEqual(i, -1);
	assert.equal(args[i + 1], "claude-haiku-4-5");
});

test("buildSpawnArgs: includes --thinking when set", () => {
	const args = buildSpawnArgs({ thinkingLevel: "xhigh" }, "t", null);
	const i = args.indexOf("--thinking");
	assert.notEqual(i, -1);
	assert.equal(args[i + 1], "xhigh");
});

test("buildSpawnArgs: omits --thinking when unset", () => {
	const args = buildSpawnArgs({}, "t", null);
	assert.ok(!args.includes("--thinking"));
});

test("buildSpawnArgs: --thinking and --model coexist", () => {
	const args = buildSpawnArgs(
		{ model: "claude-opus-4-7", thinkingLevel: "high" },
		"t",
		null,
	);
	assert.equal(args[args.indexOf("--model") + 1], "claude-opus-4-7");
	assert.equal(args[args.indexOf("--thinking") + 1], "high");
});

test("buildSpawnArgs: joins tools with comma", () => {
	const args = buildSpawnArgs({ tools: ["read", "grep", "find"] }, "t", null);
	const i = args.indexOf("--tools");
	assert.notEqual(i, -1);
	assert.equal(args[i + 1], "read,grep,find");
});

test("buildSpawnArgs: empty tools array is omitted", () => {
	const args = buildSpawnArgs({ tools: [] }, "t", null);
	assert.ok(!args.includes("--tools"));
});

test("buildSpawnArgs: appends --append-system-prompt with path when provided", () => {
	const args = buildSpawnArgs({}, "t", "/tmp/prompt-x.md");
	const i = args.indexOf("--append-system-prompt");
	assert.notEqual(i, -1);
	assert.equal(args[i + 1], "/tmp/prompt-x.md");
});

// ---------------------------------------------------------------------------
// buildSpawnArgs: mode option (Phase 1 — RPC mode)
// ---------------------------------------------------------------------------

test("buildSpawnArgs: mode=rpc emits --mode rpc --no-session (no -p)", () => {
	const args = buildSpawnArgs({}, "find auth code", null, { mode: "rpc" });
	assert.deepEqual(args.slice(0, 3), ["--mode", "rpc", "--no-session"]);
	assert.ok(!args.includes("-p"), "rpc mode must not include -p");
});

test("buildSpawnArgs: mode=rpc does NOT append positional task arg", () => {
	const task = "summarise the codebase";
	const args = buildSpawnArgs({}, task, null, { mode: "rpc" });
	assert.ok(
		!args.includes(`Task: ${task}`),
		"task must not appear as positional arg in rpc mode",
	);
});

test("buildSpawnArgs: mode=rpc still includes --model and --tools when set", () => {
	const args = buildSpawnArgs(
		{ model: "claude-haiku-4-5", tools: ["read", "grep"] },
		"t",
		null,
		{ mode: "rpc" },
	);
	assert.equal(args[args.indexOf("--model") + 1], "claude-haiku-4-5");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
	// Positional task must not be present
	assert.ok(!args.includes("Task: t"));
});

test("buildSpawnArgs: mode=rpc with tmpPromptPath includes --append-system-prompt", () => {
	const args = buildSpawnArgs({}, "t", "/tmp/p.md", { mode: "rpc" });
	const i = args.indexOf("--append-system-prompt");
	assert.notEqual(i, -1);
	assert.equal(args[i + 1], "/tmp/p.md");
	// Still no positional task
	assert.ok(!args.includes("Task: t"));
});

test("buildSpawnArgs: default opts (no opts arg) behaves like mode=json", () => {
	const withOpts = buildSpawnArgs({}, "t", null, {});
	const withoutOpts = buildSpawnArgs({}, "t", null);
	assert.deepEqual(withOpts, withoutOpts);
});

test("buildSpawnArgs: explicit mode=json is identical to omitting opts", () => {
	const withJson = buildSpawnArgs({ model: "m" }, "t", null, { mode: "json" });
	const withDefault = buildSpawnArgs({ model: "m" }, "t", null);
	assert.deepEqual(withJson, withDefault);
});

test("buildSpawnArgs: task is always the final positional argument", () => {
	const args = buildSpawnArgs(
		{ model: "m", tools: ["a", "b"] },
		"the task",
		"/tmp/p.md",
	);
	assert.equal(args[args.length - 1], "Task: the task");
});

// ---------------------------------------------------------------------------
// truncatePreviousOutput: chain-mode previous-output cap
// ---------------------------------------------------------------------------

test("truncatePreviousOutput: passes short input through unchanged", () => {
	assert.equal(truncatePreviousOutput("hello"), "hello");
});

test("truncatePreviousOutput: returns input unchanged at exactly the cap", () => {
	const boundary = "x".repeat(8);
	assert.equal(truncatePreviousOutput(boundary, 8), boundary);
});

test("truncatePreviousOutput: truncates and reports dropped char count", () => {
	const input = "x".repeat(20);
	const out = truncatePreviousOutput(input, 8);
	assert.ok(out.startsWith("x".repeat(8)));
	assert.ok(out.includes("truncated 12 chars"));
});

test("truncatePreviousOutput: default cap matches the exported constant", () => {
	const input = "x".repeat(MAX_CHAIN_PREVIOUS_OUTPUT_CHARS + 5);
	const out = truncatePreviousOutput(input);
	assert.ok(out.includes("truncated 5 chars"));
});

// ---------------------------------------------------------------------------
// appendBoundedStderr: stderr cap with truncation marker
// ---------------------------------------------------------------------------

test("appendBoundedStderr: under the cap, appends normally", () => {
	assert.equal(appendBoundedStderr("a", "b"), "ab");
});

test("appendBoundedStderr: at the cap, truncates and adds marker", () => {
	const out = appendBoundedStderr("", "x".repeat(20), 8);
	assert.ok(out.startsWith("x".repeat(8)));
	assert.ok(out.endsWith("stderr truncated …]\n"));
});

test("appendBoundedStderr: idempotent once the marker is present", () => {
	const capped = appendBoundedStderr("", "x".repeat(20), 8);
	const again = appendBoundedStderr(capped, "more chunks", 8);
	assert.equal(again, capped);
});

test("appendBoundedStderr: default cap matches the exported constant", () => {
	const out = appendBoundedStderr("", "x".repeat(MAX_STDERR_BYTES + 100));
	assert.ok(out.length <= MAX_STDERR_BYTES + 64);
	assert.ok(out.endsWith("stderr truncated …]\n"));
});

// ---------------------------------------------------------------------------
// stripCarriageReturn: CRLF tolerance for ndjson parsing
// ---------------------------------------------------------------------------

test("stripCarriageReturn: removes a trailing \\r", () => {
	assert.equal(stripCarriageReturn("hello\r"), "hello");
});

test("stripCarriageReturn: leaves clean lines untouched", () => {
	assert.equal(stripCarriageReturn("hello"), "hello");
	assert.equal(stripCarriageReturn(""), "");
});

// ---------------------------------------------------------------------------
// normalizeTools: frontmatter `tools` may be string OR array
// ---------------------------------------------------------------------------

test("normalizeTools: comma-separated string", () => {
	assert.deepEqual(normalizeTools("read, grep, find"), ["read", "grep", "find"]);
});

test("normalizeTools: YAML array form", () => {
	assert.deepEqual(normalizeTools(["read", "grep"]), ["read", "grep"]);
});

test("normalizeTools: mixed array entries are filtered", () => {
	assert.deepEqual(normalizeTools(["read", 123, null, "grep"]), ["read", "grep"]);
});

test("normalizeTools: undefined / unknown shapes return undefined", () => {
	assert.equal(normalizeTools(undefined), undefined);
	assert.equal(normalizeTools(42), undefined);
	assert.equal(normalizeTools({ read: true }), undefined);
});

test("normalizeTools: trims whitespace and drops empties", () => {
	assert.deepEqual(normalizeTools(" read , , grep "), ["read", "grep"]);
	assert.deepEqual(normalizeTools([" read ", "", "grep"]), ["read", "grep"]);
});

test("normalizeTools: scoped entries reduce to bare names", () => {
	assert.deepEqual(
		normalizeTools("read, bash(go test:*), ffgrep"),
		["read", "bash", "ffgrep"],
	);
});

// ---------------------------------------------------------------------------
// parseToolEntries: pattern-aware parsing
// ---------------------------------------------------------------------------

test("parseToolEntries: bare name has no patterns", () => {
	assert.deepEqual(parseToolEntries("read"), [{ name: "read" }]);
});

test("parseToolEntries: single pattern with :*", () => {
	assert.deepEqual(parseToolEntries("bash(go test:*)"), [
		{ name: "bash", patterns: ["go test"] },
	]);
});

test("parseToolEntries: pattern without :* still works", () => {
	assert.deepEqual(parseToolEntries("bash(go test)"), [
		{ name: "bash", patterns: ["go test"] },
	]);
});

test("parseToolEntries: multiple patterns inside one entry", () => {
	assert.deepEqual(
		parseToolEntries("bash(go test:*, ./scripts/run.sh:*)"),
		[{ name: "bash", patterns: ["go test", "./scripts/run.sh"] }],
	);
});

test("parseToolEntries: top-level commas split tools, not patterns", () => {
	assert.deepEqual(
		parseToolEntries("read, bash(go test:*, git diff:*), ffgrep"),
		[
			{ name: "read" },
			{ name: "bash", patterns: ["go test", "git diff"] },
			{ name: "ffgrep" },
		],
	);
});

test("parseToolEntries: YAML list form preserves per-entry patterns", () => {
	assert.deepEqual(
		parseToolEntries(["read", "bash(go test:*)", "bash(git diff:*)"]),
		[
			{ name: "read" },
			// merged: same tool name appears twice -> patterns concatenated
			{ name: "bash", patterns: ["go test", "git diff"] },
		],
	);
});

test("parseToolEntries: scoped + unscoped same tool -> unscoped wins", () => {
	assert.deepEqual(
		parseToolEntries(["bash(go test:*)", "bash"]),
		[{ name: "bash" }],
	);
	assert.deepEqual(
		parseToolEntries(["bash", "bash(go test:*)"]),
		[{ name: "bash" }],
	);
});

test("parseToolEntries: malformed entries are dropped", () => {
	assert.deepEqual(parseToolEntries("read, bash(unterminated"), [
		{ name: "read" },
	]);
	assert.deepEqual(parseToolEntries("123bad"), []);
});

test("parseToolEntries: undefined / unknown shapes", () => {
	assert.equal(parseToolEntries(undefined), undefined);
	assert.equal(parseToolEntries(42), undefined);
});

// ---------------------------------------------------------------------------
// parseThinkingLevel: frontmatter → ThinkingLevel coercion. We deliberately
// drop unknown values so a typo in `thinking:` falls back to the parent's
// default rather than crashing the child on `pi --thinking <garbage>`.
// ---------------------------------------------------------------------------

test("parseThinkingLevel: accepts every valid pi level", () => {
	for (const lvl of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
		assert.equal(parseThinkingLevel(lvl), lvl);
	}
});

test("parseThinkingLevel: case-insensitive and trims whitespace", () => {
	assert.equal(parseThinkingLevel("  XHigh "), "xhigh");
	assert.equal(parseThinkingLevel("HIGH"), "high");
});

test("parseThinkingLevel: unknown / non-string values yield undefined", () => {
	assert.equal(parseThinkingLevel("extreme"), undefined);
	assert.equal(parseThinkingLevel(""), undefined);
	assert.equal(parseThinkingLevel(undefined), undefined);
	assert.equal(parseThinkingLevel(null), undefined);
	assert.equal(parseThinkingLevel(7), undefined);
});

// ---------------------------------------------------------------------------
// toolEntriesToRuleFile / buildPermissionOverrideEnv: cross-extension protocol
// with allow-list. Subagent only owns the producing side; the consuming side
// (read-and-merge into session rules) lives in allow-list/index.ts and is
// covered by allow-list's own tests.
// ---------------------------------------------------------------------------

test("toolEntriesToRuleFile: empty inputs produce empty rule file", () => {
	assert.deepEqual(toolEntriesToRuleFile(undefined), { allow: [], ask: [], deny: [] });
	assert.deepEqual(toolEntriesToRuleFile([]), { allow: [], ask: [], deny: [] });
});

test("toolEntriesToRuleFile: bare entries become bare allow rules (constrained-override needs them)", () => {
	assert.deepEqual(
		toolEntriesToRuleFile([{ name: "read" }]),
		{ allow: ["Read"], ask: [], deny: [] },
	);
});

test("toolEntriesToRuleFile: emits canonical Tool(prefix:*) allow rules for scoped entries", () => {
	assert.deepEqual(
		toolEntriesToRuleFile([
			{ name: "bash", patterns: ["go test", "./scripts/gotest-distill.sh"] },
		]),
		{
			allow: ["Bash(go test:*)", "Bash(./scripts/gotest-distill.sh:*)"],
			ask: [],
			deny: [],
		},
	);
});

test("toolEntriesToRuleFile: bare and scoped together emit both rule shapes", () => {
	assert.deepEqual(
		toolEntriesToRuleFile([
			{ name: "read" },
			{ name: "bash", patterns: ["go test"] },
			{ name: "ffgrep" },
		]),
		{ allow: ["Read", "Bash(go test:*)", "ffgrep"], ask: [], deny: [] },
	);
});

test("toolEntriesToRuleFile: passes through patterns that already end in :*", () => {
	assert.deepEqual(
		toolEntriesToRuleFile([{ name: "bash", patterns: ["go test:*"] }]),
		{ allow: ["Bash(go test:*)"], ask: [], deny: [] },
	);
});

test("toolEntriesToRuleFile: unknown tool names pass through unchanged (no canonicalization, no `:*` auto-append)", () => {
	assert.deepEqual(
		toolEntriesToRuleFile([{ name: "my_custom", patterns: ["foo"] }]),
		{ allow: ["my_custom(foo)"], ask: [], deny: [] },
	);
});

test("toolEntriesToRuleFile: scoped subagent entries emit `:*`-free rules (key:value matching)", () => {
	assert.deepEqual(
		toolEntriesToRuleFile([
			{ name: "subagent", patterns: ["agent:coder", "agent:gateway"] },
		]),
		{
			allow: ["subagent(agent:coder)", "subagent(agent:gateway)"],
			ask: [],
			deny: [],
		},
	);
});

test("toolEntriesToRuleFile: bash patterns still get `:*` auto-appended (prefix-match marker)", () => {
	assert.deepEqual(
		toolEntriesToRuleFile([{ name: "bash", patterns: ["go test"] }]),
		{ allow: ["Bash(go test:*)"], ask: [], deny: [] },
	);
});

test("buildPermissionOverrideEnv: empty when no entries", () => {
	assert.deepEqual(buildPermissionOverrideEnv(undefined), {});
	assert.deepEqual(buildPermissionOverrideEnv([]), {});
});

test("buildPermissionOverrideEnv: serializes RuleFile into env var", () => {
	const env = buildPermissionOverrideEnv([
		{ name: "read" },
		{ name: "bash", patterns: ["go test", "./scripts/x"] },
	]);
	assert.equal(
		env[SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR],
		JSON.stringify({
			allow: ["Read", "Bash(go test:*)", "Bash(./scripts/x:*)"],
			ask: [],
			deny: [],
		}),
	);
});

// ---------------------------------------------------------------------------
// hasToolEntries / isAllowListActive: spawn-side guards
// ---------------------------------------------------------------------------

test("hasToolEntries: false when no entries", () => {
	assert.equal(hasToolEntries(undefined), false);
	assert.equal(hasToolEntries([]), false);
});

test("hasToolEntries: true for bare-only, scoped-only, or mixed lists", () => {
	assert.equal(hasToolEntries([{ name: "read" }]), true);
	assert.equal(hasToolEntries([{ name: "bash", patterns: ["go test"] }]), true);
	assert.equal(
		hasToolEntries([{ name: "read" }, { name: "bash", patterns: ["go test"] }]),
		true,
	);
});

test("isAllowListActive: tied to env var sentinel", () => {
	assert.equal(isAllowListActive({}), false);
	assert.equal(isAllowListActive({ [ALLOW_LIST_ACTIVE_ENV_VAR]: "" }), false);
	assert.equal(isAllowListActive({ [ALLOW_LIST_ACTIVE_ENV_VAR]: "0" }), false);
	assert.equal(isAllowListActive({ [ALLOW_LIST_ACTIVE_ENV_VAR]: "1" }), true);
});
