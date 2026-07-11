/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.js";
import {
	SUBAGENT_DEPTH_ENV_VAR,
	SUBAGENT_MAX_DEPTH_ENV_VAR,
	SUBAGENT_NAME_ENV_VAR,
	buildPermissionOverrideEnv,
	buildSpawnArgs,
	checkDepthOk,
	getCurrentDepth,
	hasToolEntries,
	isAllowListActive,
} from "./depth.ts";
import {
	isolate,
	integrate,
	readSandboxEnv,
	remapCwd,
	type ActiveSandbox,
	type IntegrationResult,
} from "./sandbox.ts";
import {
	type AgentResult,
	appendBoundedStderr,
	parseToolEntries,
	resolveModelAlias,
	stripCarriageReturn,
	type ThinkingLevel,
	toAgentResult,
	truncatePreviousOutput,
} from "./helpers.ts";
import { Dialog, type DialogParams, type DialogResult } from "./dialog.js";
import {
	AgentCostTally,
	buildSnapshot,
	compareNestedProgress,
	decideProgressRouting,
	decodeSnapshot,
	encodeSnapshot,
	formatAgentCostChip,
	isProgressKey,
	lastToolCallFromMessages,
	makeProgressKey,
	rollupNestedUsageByAgent,
	upsertNestedProgress,
	type NestedProgressEntry,
} from "./progress.ts";
import { randomUUID } from "node:crypto";

/**
 * UI methods emitted by the child via extension_ui_request that do NOT
 * require a response. The pump handles them in `handleExtensionUIRequest`
 * with one of three behaviours: forward to the parent UI, capture into
 * per-child state for later use, or drop silently.
 *
 * We forward only `notify` because it's a low-noise one-shot message and
 * useful surfacing (e.g. "allow-list: rule loaded"). `setWidget` is
 * captured so its content can be embedded inside the next dialog as
 * context (typically the bash command being approved). All other UI
 * state mutations — setStatus, setTitle, set_editor_text, working/header/
 * footer state — are dropped: forwarding them confuses the parent UI
 * (mixes child-internal state into the user's terminal chrome) and
 * provides no value when the child is headless.
 *
 * Methods not in this set are assumed to be dialog methods (select /
 * confirm / input) and are enqueued for serialized handling.
 */
const FIRE_AND_FORGET_UI_METHODS = new Set([
	"notify",
	"setStatus",
	"setWidget",
	"setTitle",
	"set_editor_text",
	// The methods below are no-ops in RPC mode per pi rpc.md, but we list
	// them here so they never fall through to the dialog branch and block
	// the child waiting for a response.
	"setWorkingVisible",
	"setWorkingIndicator",
	"setHeader",
	"setFooter",
	"setEditorComponent",
	"setToolsExpanded",
	"setWorkingMessage",
]);

const MAX_PARALLEL_TASKS = 8;
const MAX_CHAIN_STEPS = 16;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

// Monotonic counter stamped onto each nested-progress entry the first time a
// given progressKey is observed. Module-global so ordering is consistent across
// the per-step / per-task maps that the chain and parallel accumulators merge.
let nestedProgressSeqCounter = 0;
function nextNestedProgressSeq(): number {
	return nestedProgressSeqCounter++;
}

// ─── Cumulative subagent cost (footer chip) ─────────────────────────────────
// The topmost user pi (depth 0) tallies the cost of every subagent run at
// every nesting depth and surfaces the running total as a footer status chip
// ("agents: $x.xxx (N runs | ↑.. ↓.. R.. W.. CH..%)"), shown alongside pi's own
// cost line. Two channels
// feed it, both terminating at depth 0:
//   • direct children (depth 1) — recorded from their terminal SingleResult in
//     runSingleAgent (that pi does not push its own progress upstream).
//   • deeper descendants — arrive as terminal progress snapshots forwarded
//     upstream and captured in handleExtensionUIRequest's "render" branch.
// Each pi reports only its own LLM cost, so summing every run yields the true
// cumulative total with no double counting.
//
// The dedup/sum/format logic is the pure, unit-tested AgentCostTally +
// formatAgentCostChip (progress.ts). This module owns the single session-scoped
// instance, the depth/ctx guards, and the setStatus side effect. The tally is
// reset on session_start so /new and /resume start from zero.
const agentCostTally = new AgentCostTally();

function refreshAgentCostChip(ctx: ExtensionContext): void {
	const text = formatAgentCostChip(
		agentCostTally.total,
		agentCostTally.runCount,
		agentCostTally.tokenTotals,
	);
	ctx.ui.setStatus("subagent-cost", text === undefined ? undefined : ctx.ui.theme.fg("dim", text));
}

/**
 * Tally one finished subagent run into the cumulative footer chip. No-op unless
 * we're the topmost user pi (depth 0) — deeper pis forward their progress
 * upstream and must not paint a chip into a footer that isn't the user's. The
 * tally itself ignores in-flight runs (exitCode === -1) and duplicate runKeys.
 */
function recordAgentRunCost(
	ctx: ExtensionContext | undefined,
	runKey: string,
	usage: { cost: number; input: number; output: number; cacheRead: number; cacheWrite: number },
	exitCode: number,
): void {
	if (getCurrentDepth() !== 0) return;
	if (!ctx?.ui?.setStatus) return;
	if (!agentCostTally.record(runKey, usage, exitCode)) return;
	refreshAgentCostChip(ctx);
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	/**
	 * Snapshot of grandchildren that ran during this child's lifetime,
	 * captured by the parent's `nestedProgress` map. Carried back on the
	 * SingleResult so the tool's final `execute()` return value (which pi
	 * persists — streaming partials are discarded on completion) can put
	 * it into `details.nestedProgress` and the post-run widget renders the
	 * receipts. Without this, the Subagents block visible during streaming
	 * disappears the moment the parent agent finishes.
	 */
	nestedProgress?: NestedProgressEntry[];
	/**
	 * Present when this run was sandboxed (frontmatter `sandbox: worktree`).
	 * Carries the integrate verdict back to the orchestrator so it can decide
	 * recovery; on a non-"landed" status the real tree is untouched.
	 */
	integration?: IntegrationResult;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	/**
	 * Snapshots of subagents currently running deeper in the chain (i.e.
	 * grandchildren of the parent that owns this widget). Populated by
	 * intercepted `setStatus` events with the `subagent:` key prefix; only
	 * the topmost user pi keeps these — intermediate hops forward upward.
	 * See progress.ts for the wire format.
	 */
	nestedProgress?: NestedProgressEntry[];
}

function getFinalOutput(messages: Message[]): string {
	// Concatenate ALL text parts of the last assistant message.
	// AssistantMessage.content can contain multiple TextContent items interleaved
	// with ThinkingContent / ToolCall (e.g. Anthropic extended thinking can emit
	// [thinking, text, thinking, text]). Returning only the first one truncates
	// the subagent's final output and, in chain mode, the {previous} substitution
	// passed to the next step. Mirrors pi's own AgentSession.getLastAssistantText.
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		let text = "";
		for (const part of msg.content) {
			if (part.type === "text") text += part.text;
		}
		return text;
	}
	return "";
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

// Safety net: if the parent process exits while a runSingleAgent finally
// block hasn't run (uncaught throw, signal beyond our SIGTERM/SIGKILL grace,
// host crash), the tmp prompt file would leak. We track every active tmp
// dir and remove them on process exit.
const activeTmpDirs = new Set<string>();
let tmpExitHandlerInstalled = false;
function installTmpExitHandler() {
	if (tmpExitHandlerInstalled) return;
	tmpExitHandlerInstalled = true;
	process.on("exit", () => {
		for (const dir of activeTmpDirs) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
		}
	});
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	installTmpExitHandler();
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	activeTmpDirs.add(tmpDir);
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

// ─── RPC pump helpers ───────────────────────────────────────────────────────

/**
 * Write an `extension_ui_response` to the child's stdin.
 * Silently no-ops if the process is already gone (EPIPE / killed).
 */
function writeRpcResponse(proc: ChildProcess, body: Record<string, unknown>): void {
	if (proc.killed || !proc.stdin || proc.stdin.destroyed) return;
	try {
		proc.stdin.write(JSON.stringify({ type: "extension_ui_response", ...body }) + "\n");
	} catch {
		// EPIPE or similar — child already gone, silently swallow
	}
}

/**
 * Show the forwarded dialog in the parent TUI and return the user's response.
 *
 * Cancellation paths (both resolve via dialog.cancel() which calls
 * done({ cancelled: true }) exactly once):
 *   - Child process exits before user responds
 *   - Parent agent abort signal fires
 *
 * No timeout: the user is the principal — the agent waits for them, not
 * the other way around. If the child legitimately needs a deadline, it
 * can include a `timeout` field in the extension_ui_request itself per
 * pi rpc.md (child-side auto-resolves), but we don't impose one from the
 * parent side.
 */
async function runForwardedDialog(
	ctx: ExtensionContext,
	event: any,
	agentName: string,
	task: string,
	proc: ChildProcess,
	signal: AbortSignal | undefined,
	childWidgets: Map<string, string[]>,
): Promise<{ value?: string; confirmed?: boolean; cancelled?: boolean }> {
	let dialog: Dialog | null = null;
	const onClose = () => dialog?.cancel();
	proc.once("close", onClose);
	signal?.addEventListener("abort", onClose, { once: true });
	try {
		// Note: RPC extension_ui_request payloads do not currently carry the
		// originating tool name or matched rule string. Both `toolCall` and
		// `matchedRule` are left undefined; the dialog header skips those lines
		// rather than echoing the title twice.
		//
		// What we DO have is whatever the child captured via setWidget calls
		// (e.g. the bash command being approved). Flatten all currently-set
		// child widgets into one stream of context lines for the dialog header.
		const extraLines: string[] = [];
		for (const lines of childWidgets.values()) {
			for (const ln of lines) extraLines.push(ln);
		}
		const params: DialogParams = {
			method: event.method as "select" | "confirm" | "input",
			agentName,
			taskPreview: task.length > 80 ? `${task.slice(0, 79)}\u2026` : task,
			toolCall: undefined,
			matchedRule: undefined,
			extraLines: extraLines.length > 0 ? extraLines : undefined,
			title: typeof event.title === "string" ? event.title : String(event.method),
			options: Array.isArray(event.options) ? (event.options as string[]) : undefined,
			message: typeof event.message === "string" ? event.message : undefined,
			placeholder: typeof event.placeholder === "string" ? event.placeholder : undefined,
		};
		const result = await ctx.ui.custom<DialogResult>((tui, theme, _kb, done) => {
			dialog = new Dialog({ tui, theme, params, done });
			return dialog;
		});
		// custom() returns undefined in RPC mode; treat as cancelled
		if (!result || "cancelled" in result) return { cancelled: true };
		if ("confirmed" in result) return { confirmed: result.confirmed };
		return { value: (result as { value: string }).value };
	} finally {
		proc.off("close", onClose);
		signal?.removeEventListener("abort", onClose);
	}
}

/**
 * Handle one `extension_ui_request` event arriving from a child running in
 * `--mode rpc`. Fire-and-forget methods are forwarded immediately; dialog
 * methods are serialized through `sharedUiQueue` so parallel children can't
 * stack concurrent prompts on top of each other.
 */
function handleExtensionUIRequest(
	ctx: ExtensionContext,
	event: any,
	agentName: string,
	task: string,
	proc: ChildProcess,
	sharedUiQueue: { lock: Promise<void> },
	signal: AbortSignal | undefined,
	childWidgets: Map<string, string[]>,
	nestedProgress: Map<string, NestedProgressEntry>,
	onProgressUpdate: () => void,
): void {
	const { id, method } = event as { id: string; method: string };

	// ── Subagent-progress channel ───────────────────────────────────────────
	// Children that themselves spawn subagents emit their grandchildren's
	// progress as `setStatus("subagent:…", JSON.stringify(snapshot))`. At the
	// topmost user pi we capture into the per-run progress map and re-render
	// the widget so the user sees nested running subagents live. At every
	// intermediate hop we forward the call upward verbatim — pi's setStatus
	// is the upstream RPC channel. See progress.ts for routing rationale.
	if (method === "setStatus" && isProgressKey(event.statusKey)) {
		const key = event.statusKey as string;
		const text = (event as { statusText?: unknown }).statusText;
		const action = decideProgressRouting(getCurrentDepth());
		try {
			if (action === "render") {
				if (text === undefined || text === null) {
					nestedProgress.delete(key);
				} else {
					const snap = decodeSnapshot(text);
					if (snap) {
						// Stamps a launch-order seq on first sighting, preserved on
						// later updates so the row keeps its position. See progress.ts.
						upsertNestedProgress(nestedProgress, key, snap, nextNestedProgressSeq);
						// Tally this descendant run into the cumulative footer chip
						// once it reports a terminal snapshot (exitCode !== -1).
						recordAgentRunCost(ctx, key, snap.usage, snap.exitCode);
					}
					// Malformed payload: skip silently. The next valid update
					// from the same key will overwrite. We never throw — a
					// broken upstream must not poison this hop.
				}
				onProgressUpdate();
			} else {
				// Intermediate hop: forward upstream so the topmost pi sees it.
				// Calling ctx.ui.setStatus on a child pi's ctx routes through
				// pi's own RPC layer to its parent (this same handler one
				// level up). The chain terminates at depth 0 where action ===
				// "render".
				ctx.ui.setStatus(key, typeof text === "string" ? text : undefined);
			}
		} catch {
			// Fire-and-forget: dropped events become missing rows in the
			// panel, never a crash.
		}
		return;
	}

	// ── Fire-and-forget: forward, capture, or drop ──────────────────────────
	if (FIRE_AND_FORGET_UI_METHODS.has(method)) {
		try {
			if (method === "notify") {
				// Forward: low-noise, useful surface for child notifications.
				ctx.ui.notify(
					typeof event.message === "string" ? event.message : "",
					(event.notifyType as "info" | "warning" | "error") ?? "info",
				);
			} else if (method === "setWidget") {
				// Capture: child widgets typically describe what's being asked
				// about (e.g. the bash command pending approval). Don't render
				// in the parent's chrome — instead include in the next dialog.
				const key = typeof event.widgetKey === "string" ? event.widgetKey : "";
				if (Array.isArray(event.widgetLines)) {
					childWidgets.set(key, (event.widgetLines as unknown[])
						.filter((l): l is string => typeof l === "string"));
				} else {
					childWidgets.delete(key);
				}
			}
			// Drop silently: setStatus (non-subagent keys), setTitle,
			// set_editor_text, setWorkingVisible, setWorkingIndicator,
			// setHeader, setFooter, setEditorComponent, setToolsExpanded,
			// setWorkingMessage.
			//
			// Forwarding child-internal UI state (status bars, terminal title,
			// editor contents) to the parent mixes the child's chrome into the
			// user's session chrome — confusing and visually broken. The parent
			// owns its own UI; the child is headless from the user's perspective.
			// (The subagent-progress branch above is the documented exception.)
		} catch {
			// Fire-and-forget: non-critical, swallow silently
		}
		return;
	}

	// ── Unknown method (e.g. future "editor"): cancel immediately ────────────
	if (!(["select", "confirm", "input"] as string[]).includes(method)) {
		writeRpcResponse(proc, { id, cancelled: true });
		return;
	}

	// ── Dialog methods: serialize via sharedUiQueue ───────────────────────────
	// Each enqueued op MUST write a response (or detect dead child) so the child
	// never hangs waiting indefinitely.
	sharedUiQueue.lock = sharedUiQueue.lock
		.then(async () => {
			// Child may have died while we were waiting in the queue
			if (proc.killed || signal?.aborted) {
				writeRpcResponse(proc, { id, cancelled: true });
				return;
			}
			try {
				(ctx.ui as any).setWorkingVisible?.(false);
			} catch { /* ignore */ }
			try {
				const resp = await runForwardedDialog(
					ctx, event, agentName, task, proc, signal, childWidgets,
				);
				writeRpcResponse(proc, { id, ...resp });
			} catch {
				writeRpcResponse(proc, { id, cancelled: true });
			} finally {
				try {
					(ctx.ui as any).setWorkingVisible?.(true);
				} catch { /* ignore */ }
			}
		})
		.catch((): void => {
			// Keep the queue alive even if something unexpected threw so
			// subsequent entries are not silently dropped.
		});
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	ctx: ExtensionContext | undefined,
	sharedUiQueue: { lock: Promise<void> },
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	// Expand a model alias (e.g. "portkey/claude-opus") to the latest concrete
	// version the registry actually offers ("portkey/claude-opus-4-8") before it
	// reaches the child via --model. Concrete ids and unknown values pass through
	// unchanged; absent a registry (headless) it's a no-op.
	const resolvedModel = resolveModelAlias(agent.model, ctx?.modelRegistry);
	const spawnAgent = resolvedModel === agent.model ? agent : { ...agent, model: resolvedModel };

	// Constrained-override contract: if the agent declared a `tools:` list,
	// the child runs with allow-list in constrained-override mode (the
	// agent's allow list is the positive surface; parent project + global
	// deny+ask rules are inherited as a backstop). That requires allow-list
	// to be loaded in the parent. If it isn't, the override would silently
	// no-op on the child side and the agent would inherit the parent's
	// permission.json wholesale instead of the constrained contract its
	// frontmatter promised — a regression both ways (looser than the agent
	// declared, and unpredictable). Fail closed.
	//
	// Agents with no `tools:` field at all are unaffected by this check.
	if (hasToolEntries(agent.toolEntries) && !isAllowListActive()) {
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			exitCode: 1,
			messages: [],
			stderr:
				`Agent "${agentName}" declares a tools list but the allow-list ` +
				`extension is not loaded in this process; the list cannot be enforced. ` +
				`Install the allow-list extension at ~/.pi/agent/extensions/allow-list/ ` +
				`(it sets PI_ALLOW_LIST_ACTIVE=1 during init), or remove the tools list ` +
				`from this agent.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			model: agent.model,
			step,
		};
	}

	// --- Worktree sandbox (spec ~/.pi/sandbox.md) ---------------------------
	// A sandboxed agent (frontmatter `sandbox: worktree`) is isolated in a
	// private git worktree before spawn and atomically integrated on exit.
	// Descendants of a sandboxed run are not independently sandboxed; they are
	// kept inside the worktree by the cwd remap below (driven by inherited
	// PI_SANDBOX_* env). Enforcement lives here, in the spawn path the LLM
	// cannot skip.
	const inheritedSandbox = readSandboxEnv(process.env);
	// Run dirs live in the OS temp dir, not the agent/home tree: successful runs
	// are deleted immediately and failed runs are resolved instantly (same
	// session), so we want the OS's free GC of stale dirs rather than unbounded
	// growth under ~/. Git-boundary work is durable regardless — the run branch +
	// BASE live in the user's real repo, not here.
	//
	// Platform note — this default is *correct* everywhere but only *efficient* on
	// macOS. If we ever want first-class Linux/Windows support, this is the line to
	// branch on:
	//   • macOS: os.tmpdir() = /var/folders/<user>/T — per-user, disk-backed APFS,
	//     same Data volume as the project, so the ignored-deps clone in sandbox.ts
	//     (`cp -c` clonefile) stays COW-cheap and nothing is RAM-backed. Ideal.
	//   • Linux: os.tmpdir() is usually /tmp, frequently tmpfs (RAM-backed). A large
	//     worktree + COW-cloned deps (node_modules…) would be materialized in RAM
	//     (OOM risk), and reflink can't cross filesystems (project on /home vs a
	//     /tmp worktree) so the clone degrades to a full copy. Fix: root run dirs on
	//     the SAME filesystem as the boundary AND on disk — e.g.
	//     $XDG_CACHE_HOME/pi-sandbox (~/.cache) or a dir beside the boundary — and
	//     wire pruneStaleRuns()/a TTL sweep back in (you forfeit /tmp's free GC).
	//   • Windows: os.tmpdir() = %TEMP% — disk-backed + per-user, so no RAM issue,
	//     but there's no `cp`/reflink, so copyTree() falls back to fs.cpSync (a
	//     full, non-COW copy: correct, just slower). Also watch the 260-char
	//     MAX_PATH limit for deep node_modules paths (enable long-path support or
	//     shorten the run-dir prefix).
	const sandboxRoot = path.join(os.tmpdir(), "pi-sandbox");
	let spawnCwd = cwd ?? defaultCwd;
	let sandboxEnv: Record<string, string> = {};
	let activeSandbox: ActiveSandbox | null = null;
	let wasAborted = false;

	if (agent.sandbox === "worktree") {
		// Mandatory cwd (spec §6.3): cwd === undefined means the caller omitted it
		// and we'd silently fall back to the harness dir. Refuse loudly.
		if (cwd === undefined) {
			return {
				agent: agentName,
				agentSource: agent.source,
				task,
				exitCode: 1,
				messages: [],
				stderr:
					`Agent "${agentName}" is sandboxed (sandbox: worktree) and requires an ` +
					`explicit cwd identifying the target project. None was provided — refusing ` +
					`to fall back to the session cwd (${defaultCwd}). Re-dispatch with cwd set ` +
					`to a path inside the project to work on.`,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
				model: agent.model,
				step,
			};
		}
		// Nesting (spec §7.5): if already inside a sandbox, remap into the parent
		// worktree first so we isolate off the current worktree, not past it.
		const isoCwd = inheritedSandbox ? remapCwd(cwd, inheritedSandbox) : cwd;
		const iso = await isolate({ cwd: isoCwd, sandboxRoot });
		if (!iso.ok) {
			return {
				agent: agentName,
				agentSource: agent.source,
				task,
				exitCode: 1,
				messages: [],
				stderr: `Sandbox isolate failed for "${agentName}": ${iso.error}`,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
				model: agent.model,
				step,
			};
		}
		activeSandbox = iso.sandbox;
		spawnCwd = iso.sandbox.worktreeCwd;
		sandboxEnv = iso.sandbox.env;
	} else if (inheritedSandbox) {
		// Descendant remap (spec §7.4): keep this child inside the worktree even
		// if the controller narrated the original project path. PI_SANDBOX_* is
		// already inherited via process.env so its descendants stay contained.
		spawnCwd = remapCwd(spawnCwd, inheritedSandbox);
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	// exitCode starts at -1 ("running") so partial updates don't look like
	// a successful exit before the child actually closes. Set to the real
	// exit code below, after the proc closes.
	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: resolvedModel,
		step,
	};

	// Per-call upstream progress channel. The receiver in our parent (or
	// further up the chain) keys the snapshot by `progressKey` to render
	// nested rows in the user's tool widget. We push on every emitUpdate
	// while the child runs, then clear with `undefined` in the finally.
	//
	// We only push upstream when getCurrentDepth() > 0 — at depth 0 there's
	// no parent pi above us; calling ctx.ui.setStatus there would land in
	// the user's own footer (pi's interactive mode renders extension status
	// entries there), which is not where this data belongs.
	const childDepth = getCurrentDepth() + 1;
	const progressKey = makeProgressKey(childDepth, agentName, randomUUID());
	const pushUpstream = getCurrentDepth() > 0 && Boolean(ctx?.ui?.setStatus);

	// Children running deeper than us emit their own subagent-progress
	// setStatus events. The pump catches them and either renders into this
	// map (when we are the topmost user pi) or forwards upstream verbatim.
	// See handleExtensionUIRequest — the routing decision is centralized
	// there via decideProgressRouting().
	const nestedProgress = new Map<string, NestedProgressEntry>();

	const emitUpdate = () => {
		if (onUpdate) {
			const details = makeDetails([currentResult]);
			if (nestedProgress.size > 0) {
				details.nestedProgress = Array.from(nestedProgress.values());
			}
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details,
			});
		}
		if (pushUpstream) {
			try {
				const snap = buildSnapshot({
					depth: childDepth,
					agentName,
					task,
					step,
					exitCode: currentResult.exitCode,
					usage: currentResult.usage,
					model: currentResult.model,
					stopReason: currentResult.stopReason,
					lastToolCall: lastToolCallFromMessages(currentResult.messages),
				});
				ctx!.ui.setStatus(progressKey, encodeSnapshot(snap));
			} catch {
				// Fire-and-forget upstream channel. A push failure (closed
				// stdin, dead parent) is not actionable from here — the child
				// continues running locally regardless.
			}
		}
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
		}

		// Mode selection: any time the parent has a UI we use RPC mode. RPC
		// mode gives us two upstream channels we cannot get in cheap JSON
		// mode — (a) inherited ask/deny permission prompts route back to the
		// parent TUI, and (b) nested grandchildren push their progress
		// snapshots upstream via setStatus (see emitUpdate above and
		// handleExtensionUIRequest). The cost over JSON mode is one stdin
		// pipe + a prompt handshake; both are negligible vs. the silence
		// during long subagent runs without these channels. With no parent
		// UI (headless pi -p at the top), there's nothing to push to so we
		// stay in JSON mode and skip the handshake.
		const useRpc = Boolean(ctx?.hasUI);
		const args = buildSpawnArgs(spawnAgent, task, tmpPromptPath, { mode: useRpc ? "rpc" : "json" });

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const permissionEnv = buildPermissionOverrideEnv(agent.toolEntries);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: spawnCwd,
				shell: false,
				stdio: [useRpc ? "pipe" : "ignore", "pipe", "pipe"],
				env: {
					...process.env,
					[SUBAGENT_DEPTH_ENV_VAR]: String(childDepth),
					[SUBAGENT_NAME_ENV_VAR]: agentName,
					...permissionEnv,
					...sandboxEnv,
				},
			});

			// In RPC mode the task is sent via stdin after spawn (--mode rpc does
			// not accept a positional task arg; see buildSpawnArgs in depth.ts).
			if (useRpc) {
				proc.stdin!.write(JSON.stringify({ type: "prompt", message: `Task: ${task}` }) + "\n");
			}

			// Per-child widget capture: child extensions (e.g. allow-list) call
			// setWidget to display context like the bash command being approved.
			// Instead of forwarding to the parent UI (which causes layout bleed),
			// we capture by widgetKey and replay the content inside the next
			// dialog. Keys clear when the child sends widgetLines: undefined.
			const childWidgets = new Map<string, string[]>();

			let buffer = "";

			const processLine = (line: string) => {
				const trimmed = stripCarriageReturn(line);
				if (!trimmed.trim()) return;
				let event: any;
				try {
					event = JSON.parse(trimmed);
				} catch {
					return;
				}

				// RPC mode: route extension_ui_request events back to the parent TUI.
				// This is the core of Phase 3 — allows inherited ask rules running in
				// the child to prompt the user through the parent's screen.
				if (useRpc && event.type === "extension_ui_request") {
					if (!ctx) {
						// Defensive: useRpc is gated on ctx?.hasUI, so this shouldn't
						// happen. Respond cancelled so the child doesn't hang.
						writeRpcResponse(proc, { id: event.id, cancelled: true });
						return;
					}
					handleExtensionUIRequest(
						ctx, event, agentName, task, proc, sharedUiQueue, signal, childWidgets,
						nestedProgress, emitUpdate,
					);
					return;
				}

				// RPC mode: pi stays alive after handling a prompt, waiting for more
				// commands on stdin. There's no "exit" command in the protocol — the
				// convention is to close stdin (EOF) and the child shuts down. Wait
				// for agent_end (signals the agent fully completed its work) before
				// closing, so any in-flight extension_ui_response writes still land.
				if (useRpc && event.type === "agent_end") {
					try {
						proc.stdin?.end();
					} catch {
						/* already closed — ignore */
					}
				}

				// pi emits AgentEvent (agent_*, turn_*, message_*, tool_execution_*)
				// plus session-level events. We only need message_end: it carries the
				// fully-formed assistant message, including its tool calls and final
				// text. Tool-result messages would arrive inside turn_end.toolResults
				// if we needed them, but getFinalOutput / getDisplayItems read from
				// assistant messages only — so capturing them would be dead state.
				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}
			};

			// stdio is fixed to [_, "pipe", "pipe"] above, so stdout/stderr are always
			// present at runtime; the optional chaining only satisfies the
			// Readable | null type (the stream can be null for other stdio modes).
			proc.stdout?.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr?.on("data", (data) => {
				currentResult.stderr = appendBoundedStderr(currentResult.stderr, data.toString());
			});

			// Track teardown state so we can release the AbortSignal listener on
			// normal completion (otherwise each subagent invocation leaks one
			// listener for the lifetime of the parent's signal) and clear the
			// SIGKILL fallback timer once the proc actually exits.
			let killTimer: ReturnType<typeof setTimeout> | null = null;
			let abortListener: (() => void) | null = null;
			const cleanup = () => {
				if (killTimer) {
					clearTimeout(killTimer);
					killTimer = null;
				}
				if (signal && abortListener) {
					signal.removeEventListener("abort", abortListener);
					abortListener = null;
				}
			};

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				cleanup();
				resolve(code ?? 0);
			});

			proc.on("error", (err) => {
				currentResult.stderr += `spawn error: ${err.message}\n`;
				cleanup();
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					killTimer = setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
						killTimer = null;
					}, 5000);
				};
				if (signal.aborted) {
					killProc();
				} else {
					abortListener = killProc;
					signal.addEventListener("abort", killProc, { once: true });
				}
			}
		});

		currentResult.exitCode = exitCode;
		// Final emit so the parent widget reflects the terminal exit code
		// (✓ / ✗ icon, frozen usage totals). We deliberately do NOT clear
		// the upstream entry afterwards — the user wants to see the receipt
		// for completed grandchildren in the parent's final widget, not just
		// while they're running. The terminal snapshot persists in the
		// receiving pi's nestedProgress map until the parent's runSingleAgent
		// itself returns and the map goes out of scope.
		emitUpdate();
		// Tally this direct child's own cost into the cumulative footer chip.
		// At depth 0 this run isn't pushed upstream (pushUpstream === false), so
		// recordAgentRunCost is the only place its cost is observed. Its own
		// descendants are tallied separately via handleExtensionUIRequest.
		recordAgentRunCost(ctx, progressKey, currentResult.usage, currentResult.exitCode);
		// Snapshot the nested map onto the result so the tool's final
		// execute() return can attach it to details.nestedProgress. pi
		// persists the explicit return value and discards streaming partials
		// on completion — without this snapshot the post-completion widget
		// has no nested data to render even though we kept it during the run.
		if (nestedProgress.size > 0) {
			currentResult.nestedProgress = Array.from(nestedProgress.values());
		}
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		// Atomic integrate (spec §8). Runs only when isolate created a worktree
		// (the guards above return before that). Always runs — success, child
		// failure, or abort — so the worktree never leaks; on conflict/error the
		// real tree is untouched and the verdict is surfaced on the result.
		if (activeSandbox) {
			try {
				const result = await integrate(activeSandbox, { sandboxRoot, aborted: wasAborted });
				currentResult.integration = result;
				if (result.status !== "landed") {
					if (currentResult.exitCode === 0) currentResult.exitCode = 1;
					currentResult.stderr = appendBoundedStderr(
						currentResult.stderr,
						`\n[sandbox] integration ${result.status}: ${result.reason ?? ""}\n`,
					);
				}
			} catch (err) {
				currentResult.integration = {
					status: "error",
					target: activeSandbox.boundary,
					files: [],
					worktree: activeSandbox.runDir,
					branch: activeSandbox.runBranch,
					reason: err instanceof Error ? err.message : String(err),
				};
			}
		}
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir) {
			activeTmpDirs.delete(tmpPromptDir);
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Public spawn wrapper.
//
// `spawnSubagent` is the one supported entry point for code outside this
// extension (notably the command-runner's `c.agent`) to spawn a subagent. It
// wraps the internal `runSingleAgent` without changing its signature: it
// resolves the named agent, applies per-spawn overrides, runs it with the same
// `ctx` (so RPC permission forwarding + nested progress work identically to the
// `subagent` tool), and maps the internal `SingleResult` onto the public
// `AgentResult` contract from command-runner/c-api.ts. The subagent tool's own
// code path is unchanged — it keeps calling `runSingleAgent` directly.
// ---------------------------------------------------------------------------

/**
 * Live view of an in-flight `spawnSubagent` run, surfaced to optional
 * `onUpdate` callers (e.g. the command-runner's progress widget). Distinct
 * from the internal `AgentToolResult` the subagent tool's own onUpdate
 * consumes — this is a flat, public-facing snapshot.
 */
export interface AgentLiveSnapshot {
	agent: string;
	task: string;
	/** -1 while running; the real exit code once the child closes. */
	exitCode: number;
	/** Partial assistant text emitted so far. */
	text: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
}

export interface SpawnSubagentOptions {
	/** Agent name from the roster. */
	agent: string;
	task: string;
	/** Working dir for the spawned pi. Default: ctx.cwd. */
	cwd?: string;
	/** Per-spawn model override (alias or literal provider/id). */
	model?: string;
	/** Per-spawn reasoning-effort override. */
	thinking?: ThinkingLevel;
	/** Per-spawn tool allowlist override (same grammar as agent frontmatter). */
	tools?: string[];
	/** Which agent directories to discover. Default: "user". */
	agentScope?: AgentScope;
	/**
	 * Wall-clock cap (ms). On expiry the child is killed and the result is
	 * `ok:false, error:"timeout"`. Honors the c-api `AgentRequest.timeoutMs`
	 * contract. Omit (or <= 0) to run uncapped.
	 */
	timeoutMs?: number;
	/** Carries the TUI -> RPC permission dialog forwarding + model registry. */
	ctx: ExtensionContext;
	/** Optional progress callback, invoked on each streaming update. */
	onUpdate?: (snapshot: AgentLiveSnapshot) => void;
}

const emptyUsage = (): UsageStats => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
	turns: 0,
});

// All spawnSubagent calls share one UI queue so that forwarded permission
// dialogs from concurrent command spawns are serialized into the single TUI,
// exactly as the subagent tool serializes its parallel tasks.
const spawnSubagentUiQueue: { lock: Promise<void> } = { lock: Promise.resolve() };

export async function spawnSubagent(opts: SpawnSubagentOptions): Promise<AgentResult> {
	const defaultCwd = opts.ctx.cwd;
	const discoverCwd = opts.cwd ?? defaultCwd;
	const scope: AgentScope = opts.agentScope ?? "user";
	const discovery = discoverAgents(discoverCwd, scope);

	let agents = discovery.agents;
	const base = agents.find((a) => a.name === opts.agent);
	if (!base) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			ok: false,
			text: "",
			error: `unknown agent: "${opts.agent}". Available agents: ${available}.`,
			agent: opts.agent,
			usage: emptyUsage(),
		};
	}

	// Apply per-spawn overrides (model / thinking / tools) by replacing the
	// resolved agent in the roster with a cloned config. runSingleAgent reads
	// the agent out of the array by name, so this honors the override while
	// keeping its signature intact — and the allow-list presence guard inside
	// runSingleAgent fires on the cloned `toolEntries` exactly as it would on
	// frontmatter ones, so an opts.tools override is gated identically.
	if (opts.model !== undefined || opts.thinking !== undefined || opts.tools !== undefined) {
		const clone: AgentConfig = { ...base };
		if (opts.model !== undefined) clone.model = opts.model;
		if (opts.thinking !== undefined) clone.thinkingLevel = opts.thinking;
		if (opts.tools !== undefined) {
			clone.tools = opts.tools;
			clone.toolEntries = parseToolEntries(opts.tools);
		}
		agents = agents.map((a) => (a.name === opts.agent ? clone : a));
	}

	// Honor the c-api AgentRequest.timeoutMs contract: arm an AbortController
	// that fires after the cap. runSingleAgent kills the child on abort and
	// throws; we catch below and report ok:false. The `timedOut` flag lets us
	// distinguish a timeout from any other abort/throw for the error message.
	let timedOut = false;
	let controller: AbortController | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
		controller = new AbortController();
		timer = setTimeout(() => {
			timedOut = true;
			controller?.abort();
		}, opts.timeoutMs);
	}

	const onUpdate: OnUpdateCallback | undefined = opts.onUpdate
		? (partial) => {
				const single = partial.details?.results?.[0];
				const part = partial.content?.[0];
				opts.onUpdate?.({
					agent: single?.agent ?? opts.agent,
					task: opts.task,
					exitCode: single?.exitCode ?? -1,
					text: part?.type === "text" ? part.text : "",
					usage: single?.usage ?? emptyUsage(),
					model: single?.model,
					stopReason: single?.stopReason,
				});
			}
		: undefined;

	const makeDetails = (results: SingleResult[]): SubagentDetails => ({
		mode: "single",
		agentScope: scope,
		projectAgentsDir: discovery.projectAgentsDir,
		results,
	});

	try {
		const single = await runSingleAgent(
			defaultCwd,
			agents,
			opts.agent,
			opts.task,
			opts.cwd,
			undefined,
			controller?.signal,
			onUpdate,
			makeDetails,
			opts.ctx,
			spawnSubagentUiQueue,
		);
		return toAgentResult({
			exitCode: single.exitCode,
			stopReason: single.stopReason,
			text: getFinalOutput(single.messages),
			agent: single.agent,
			model: single.model,
			errorMessage: single.errorMessage,
			stderr: single.stderr,
			usage: single.usage,
		});
	} catch (err) {
		// runSingleAgent throws on abort (including our timeout). Surface it as
		// ok:false so a command's `c.agent` always resolves rather than rejecting.
		return {
			ok: false,
			text: "",
			error: timedOut ? "timeout" : err instanceof Error ? err.message : String(err),
			agent: opts.agent,
			model: opts.model ?? base.model,
			usage: emptyUsage(),
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentListParams = Type.Object({
	scope: Type.Optional(AgentScopeSchema),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

export default function (pi: ExtensionAPI) {
	// Pattern enforcement for `tools: bash(go test:*)` lives in the allow-list
	// extension. We push the agent's patterns to the child via
	// PI_SUBAGENT_PERMISSION_OVERRIDE; allow-list (running in the child)
	// merges them into its session-scope rule set on session_start, then its
	// existing tool_call gate enforces them with full per-leaf bash
	// decomposition (`;`, `&&`, `||`, `$(…)`, etc.).
	//
	// This extension does not register its own tool_call handler. The presence
	// check happens at spawn time below — see runSingleAgent's pre-flight in
	// the subagent tool's execute path.

	// Auto-inject available subagents into the parent session's system prompt.
	// Mechanical, no model judgment required — the agent map is just there.
	// Skipped in child subagent processes (depth > 0) so children aren't reminded
	// about siblings they can't (and shouldn't) spawn.
	// Reset the cumulative subagent-cost tally per session so /new and /resume
	// start from zero, and clear any stale footer chip. Only the topmost user pi
	// owns the chip; deeper pis never paint one, so this is a no-op there.
	pi.on("session_start", (_event: any, ctx: ExtensionContext) => {
		if (getCurrentDepth() !== 0) return;
		agentCostTally.reset();
		try {
			ctx?.ui?.setStatus?.("subagent-cost", undefined);
		} catch {
			/* ignore */
		}
	});

	pi.on("before_agent_start", async (event: any) => {
		// Defensive: any throw here breaks the parent agent's startup, not just
		// subagent functionality. A malformed agent file or a frontmatter parser
		// regression should degrade silently to "no auto-injection".
		try {
			return await injectSubagentDocBlock(event);
		} catch {
			return undefined;
		}
	});

	async function injectSubagentDocBlock(event: any) {
		if (getCurrentDepth() > 0) return undefined;
		const cwd: string = event?.systemPromptOptions?.cwd ?? process.cwd();
		const discovery = discoverAgents(cwd, "user");
		if (discovery.agents.length === 0) return undefined;
		const lines = discovery.agents.map((a) => `- **${a.name}**: ${a.description}`);
		const block = [
			"## Available subagents (auto-injected)",
			"",
			"Default to delegation for non-trivial work. Inline tools spend your context; subagents don't.",
			"Prefer `chain` mode whenever one agent's output feeds another's input — intermediate output never enters your window.",
			"",
			...lines,
			"",
			"Worked example (shape: \"find X + explain/use Y\"):",
			"```",
			'subagent({ chain: [',
			'  { agent: "<locator agent>", task: "locate callers of X" },',
			'  { agent: "<behavior agent>", task: "for each call site in {previous}, summarize behavior" },',
			']})',
			"```",
			"Use `subagent_list` to pick concrete agent names, or to refresh this list mid-session / include project-scope agents.",
		].join("\n");
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	}

	pi.registerTool({
		name: "subagent_list",
		label: "Subagent list",
		description: [
			"List available subagents and their one-line descriptions.",
			"Returns a JSON object: { <agent_name>: <description> }.",
			"Use this to discover whether work can be delegated before doing it inline.",
		].join(" "),
		parameters: SubagentListParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope: AgentScope = params.scope ?? "user";
			const discovery = discoverAgents(ctx.cwd, scope);
			const out: Record<string, string> = {};
			for (const a of discovery.agents) out[a.name] = a.description;
			return {
				content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
				details: undefined,
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.scope ?? "user";
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent_list")) + theme.fg("muted", ` [${scope}]`),
				0,
				0,
			);
		},

		renderResult(result, _opts, _theme, _context) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no agents)", 0, 0);
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context. Reach for this BEFORE inline grep/read on non-trivial work — it keeps file bodies out of your window.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder). Prefer chain whenever one agent's output is the next agent's input — intermediate output never enters your context.",
			'Example for "find X + explain Y": subagent({ chain: [{ agent: "<locator>", task: "locate X" }, { agent: "<analyzer>", task: "for each hit in {previous}, summarize behavior" }] }). Use subagent_list to pick concrete agent names.',
			'Default agent scope is "user" (from ~/.pi/agent/agents). To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
			"Payload sizing: each `task` ships as part of YOUR assistant message's tool-call JSON, so it counts against your `max_output_tokens`. If you're composing many parallel tasks or one long task, the provider can truncate the JSON mid-string and silently drop trailing array elements — you'll see N-1 tasks dispatched with the last one cut off. Rough guide: keep the combined `tasks` payload under ~15 KB. For longer briefs, write them to disk and pass a path in the `task` string (the subagent can read the file); keep the inline `task` to a one-line pointer plus essentials.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const depth = checkDepthOk();
			if (!depth.ok) {
				return {
					content: [
						{
							type: "text",
							text:
								`Subagent depth limit reached: current=${depth.current}, limit=${depth.limit}. ` +
								`A subagent tried to spawn another subagent. Increase the limit by setting ` +
								`${SUBAGENT_MAX_DEPTH_ENV_VAR} in the parent process if this is intentional.`,
						},
					],
					// Pre-discovery early return: makeDetails isn't built yet, so attach a
					// minimal details payload to satisfy the required AgentToolResult.details.
					details: { mode: "single", agentScope: params.agentScope ?? "user", projectAgentsDir: null, results: [] },
					isError: true,
				};
			}
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;
			// One shared queue serializes all forwarded permission dialogs within
			// this execute() call so parallel children can't stack concurrent prompts.
			const sharedUiQueue = { lock: Promise.resolve() as Promise<void> };

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const mode = hasChain ? "chain" : hasTasks ? "parallel" : "single";

					// Detect shadowing: a project agent with the same name as a
					// user-trusted agent. In scope="both" the project entry wins
					// (agents.ts merges with project precedence), so the user might
					// approve a familiar name without realising the repo overrides it.
					const userAgentNames = new Set(
						discoverAgents(ctx.cwd, "user").agents.map((a) => a.name),
					);
					const shadowed = projectAgentsRequested.filter((a) => userAgentNames.has(a.name)).map((a) => a.name);
					const shadowWarning =
						shadowed.length > 0
							? `\n\nWARNING: shadows your user agent(s): ${shadowed.join(", ")}. ` +
								`The project version will run instead of the trusted one.`
							: "";

					if (!ctx.hasUI) {
						// Fail-closed in headless mode: repo-controlled agents must not
						// silently auto-approve when there's no UI to gate them. The
						// caller can opt out explicitly with confirmProjectAgents: false.
						return {
							content: [
								{
									type: "text",
									text:
										`Refused: project-local agents (${names}) require interactive confirmation, ` +
										`but no UI is available. Source: ${dir}.${shadowWarning} ` +
										`Pass confirmProjectAgents: false to bypass (only do so in trusted repos).`,
								},
							],
							details: makeDetails(mode)([]),
							isError: true,
						};
					}

					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}${shadowWarning}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(mode)([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				if (params.chain.length > MAX_CHAIN_STEPS)
					return {
						content: [
							{
								type: "text",
								text: `Too many chain steps (${params.chain.length}). Max is ${MAX_CHAIN_STEPS}.`,
							},
						],
						details: makeDetails("chain")([]),
						isError: true,
					};
				const results: SingleResult[] = [];
				let previousOutput = "";

				// Chain-level accumulator for nested grandchildren snapshots.
				// Each step's runSingleAgent owns its own per-step nestedProgress
				// map; that map dies with the step. Without an accumulator here,
				// step N's grandchildren rows would vanish from the widget the
				// moment step N+1 emits its first chainUpdate (overwriting
				// details.nestedProgress with its own initially-empty value).
				// progressKey is uuid-suffixed so step boundaries don't collide.
				const chainNestedProgress = new Map<string, NestedProgressEntry>();

				const snapshotChainNestedProgress = (): NestedProgressEntry[] | undefined =>
					chainNestedProgress.size > 0 ? Array.from(chainNestedProgress.values()) : undefined;

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									const details = makeDetails("chain")(allResults);
									// Merge incoming step-level nested entries into the
									// chain accumulator. Never delete — entries from prior
									// steps must persist into later steps' widget renders so
									// the user keeps the receipt of every grandchild.
									if (partial.details?.nestedProgress) {
										for (const e of partial.details.nestedProgress) {
											chainNestedProgress.set(e.progressKey, e);
										}
									}
									const snap = snapshotChainNestedProgress();
									if (snap) details.nestedProgress = snap;
									onUpdate({
										content: partial.content,
										details,
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
						ctx,
						sharedUiQueue,
					);
					results.push(result);

					const isError =
						result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
					if (isError) {
						const errorMsg =
							result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
						const errDetails = makeDetails("chain")(results);
						const snap = snapshotChainNestedProgress();
						if (snap) errDetails.nestedProgress = snap;
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: errDetails,
							isError: true,
						};
					}
					previousOutput = truncatePreviousOutput(getFinalOutput(result.messages));
				}
				const finalDetails = makeDetails("chain")(results);
				const finalSnap = snapshotChainNestedProgress();
				if (finalSnap) finalDetails.nestedProgress = finalSnap;
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: finalDetails,
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);
				// Per-task nested-progress arrays kept aside so emitParallelUpdate
				// can flatten them into the widget without losing per-task identity.
				// Index-aligned with allResults; entries are the latest snapshot the
				// task's own runSingleAgent has reported.
				const allNestedProgress: NestedProgressEntry[][] = new Array(params.tasks.length).fill(null).map(() => []);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						const details = makeDetails("parallel")([...allResults]);
						const flattened = allNestedProgress.flat();
						if (flattened.length > 0) details.nestedProgress = flattened;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details,
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								allNestedProgress[index] = partial.details.nestedProgress ?? [];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
						ctx,
						sharedUiQueue,
					);
					allResults[index] = result;
					// Task is done. We deliberately keep the grandchildren rows
					// in `allNestedProgress[index]` so the final parallel widget
					// shows their terminal usage stats alongside the parent
					// task's own totals. They were already updated to terminal
					// state by the task's last emitUpdate before completion.
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const sections = results.map((r, i) => {
					const output = getFinalOutput(r.messages) || "(no output)";
					const status = r.exitCode === 0 ? "completed" : "failed";
					const header = `=== Task ${i + 1}/${results.length} — [${r.agent}] ${status} ===`;
					return `${header}\n${output}`;
				});
				// Final parallel return: flatten each task's terminal nested
				// progress entries (carried back on its SingleResult) so the
				// post-completion widget renders the receipts. Streaming
				// emitParallelUpdate() did this via allNestedProgress during
				// the run, but pi persists the explicit return value, not the
				// last streaming partial.
				const finalParallelDetails = makeDetails("parallel")(results);
				const flatNested = results.flatMap((r) => r.nestedProgress ?? []);
				if (flatNested.length > 0) finalParallelDetails.nestedProgress = flatNested;
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${sections.join("\n\n")}`,
						},
					],
					details: finalParallelDetails,
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
					ctx,
					sharedUiQueue,
				);
				// Build details once and propagate nestedProgress on both the
				// success and error returns. Streaming partials carried this
				// during the run; the final return is what pi persists so it
				// must carry it too or the Subagents block disappears.
				const finalSingleDetails = makeDetails("single")([result]);
				if (result.nestedProgress?.length) {
					finalSingleDetails.nestedProgress = result.nestedProgress;
				}
				const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					const errorMsg =
						result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: finalSingleDetails,
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: finalSingleDetails,
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			// Render nested grandchild progress (subagents-of-subagents currently
			// running deeper in the chain). Format: one row per entry, indented
			// by depth so the tree shape is visible. Entries with exitCode === -1
			// show a ⏳ spinner; finished ones rarely show here because the
			// emitter clears the entry on completion, but we render the terminal
			// state in case a clear race left a stale entry.
			const renderNestedProgressLines = (entries: NestedProgressEntry[]): string[] => {
				if (entries.length === 0) return [];
				// Call order: sort by the receive-order `seq` stamped when each
				// progressKey was first seen (see progress.ts:compareNestedProgress),
				// so rows appear in the order the subagents were launched rather than
				// alphabetically by name. Depth drives indentation only, not order.
				const sorted = [...entries].sort(compareNestedProgress);
				// Header is neutral — rows mix running (⏳) and completed (✓/✗)
				// entries; per-row icons carry the distinction.
				const lines: string[] = [theme.fg("muted", "Subagents:")];
				for (const e of sorted) {
					const indent = "  ".repeat(Math.max(0, e.depth - 1));
					const running = e.exitCode === -1;
					const icon = running
						? theme.fg("warning", "⏳")
						: e.exitCode === 0
							? theme.fg("success", "✓")
							: theme.fg("error", "✗");
					const nameSegment =
						theme.fg("accent", e.agentName) +
						(e.step !== undefined ? theme.fg("muted", ` (step ${e.step})`) : "");
					const toolSegment = e.lastToolCall
						? " " + theme.fg("muted", `[${e.lastToolCall.name}]`)
						: "";
					const usageSegment = (() => {
						const u = formatUsageStats(e.usage, e.model);
						return u ? "  " + theme.fg("dim", u) : "";
					})();
					lines.push(`${indent}${icon} ${nameSegment}${toolSegment}${usageSegment}`);
				}
				// Per-agent-name rollup, in first-appearance (call) order. Skipped for
				// a single row — it already shows its own usage, so a total would just
				// duplicate it. contextTokens/model are omitted (see rollup helper).
				if (sorted.length > 1) {
					const totals = rollupNestedUsageByAgent(sorted);
					lines.push(theme.fg("muted", "Totals by agent:"));
					for (const t of totals) {
						const usageStr = formatUsageStats({
							input: t.input,
							output: t.output,
							cacheRead: t.cacheRead,
							cacheWrite: t.cacheWrite,
							cost: t.cost,
							turns: t.turns,
						});
						const countSegment = t.count > 1 ? theme.fg("muted", ` ×${t.count}`) : "";
						const usageSegment = usageStr ? "  " + theme.fg("dim", usageStr) : "";
						lines.push(`  ${theme.fg("accent", t.agentName)}${countSegment}${usageSegment}`);
					}
				}
				return lines;
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isRunning = r.exitCode === -1;
				const isError = !isRunning && (r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted");
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: isError
						? theme.fg("error", "✗")
						: theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					const nestedLines = renderNestedProgressLines(details.nestedProgress ?? []);
					if (nestedLines.length > 0) {
						container.addChild(new Spacer(1));
						for (const line of nestedLines) container.addChild(new Text(line, 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				const nestedLines = renderNestedProgressLines(details.nestedProgress ?? []);
				if (nestedLines.length > 0) text += `\n${nestedLines.join("\n")}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const runningCount = details.results.filter((r) => r.exitCode === -1).length;
				const icon =
					runningCount > 0
						? theme.fg("warning", "⏳")
						: successCount === details.results.length
							? theme.fg("success", "✓")
							: theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon =
							r.exitCode === -1
								? theme.fg("warning", "⏳")
								: r.exitCode === 0
									? theme.fg("success", "✓")
									: theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					const nestedLines = renderNestedProgressLines(details.nestedProgress ?? []);
					if (nestedLines.length > 0) {
						container.addChild(new Spacer(1));
						for (const line of nestedLines) container.addChild(new Text(line, 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: r.exitCode === 0
								? theme.fg("success", "✓")
								: theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				const nestedLinesC = renderNestedProgressLines(details.nestedProgress ?? []);
				if (nestedLinesC.length > 0) text += `\n\n${nestedLinesC.join("\n")}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const failCount = details.results.filter((r) => r.exitCode > 0).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon =
							r.exitCode === -1
								? theme.fg("warning", "⏳")
								: r.exitCode === 0
									? theme.fg("success", "✓")
									: theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					const nestedLines = renderNestedProgressLines(details.nestedProgress ?? []);
					if (nestedLines.length > 0) {
						container.addChild(new Spacer(1));
						for (const line of nestedLines) container.addChild(new Text(line, 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: r.exitCode === 0
								? theme.fg("success", "✓")
								: theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				const nestedLinesP = renderNestedProgressLines(details.nestedProgress ?? []);
				if (nestedLinesP.length > 0) text += `\n\n${nestedLinesP.join("\n")}`;
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}
