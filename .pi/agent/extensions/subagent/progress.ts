/**
 * Nested-subagent progress streaming — pure helpers.
 *
 * When a parent agent (e.g. `implement`) spawns its own subagents, the user's
 * top-level pi process never sees those grandchildren live: it only watches
 * the parent's stdout, and the parent's `subagent` tool widget only renders
 * inside the parent process's own pi. The user is left staring at a static
 * `→ subagent {...}` toolcall summary for the entire grandchild run.
 *
 * Fix: piggyback on pi's existing `setStatus(key, text)` extension UI method.
 * It's already a fire-and-forget RPC channel from any pi process to its
 * parent, exactly the shape we need. Each running subagent's parent emits
 * `setStatus("subagent:<depth>:<runId>", JSON.stringify(snapshot))` whenever
 * the snapshot changes; on completion it sends `setStatus(key, undefined)` to
 * clear the entry. The receiving pi either renders (if it's the topmost user
 * pi) or forwards the call upward verbatim (if it's an intermediate hop).
 *
 * Channel choice rationale: `setStatus` is a real, documented pi RPC method
 * (see rpc.md). Reusing it avoids defining a new method that pi would
 * categorize as unknown and potentially handle inconsistently across
 * versions. The `subagent:` key prefix gates our interception so
 * unprefixed setStatus calls (e.g. from other extensions) keep their
 * existing drop-on-the-floor behaviour at the parent.
 */

import type { Message } from "@earendil-works/pi-ai";

export const SUBAGENT_PROGRESS_PREFIX = "subagent:";

/**
 * Bounded snapshot pushed upstream on every emitUpdate. Keep small — pi's
 * setStatus protocol has no documented size cap but the channel is meant
 * for short text. ~500 bytes typical. Anything that grows unboundedly
 * (messages, stderr) is left out.
 */
export interface NestedProgressSnapshot {
	/** Depth of the running child relative to top user pi (1 = direct child of user, 2 = grandchild, …). */
	depth: number;
	agentName: string;
	/** First 200 chars of the child's task brief, for display only. */
	taskPreview: string;
	/** Chain step (1-based) when in chain mode; omitted otherwise. */
	step?: number;
	/** -1 while running; pi-style exit code on completion. */
	exitCode: number;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens: number;
		turns: number;
	};
	model?: string;
	/** Most recent tool call the child issued, for "what's it doing right now". */
	lastToolCall?: { name: string; argsPreview?: string };
	stopReason?: string;
}

/**
 * Receiver-side entry stored in the parent's nestedProgress map. Adds
 * housekeeping fields the renderer wants (raw key for stable React-style
 * keying; updatedAt so a future "stale entry" sweep can drop ghosts).
 */
export interface NestedProgressEntry extends NestedProgressSnapshot {
	progressKey: string;
	updatedAt: number;
	/**
	 * Monotonic receive-order stamp, assigned the first time the parent sees a
	 * given progressKey and preserved across later updates. Used to render rows
	 * in call order (the order subagents were launched) rather than by name.
	 */
	seq?: number;
}

/**
 * Insert or update a nested-progress entry, stamping a monotonic `seq` on first
 * sighting and preserving it across later updates so a row keeps its launch-order
 * position. `allocateSeq` is the caller's monotonic source (a module-global
 * counter at the rendering pi). Extracted as a pure helper so the ordering
 * contract is unit-testable without the RPC machinery.
 */
export function upsertNestedProgress(
	map: Map<string, NestedProgressEntry>,
	key: string,
	snap: NestedProgressSnapshot,
	allocateSeq: () => number,
	now: number = Date.now(),
): void {
	const existingSeq = map.get(key)?.seq;
	map.set(key, {
		...snap,
		progressKey: key,
		updatedAt: now,
		seq: existingSeq ?? allocateSeq(),
	});
}

/**
 * Sort comparator for nested-progress rows: by `seq` (launch/call order), with
 * `progressKey` as a stable tiebreak for any legacy entry missing a `seq`.
 * Entries without a `seq` sort last. Depth is deliberately NOT a key here — it
 * only drives indentation in the renderer, so a grandchild still nests visually
 * under its parent.
 */
export function compareNestedProgress(a: NestedProgressEntry, b: NestedProgressEntry): number {
	const sa = a.seq ?? Number.MAX_SAFE_INTEGER;
	const sb = b.seq ?? Number.MAX_SAFE_INTEGER;
	return sa !== sb ? sa - sb : a.progressKey.localeCompare(b.progressKey);
}

export interface AgentUsageTotal {
	agentName: string;
	count: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

/**
 * Roll up per-agent-name token/cost totals from nested-progress entries.
 * Returns one row per distinct agent name, in first-appearance order of the
 * input (pass already-sorted entries to get call order). `contextTokens` and
 * `model` are intentionally excluded — context is point-in-time (not additive)
 * and model can differ between runs of the same agent.
 */
export function rollupNestedUsageByAgent(entries: NestedProgressEntry[]): AgentUsageTotal[] {
	const byName = new Map<string, AgentUsageTotal>();
	for (const e of entries) {
		let t = byName.get(e.agentName);
		if (!t) {
			t = {
				agentName: e.agentName,
				count: 0,
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				turns: 0,
			};
			byName.set(e.agentName, t);
		}
		t.count += 1;
		t.input += e.usage.input;
		t.output += e.usage.output;
		t.cacheRead += e.usage.cacheRead;
		t.cacheWrite += e.usage.cacheWrite;
		t.cost += e.usage.cost;
		t.turns += e.usage.turns ?? 0;
	}
	return Array.from(byName.values());
}

/**
 * Accumulates the cost of finished subagent runs for the session-cumulative
 * footer chip. Pure and free of UI side effects: index.ts owns the single
 * instance, the depth/ctx guards, and the actual `setStatus` call.
 *
 * Runs are deduped by `runKey` (the unique progressKey) because a terminal
 * snapshot can in principle be observed more than once. Keys accumulate for the
 * session lifetime (one short string per run); the session-scoped `reset()`
 * bounds that growth.
 */
export interface AgentTokenTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export class AgentCostTally {
	private totalUsd = 0;
	private tokens: AgentTokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	private readonly counted = new Set<string>();

	/**
	 * Record one run. Returns true if this call changed the tally (a newly
	 * counted terminal run), false if ignored: still running (`exitCode === -1`)
	 * or a duplicate `runKey`. Non-finite or negative values contribute 0 so a
	 * bad upstream value can never subtract from a total.
	 */
	record(
		runKey: string,
		usage: { cost: number; input: number; output: number; cacheRead: number; cacheWrite: number },
		exitCode: number,
	): boolean {
		if (exitCode === -1) return false;
		if (this.counted.has(runKey)) return false;
		this.counted.add(runKey);
		this.totalUsd += clampPositive(usage.cost);
		this.tokens.input += clampPositive(usage.input);
		this.tokens.output += clampPositive(usage.output);
		this.tokens.cacheRead += clampPositive(usage.cacheRead);
		this.tokens.cacheWrite += clampPositive(usage.cacheWrite);
		return true;
	}

	get total(): number {
		return this.totalUsd;
	}

	get runCount(): number {
		return this.counted.size;
	}

	get tokenTotals(): AgentTokenTotals {
		return { ...this.tokens };
	}

	reset(): void {
		this.totalUsd = 0;
		this.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		this.counted.clear();
	}
}

function clampPositive(n: number): number {
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Compact token formatting, identical to pi's footer formatTokens. */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Render the cumulative token breakdown in pi's footer style:
 * `↑.. ↓.. R.. W.. CH..%`. Each field is omitted when zero; CH (cache hit
 * rate = cacheRead / (input + cacheRead + cacheWrite)) shows only when there is
 * cache activity. Returns "" when no tokens were recorded (local/proxy models
 * report all-zero usage), so the caller can drop the section entirely.
 */
export function formatAgentTokenStats(t: AgentTokenTotals): string {
	const parts: string[] = [];
	if (t.input) parts.push(`↑${formatTokens(t.input)}`);
	if (t.output) parts.push(`↓${formatTokens(t.output)}`);
	if (t.cacheRead) parts.push(`R${formatTokens(t.cacheRead)}`);
	if (t.cacheWrite) parts.push(`W${formatTokens(t.cacheWrite)}`);
	const prompt = t.input + t.cacheRead + t.cacheWrite;
	if ((t.cacheRead > 0 || t.cacheWrite > 0) && prompt > 0) {
		parts.push(`CH${((t.cacheRead / prompt) * 100).toFixed(1)}%`);
	}
	return parts.join(" ");
}

/**
 * Footer-chip text for the cumulative subagent cost, or `undefined` when the
 * chip should be hidden. Hidden whenever the total rounds to $0.000 at display
 * precision — this covers both genuinely-zero totals (proxy/local models report
 * cost: 0) and tiny nonzero totals that would otherwise render a misleading
 * "agents: $0.000". When `tokens` is supplied and nonzero, a pi-footer-style
 * breakdown is appended: `agents: $.. (N runs | ↑.. ↓.. R.. W.. CH..%)`. The
 * caller applies color.
 */
export function formatAgentCostChip(
	totalUsd: number,
	runCount: number,
	tokens?: AgentTokenTotals,
): string | undefined {
	const display = totalUsd.toFixed(3);
	if (Number(display) <= 0) return undefined;
	const runs = runCount === 1 ? "1 run" : `${runCount} runs`;
	const tokenStats = tokens ? formatAgentTokenStats(tokens) : "";
	const detail = tokenStats ? `${runs} | ${tokenStats}` : runs;
	return `agents: $${display} (${detail})`;
}

const TASK_PREVIEW_LIMIT = 200;
const TOOL_ARGS_PREVIEW_LIMIT = 80;

export function makeProgressKey(depth: number, agentName: string, runId: string): string {
	// Depth + runId guarantee uniqueness across siblings (same agent name, different
	// runs) and across nesting levels (same runId can in principle collide between
	// a depth-1 and depth-2 generator, so we always include depth).
	return `${SUBAGENT_PROGRESS_PREFIX}${depth}:${sanitizeKeyPart(agentName)}:${runId}`;
}

function sanitizeKeyPart(s: string): string {
	// `:` is our separator — strip it so an agent named "foo:bar" can't break parsing.
	return s.replace(/[:\n\r]/g, "_");
}

export function isProgressKey(statusKey: unknown): statusKey is string {
	return typeof statusKey === "string" && statusKey.startsWith(SUBAGENT_PROGRESS_PREFIX);
}

/**
 * Build a snapshot from the in-flight SingleResult. Caller passes the
 * fields it has; we don't reach into a specific shape here so this stays
 * decoupled from index.ts's SingleResult type.
 */
export function buildSnapshot(args: {
	depth: number;
	agentName: string;
	task: string;
	step?: number;
	exitCode: number;
	usage: NestedProgressSnapshot["usage"];
	model?: string;
	stopReason?: string;
	lastToolCall?: { name: string; argsPreview?: string };
}): NestedProgressSnapshot {
	const snap: NestedProgressSnapshot = {
		depth: args.depth,
		agentName: args.agentName,
		taskPreview: truncatePreview(args.task, TASK_PREVIEW_LIMIT),
		exitCode: args.exitCode,
		usage: args.usage,
	};
	if (args.step !== undefined) snap.step = args.step;
	if (args.model) snap.model = args.model;
	if (args.stopReason) snap.stopReason = args.stopReason;
	if (args.lastToolCall) snap.lastToolCall = args.lastToolCall;
	return snap;
}

export function encodeSnapshot(snapshot: NestedProgressSnapshot): string {
	return JSON.stringify(snapshot);
}

/**
 * Strict-but-tolerant decode. Returns null on any parse failure so the
 * receiving end can skip the event silently — never throw on malformed
 * upstream data.
 */
export function decodeSnapshot(text: unknown): NestedProgressSnapshot | null {
	if (typeof text !== "string") return null;
	let parsed: any;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const usage = parsed.usage;
	if (!usage || typeof usage !== "object") return null;

	const depth = Number(parsed.depth);
	if (!Number.isFinite(depth) || depth < 1) return null;
	if (typeof parsed.agentName !== "string") return null;
	if (typeof parsed.exitCode !== "number") return null;

	const result: NestedProgressSnapshot = {
		depth,
		agentName: parsed.agentName,
		taskPreview: typeof parsed.taskPreview === "string" ? parsed.taskPreview : "",
		exitCode: parsed.exitCode,
		usage: {
			input: numOrZero(usage.input),
			output: numOrZero(usage.output),
			cacheRead: numOrZero(usage.cacheRead),
			cacheWrite: numOrZero(usage.cacheWrite),
			cost: numOrZero(usage.cost),
			contextTokens: numOrZero(usage.contextTokens),
			turns: numOrZero(usage.turns),
		},
	};
	if (typeof parsed.step === "number") result.step = parsed.step;
	if (typeof parsed.model === "string") result.model = parsed.model;
	if (typeof parsed.stopReason === "string") result.stopReason = parsed.stopReason;
	if (parsed.lastToolCall && typeof parsed.lastToolCall === "object") {
		const t = parsed.lastToolCall;
		if (typeof t.name === "string") {
			result.lastToolCall = {
				name: t.name,
				argsPreview: typeof t.argsPreview === "string" ? t.argsPreview : undefined,
			};
		}
	}
	return result;
}

function numOrZero(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function truncatePreview(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}

/**
 * Walk the messages backward, find the most recent tool call from an
 * assistant message, return name + a short preview of its args. Used so
 * the user's panel can show "[running lsp_diagnostics]" instead of just
 * a turn counter.
 */
export function lastToolCallFromMessages(messages: Message[]): { name: string; argsPreview?: string } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		for (let j = m.content.length - 1; j >= 0; j--) {
			const part: any = m.content[j];
			if (part?.type === "toolCall") {
				const argsStr = safeStringify(part.arguments);
				return {
					name: String(part.name ?? "?"),
					argsPreview: argsStr ? truncatePreview(argsStr, TOOL_ARGS_PREVIEW_LIMIT) : undefined,
				};
			}
		}
	}
	return undefined;
}

function safeStringify(v: unknown): string {
	if (v === undefined || v === null) return "";
	try {
		return JSON.stringify(v);
	} catch {
		return "";
	}
}

/**
 * Routing decision at the receiver. Topmost pi (depth 0) renders into its
 * own widget; everyone else forwards verbatim upstream so the chain
 * eventually reaches the topmost pi.
 *
 * Pulled out as a pure function so the test suite can pin the policy
 * without spawning real pi subprocesses.
 */
export type ProgressRoutingAction = "render" | "forward";

export function decideProgressRouting(receiverDepth: number): ProgressRoutingAction {
	return receiverDepth === 0 ? "render" : "forward";
}
