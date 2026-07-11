import { test } from "node:test";
import assert from "node:assert/strict";
import {
	SUBAGENT_PROGRESS_PREFIX,
	buildSnapshot,
	compareNestedProgress,
	decideProgressRouting,
	decodeSnapshot,
	encodeSnapshot,
	isProgressKey,
	lastToolCallFromMessages,
	makeProgressKey,
	rollupNestedUsageByAgent,
	upsertNestedProgress,
	type NestedProgressEntry,
} from "../progress.ts";

function usage(over: Partial<NestedProgressEntry["usage"]> = {}): NestedProgressEntry["usage"] {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0, ...over };
}

function snap(agentName: string, over: Partial<NestedProgressEntry> = {}): any {
	return {
		depth: 2,
		agentName,
		taskPreview: "",
		exitCode: 0,
		usage: usage(),
		...over,
	};
}

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
	turns: 0,
};

// ---------------------------------------------------------------------------
// Key construction & detection
// ---------------------------------------------------------------------------

test("makeProgressKey: encodes depth + agent + runId", () => {
	const key = makeProgressKey(2, "coder", "run-abc");
	assert.ok(key.startsWith(SUBAGENT_PROGRESS_PREFIX));
	assert.equal(key, "subagent:2:coder:run-abc");
});

test("makeProgressKey: sanitizes colon and newline in agent name (key delimiter must stay unique)", () => {
	const key = makeProgressKey(1, "evil:name\nwith\rcrlf", "rid");
	assert.equal(key, "subagent:1:evil_name_with_crlf:rid");
});

test("isProgressKey: matches our prefix only", () => {
	assert.equal(isProgressKey("subagent:1:foo:bar"), true);
	assert.equal(isProgressKey("subagent:"), true);
	assert.equal(isProgressKey("not-subagent"), false);
	assert.equal(isProgressKey(""), false);
	assert.equal(isProgressKey(undefined), false);
	assert.equal(isProgressKey(42), false);
	assert.equal(isProgressKey({}), false);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("decideProgressRouting: depth 0 renders, deeper forwards", () => {
	assert.equal(decideProgressRouting(0), "render");
	assert.equal(decideProgressRouting(1), "forward");
	assert.equal(decideProgressRouting(7), "forward");
});

// ---------------------------------------------------------------------------
// Snapshot build / encode / decode
// ---------------------------------------------------------------------------

test("buildSnapshot: copies fields and truncates long task to <=200 chars", () => {
	const longTask = "x".repeat(500);
	const snap = buildSnapshot({
		depth: 2,
		agentName: "coder",
		task: longTask,
		exitCode: -1,
		usage: ZERO_USAGE,
	});
	assert.equal(snap.depth, 2);
	assert.equal(snap.agentName, "coder");
	assert.equal(snap.exitCode, -1);
	assert.ok(snap.taskPreview.length <= 200);
	assert.ok(snap.taskPreview.endsWith("…"));
});

test("buildSnapshot: optional fields included when present", () => {
	const snap = buildSnapshot({
		depth: 3,
		agentName: "gateway",
		task: "go gate",
		step: 2,
		exitCode: 0,
		usage: { ...ZERO_USAGE, turns: 4, cost: 0.012 },
		model: "portkey/claude-haiku-4-5",
		stopReason: "stop",
		lastToolCall: { name: "bash", argsPreview: '{"command":"go test"}' },
	});
	assert.equal(snap.step, 2);
	assert.equal(snap.model, "portkey/claude-haiku-4-5");
	assert.equal(snap.stopReason, "stop");
	assert.deepEqual(snap.lastToolCall, { name: "bash", argsPreview: '{"command":"go test"}' });
	assert.equal(snap.usage.turns, 4);
});

test("buildSnapshot: optional fields omitted when not provided", () => {
	const snap = buildSnapshot({
		depth: 1,
		agentName: "coder",
		task: "t",
		exitCode: -1,
		usage: ZERO_USAGE,
	});
	assert.equal(snap.step, undefined);
	assert.equal(snap.model, undefined);
	assert.equal(snap.lastToolCall, undefined);
});

test("encode/decode roundtrip: identical structure", () => {
	const snap = buildSnapshot({
		depth: 2,
		agentName: "coder",
		task: "fix mutual recursion",
		step: 1,
		exitCode: -1,
		usage: { ...ZERO_USAGE, turns: 3, cost: 0.012, input: 100, output: 50 },
		model: "portkey/claude-haiku-4-5",
		lastToolCall: { name: "lsp_diagnostics", argsPreview: '{"path":"a.go"}' },
	});
	const wire = encodeSnapshot(snap);
	const decoded = decodeSnapshot(wire);
	assert.deepEqual(decoded, snap);
});

test("decodeSnapshot: returns null on malformed JSON", () => {
	assert.equal(decodeSnapshot("not json"), null);
	assert.equal(decodeSnapshot("{"), null);
	assert.equal(decodeSnapshot(""), null);
	assert.equal(decodeSnapshot(undefined), null);
	assert.equal(decodeSnapshot(123), null);
});

test("decodeSnapshot: rejects payload missing required fields", () => {
	// Missing usage
	assert.equal(decodeSnapshot('{"depth":1,"agentName":"x","exitCode":0}'), null);
	// Missing depth
	assert.equal(decodeSnapshot('{"agentName":"x","exitCode":0,"usage":{}}'), null);
	// Negative depth
	assert.equal(decodeSnapshot('{"depth":-1,"agentName":"x","exitCode":0,"usage":{}}'), null);
	// Wrong type for agentName
	assert.equal(decodeSnapshot('{"depth":1,"agentName":42,"exitCode":0,"usage":{}}'), null);
	// Wrong type for exitCode
	assert.equal(decodeSnapshot('{"depth":1,"agentName":"x","exitCode":"oops","usage":{}}'), null);
});

test("decodeSnapshot: tolerates missing optional fields and zero-fills usage", () => {
	const minimal = '{"depth":1,"agentName":"coder","exitCode":-1,"usage":{}}';
	const decoded = decodeSnapshot(minimal);
	assert.ok(decoded);
	assert.equal(decoded.depth, 1);
	assert.equal(decoded.agentName, "coder");
	assert.deepEqual(decoded.usage, ZERO_USAGE);
	assert.equal(decoded.taskPreview, "");
});

test("decodeSnapshot: drops malformed lastToolCall instead of throwing", () => {
	const wire = '{"depth":1,"agentName":"c","exitCode":-1,"usage":{},"lastToolCall":{"name":42}}';
	const decoded = decodeSnapshot(wire);
	assert.ok(decoded);
	assert.equal(decoded.lastToolCall, undefined);
});

// ---------------------------------------------------------------------------
// lastToolCallFromMessages
// ---------------------------------------------------------------------------

test("lastToolCallFromMessages: returns most recent tool call across multiple assistant messages", () => {
	const messages: any[] = [
		{
			role: "assistant",
			content: [
				{ type: "text", text: "thinking" },
				{ type: "toolCall", name: "read", arguments: { path: "a.ts" } },
			],
		},
		{
			role: "toolResult",
			content: [{ type: "text", text: "..." }],
		},
		{
			role: "assistant",
			content: [
				{ type: "text", text: "..." },
				{ type: "toolCall", name: "lsp_diagnostics", arguments: { path: "b.ts" } },
			],
		},
	];
	const result = lastToolCallFromMessages(messages);
	assert.equal(result?.name, "lsp_diagnostics");
	assert.ok(result?.argsPreview?.includes("b.ts"));
});

test("lastToolCallFromMessages: undefined when no tool calls present", () => {
	const messages: any[] = [
		{ role: "assistant", content: [{ type: "text", text: "hello" }] },
	];
	assert.equal(lastToolCallFromMessages(messages), undefined);
});

test("lastToolCallFromMessages: undefined on empty messages", () => {
	assert.equal(lastToolCallFromMessages([]), undefined);
});

test("lastToolCallFromMessages: argsPreview is bounded", () => {
	const huge = { command: "x".repeat(500) };
	const messages: any[] = [
		{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: huge }] },
	];
	const result = lastToolCallFromMessages(messages);
	assert.ok(result);
	assert.ok(result.argsPreview);
	// 80-char preview limit (TOOL_ARGS_PREVIEW_LIMIT)
	assert.ok(result.argsPreview!.length <= 80);
});

// ---------------------------------------------------------------------------
// Call-order seq stamping + nested ordering + per-agent rollup
// ---------------------------------------------------------------------------

test("upsertNestedProgress: mints incrementing seq per new key, in call order", () => {
	const map = new Map<string, NestedProgressEntry>();
	let n = 0;
	const alloc = () => n++;
	upsertNestedProgress(map, "k:coder:1", snap("coder"), alloc);
	upsertNestedProgress(map, "k:gateway:1", snap("gateway"), alloc);
	upsertNestedProgress(map, "k:coder:2", snap("coder"), alloc);
	assert.equal(map.get("k:coder:1")!.seq, 0);
	assert.equal(map.get("k:gateway:1")!.seq, 1);
	assert.equal(map.get("k:coder:2")!.seq, 2);
});

test("upsertNestedProgress: preserves seq across updates (incl. seq 0)", () => {
	const map = new Map<string, NestedProgressEntry>();
	let n = 0;
	const alloc = () => n++;
	upsertNestedProgress(map, "k:coder:1", snap("coder", { exitCode: -1 }), alloc);
	assert.equal(map.get("k:coder:1")!.seq, 0);
	// Later update (e.g. completion) must keep seq 0 — not re-mint to a higher value.
	upsertNestedProgress(map, "k:coder:1", snap("coder", { exitCode: 0 }), alloc);
	assert.equal(map.get("k:coder:1")!.seq, 0);
	assert.equal(map.get("k:coder:1")!.exitCode, 0);
	// Allocator only advanced once (for the first sighting).
	assert.equal(n, 1);
});

test("compareNestedProgress: orders by seq, NOT alphabetically by name", () => {
	// Call order: coder, gateway, coder, gateway, test-gateway. A name sort would
	// group the coders first; the seq sort must preserve the interleaving.
	const map = new Map<string, NestedProgressEntry>();
	let n = 0;
	const alloc = () => n++;
	upsertNestedProgress(map, "k:coder:1", snap("coder"), alloc);
	upsertNestedProgress(map, "k:gateway:1", snap("gateway"), alloc);
	upsertNestedProgress(map, "k:coder:2", snap("coder"), alloc);
	upsertNestedProgress(map, "k:gateway:2", snap("gateway"), alloc);
	upsertNestedProgress(map, "k:test-gateway:1", snap("test-gateway"), alloc);

	const sorted = [...map.values()].sort(compareNestedProgress);
	assert.deepEqual(
		sorted.map((e) => e.agentName),
		["coder", "gateway", "coder", "gateway", "test-gateway"],
	);
});

test("compareNestedProgress: entries without seq sort last, progressKey tiebreak", () => {
	const a: any = { ...snap("a"), progressKey: "k:a", seq: 5 };
	const b: any = { ...snap("b"), progressKey: "k:zzz" }; // no seq
	const c: any = { ...snap("c"), progressKey: "k:aaa" }; // no seq
	const sorted = [b, a, c].sort(compareNestedProgress);
	// a (has seq) first; then the seq-less two by progressKey: k:aaa < k:zzz.
	assert.deepEqual(sorted.map((e) => e.progressKey), ["k:a", "k:aaa", "k:zzz"]);
});

test("rollupNestedUsageByAgent: sums per name in first-appearance order", () => {
	const entries: any[] = [
		{ ...snap("coder"), progressKey: "k:c1", seq: 0, usage: usage({ input: 6, output: 1000, cacheRead: 45000, cacheWrite: 23000, cost: 0.1141, contextTokens: 23000, turns: 4 }) },
		{ ...snap("gateway"), progressKey: "k:g1", seq: 1, usage: usage({ input: 29, output: 8700, cacheRead: 979000, cacheWrite: 56000, cost: 0.6336, contextTokens: 56000, turns: 27 }) },
		{ ...snap("coder"), progressKey: "k:c2", seq: 2, usage: usage({ input: 43, output: 22000, cacheRead: 2100000, cacheWrite: 67000, cost: 1.2010, contextTokens: 81000, turns: 41 }) },
	];
	const totals = rollupNestedUsageByAgent(entries);
	// First-appearance order: coder before gateway.
	assert.deepEqual(totals.map((t) => t.agentName), ["coder", "gateway"]);
	const coder = totals[0];
	assert.equal(coder.count, 2);
	assert.equal(coder.input, 49);
	assert.equal(coder.output, 23000);
	assert.equal(coder.cacheRead, 2145000);
	assert.equal(coder.turns, 45);
	assert.ok(Math.abs(coder.cost - 1.3151) < 1e-9);
	// contextTokens intentionally not summed (no such field on the total).
	assert.equal((coder as any).contextTokens, undefined);
});
