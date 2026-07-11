/**
 * command-runner — runs user-authored orchestration scripts as `/<name>`.
 *
 * Each command lives at ~/.pi/agent/commands/<name>/index.js (and, in a trusted
 * project, <cwd>/.pi/commands/<name>/index.js) and exports
 *   export default async (c, args) => string
 * The plan is deterministic code; the model is invoked only at the leaves via
 * the injected `c` handle (see c-api.ts). NO node:vm — scripts run unsandboxed
 * at the same trust level as any extension (see DESIGN.md "Trust model").
 *
 * v0 limitations (see README): command handlers don't reliably receive a usable
 * ctx.signal, so a long synchronous command may not be Esc-cancellable; and an
 * EDITED existing command isn't re-imported within the same process (Node's ESM
 * import cache is keyed by URL) — a freshly-added command dir is picked up after
 * the /reload the commandify skill queues.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
	keyHint,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Dialog } from "../ask-user-question/dialog.ts";
import { type QuestionParams, type QuestionnaireResult, validateQuestionnaire } from "../ask-user-question/tool.ts";
import { spawnSubagent } from "../subagent/index.ts";
import type { AgentRequest, AgentResult } from "./c-api.ts";
import { createCommandApi } from "./c.ts";
import { type DiscoveredCommand, discoverCommandDirs } from "./discover.ts";
import { runCommandModule } from "./load.ts";
import { finalizeReport } from "./report.ts";

// Matches the subagent tool's parallel cap: a command can't fan out more than
// this many concurrent child pis.
const MAX_CONCURRENCY = 4;
const WIDGET_KEY = "command-runner";
const WIDGET_TAIL = 12;
const RESULT_TYPE = "command-result";

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
const WIDGET_RUNNING_SHOWN = 6;

/** Per-c.agent record persisted in the result details and rendered on expand. */
interface AgentSummary {
	agent: string;
	ok: boolean;
	input: number;
	output: number;
	cost: number;
	durationMs: number;
}

/** Live, in-flight view of one c.agent call; collapses to an AgentSummary at the end. */
interface AgentActivity {
	id: number;
	agent: string;
	status: "running" | "ok" | "failed";
	input: number;
	output: number;
	cost: number;
	startedAt: number;
	durationMs: number;
}

function fmtTokens(input: number, output: number): string {
	const n = input + output;
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
}
function fmtCost(cost: number): string {
	if (!(cost > 0)) return "";
	return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}
function fmtDuration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function agentMeta(a: { input: number; output: number; cost: number; durationMs: number }): string {
	return [fmtTokens(a.input, a.output), fmtCost(a.cost), fmtDuration(a.durationMs)].filter(Boolean).join(" · ");
}
function fmtIo(shell: number, reads: number, writes: number): string {
	return [
		shell ? `${shell} shell` : "",
		reads ? `${reads} read${reads === 1 ? "" : "s"}` : "",
		writes ? `${writes} write${writes === 1 ? "" : "s"}` : "",
	]
		.filter(Boolean)
		.join(" · ");
}

// Cap how many c.log/c.phase lines persist into the result details so the
// session entry can't balloon on a chatty command; keep the most recent.
const STEP_PERSIST_CAP = 100;

export default function (pi: ExtensionAPI) {
	// Names already registered in this runtime, so the session_start +
	// resources_discover double-fire registers each command only once.
	const registered = new Set<string>();

	// A command's report is delivered as a custom message; without a renderer a
	// custom message type has no visible TUI rendering. Header shows /<name> with
	// a ✓/✗ from the run's error state; the body is the report (full text on
	// expand isn't needed since content already carries it).
	pi.registerMessageRenderer(RESULT_TYPE, (message, { expanded }, theme) => {
		const details = message.details as
			| { command?: string; isError?: boolean; agents?: AgentSummary[]; steps?: string[]; shell?: number; reads?: number; writes?: number }
			| undefined;
		const name = details?.command ?? "command";
		const icon = details?.isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
		const body =
			typeof message.content === "string"
				? message.content
				: message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
		let text = `${icon} ${theme.fg("toolTitle", theme.bold(`/${name}`))}\n${body}`;

		// Agent activity / steps / shell+read counts live in details, not in the
		// report content, so they persist without polluting what the command
		// returned. Shown on expand; a one-line summary hint when collapsed.
		const agents = details?.agents ?? [];
		const steps = details?.steps ?? [];
		const io = fmtIo(details?.shell ?? 0, details?.reads ?? 0, details?.writes ?? 0);
		if (agents.length > 0 || steps.length > 0 || io !== "") {
			if (expanded) {
				if (agents.length > 0) {
					text += `\n${theme.fg("muted", "Agents")}`;
					for (const a of agents) {
						const ai = a.ok ? theme.fg("success", "✓") : theme.fg("error", "✗");
						text += `\n  ${ai} ${a.agent}  ${theme.fg("dim", agentMeta(a))}`;
					}
				}
				if (steps.length > 0) {
					text += `\n${theme.fg("muted", "Steps")}`;
					for (const s of steps) text += `\n  ${theme.fg("dim", s)}`;
				}
				if (io !== "") text += `\n${theme.fg("muted", "Calls")}  ${theme.fg("dim", io)}`;
			} else {
				const bits: string[] = [];
				if (agents.length > 0) bits.push(`${agents.length} agent call${agents.length === 1 ? "" : "s"}`);
				if (steps.length > 0) bits.push(`${steps.length} step${steps.length === 1 ? "" : "s"}`);
				if (io !== "") bits.push(io);
				// keyHint renders the *configured* expand key (default ctrl+o), so the
				// hint stays correct if the user rebinds it.
				text += `\n  ${theme.fg("dim", `${bits.join(" · ")} ·`)} ${keyHint("app.tools.expand", "to expand")}`;
			}
		}

		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	function commandBaseDirs(ctx: ExtensionContext): string[] {
		const dirs = [path.join(getAgentDir(), "commands")];
		// Project commands only when the project is trusted (same gate pi uses
		// for project extensions). Listed last so project wins on a name clash.
		if (ctx.isProjectTrusted()) dirs.push(path.join(ctx.cwd, ".pi", "commands"));
		return dirs;
	}

	// Command files load via native import(); `export default` only parses as
	// ESM when a type:module package.json is in scope. ~/.pi/agent has none, so
	// guarantee one in each existing commands root. Idempotent; never clobbers an
	// existing package.json (an author may have their own with deps).
	function ensureEsmMarker(baseDir: string): void {
		try {
			if (!fs.existsSync(baseDir)) return;
			const pkg = path.join(baseDir, "package.json");
			if (!fs.existsSync(pkg)) {
				fs.writeFileSync(pkg, `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
			}
		} catch {
			// Best-effort; a write failure surfaces later as an import SyntaxError.
		}
	}

	function registerAll(ctx: ExtensionContext): void {
		const dirs = commandBaseDirs(ctx);
		for (const dir of dirs) ensureEsmMarker(dir);
		for (const cmd of discoverCommandDirs(dirs)) {
			if (registered.has(cmd.name)) continue;
			registered.add(cmd.name);
			pi.registerCommand(cmd.name, {
				description: `Run the ${cmd.name} orchestration command`,
				handler: (args, cctx) => runCommand(cmd, args, cctx),
			});
		}
	}

	pi.on("session_start", (_event, ctx) => {
		registerAll(ctx);
	});
	pi.on("resources_discover", (_event, ctx) => {
		registerAll(ctx);
		return {};
	});

	async function runCommand(cmd: DiscoveredCommand, args: string, ctx: ExtensionCommandContext): Promise<void> {
		const progress: string[] = [];
		const activities = new Map<number, AgentActivity>();
		let agentSeq = 0;
		let shellCount = 0;
		let readCount = 0;
		let writeCount = 0;
		const buildAgents = (): AgentSummary[] =>
			[...activities.values()].map((a) => ({
				agent: a.agent,
				ok: a.status === "ok",
				input: a.input,
				output: a.output,
				cost: a.cost,
				durationMs: a.durationMs,
			}));
		// Persist c.log/c.phase lines into details, bounded to the most recent so a
		// chatty command can't bloat the session entry.
		const persistSteps = (): string[] =>
			progress.length <= STEP_PERSIST_CAP
				? [...progress]
				: [`(… ${progress.length - STEP_PERSIST_CAP} earlier steps omitted)`, ...progress.slice(-STEP_PERSIST_CAP)];
		const paintWidget = () => {
			try {
				const acts = [...activities.values()];
				const running = acts.filter((a) => a.status === "running");
				const okCount = acts.filter((a) => a.status === "ok").length;
				const failCount = acts.filter((a) => a.status === "failed").length;
				const lines = [`/${cmd.name} — running`];
				for (const a of running.slice(0, WIDGET_RUNNING_SHOWN)) lines.push(`  ⟳ ${a.agent} · ${fmtTokens(a.input, a.output)}`);
				if (running.length > WIDGET_RUNNING_SHOWN) lines.push(`  …and ${running.length - WIDGET_RUNNING_SHOWN} more running`);
				if (okCount || failCount) lines.push(`  done: ${okCount} ok${failCount ? `, ${failCount} failed` : ""}`);
				const io = fmtIo(shellCount, readCount, writeCount);
				if (io !== "") lines.push(`  ${io}`);
				lines.push(...progress.slice(-WIDGET_TAIL));
				ctx.ui.setWidget(WIDGET_KEY, lines);
			} catch {
				// Widget is best-effort (e.g. non-TUI mode); never fail the run on it.
			}
		};
		paintWidget();

		let agentFailures = 0;
		const c = createCommandApi({
			args,
			cwd: ctx.cwd,
			maxConcurrency: MAX_CONCURRENCY,
			spawn: async (req: AgentRequest): Promise<AgentResult> => {
				const id = agentSeq++;
				const activity: AgentActivity = {
					id,
					agent: req.agent ?? "(unspecified)",
					status: "running",
					input: 0,
					output: 0,
					cost: 0,
					startedAt: Date.now(),
					durationMs: 0,
				};
				activities.set(id, activity);
				paintWidget();

				if (!req.agent) {
					// AgentRequest.agent is optional in the contract, but the v0 spawn
					// path is agent-centric (it resolves a named agent from the roster).
					// Fail loudly rather than silently no-op.
					agentFailures++;
					activity.status = "failed";
					activity.durationMs = Date.now() - activity.startedAt;
					paintWidget();
					return {
						ok: false,
						text: "",
						error: "c.agent requires an 'agent' name (bare-prompt spawns are not supported in v0)",
						usage: { ...ZERO_USAGE },
					};
				}

				const result = await spawnSubagent({
					agent: req.agent,
					task: req.prompt,
					cwd: req.cwd ?? ctx.cwd,
					model: req.model,
					thinking: req.thinking,
					tools: req.tools,
					timeoutMs: req.timeoutMs,
					ctx,
					onUpdate: (snap) => {
						activity.input = snap.usage.input;
						activity.output = snap.usage.output;
						activity.cost = snap.usage.cost;
						paintWidget();
					},
				});

				activity.status = result.ok ? "ok" : "failed";
				activity.input = result.usage.input;
				activity.output = result.usage.output;
				activity.cost = result.usage.cost;
				activity.durationMs = Date.now() - activity.startedAt;
				if (!result.ok) agentFailures++;
				paintWidget();
				return result;
			},
			exec: async (command, opts) => {
				shellCount++;
				paintWidget();
				const r = await pi.exec("bash", ["-c", command], {
					cwd: opts?.cwd ?? ctx.cwd,
					timeout: opts?.timeoutMs,
				});
				return { stdout: r.stdout, stderr: r.stderr, code: r.code };
			},
			readFile: (filePath: string) => {
				readCount++;
				paintWidget();
				return fs.promises.readFile(filePath, "utf8");
			},
			writeFile: async (filePath: string, content: string) => {
				writeCount++;
				paintWidget();
				await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
				await fs.promises.writeFile(filePath, content, "utf8");
			},
			ask: async (params: QuestionParams): Promise<QuestionnaireResult> => {
				// No dialog-capable UI (print/json modes): resolve cancelled so the
				// command can fall back rather than hang or throw.
				if (!ctx.hasUI) return { answers: [], cancelled: true, error: "no_ui" };
				const v = validateQuestionnaire(params);
				if (!v.ok) return { answers: [], cancelled: true, error: v.error };
				// Mirror ask-user-question's execute: ctx.ui.custom mounts the Dialog
				// into the overlay layer; ctx.signal (often undefined for commands)
				// cancels it when present.
				let dialog: Dialog | undefined;
				const signal = ctx.signal;
				const onAbort = () => dialog?.cancel();
				signal?.addEventListener("abort", onAbort, { once: true });
				try {
					return await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
						dialog = new Dialog({ tui, theme, params, done });
						return dialog;
					});
				} finally {
					signal?.removeEventListener("abort", onAbort);
				}
			},
			onProgress: (line, phase) => {
				progress.push(phase ? `[${phase}] ${line}` : line);
				paintWidget();
			},
		});

		try {
			const report = await runCommandModule(cmd.file, c, args);

			const { content, isError } = finalizeReport(
				report,
				{ agentFailures, commandName: cmd.name },
				{
					truncate: (text) => {
						const t = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
						return { content: t.content, truncated: t.truncated, outputLines: t.outputLines, totalLines: t.totalLines };
					},
					spill: (full) => {
						try {
							const p = path.join(os.tmpdir(), `command-${cmd.name}-${Date.now()}.txt`);
							fs.writeFileSync(p, full, "utf8");
							return p;
						} catch {
							return null;
						}
					},
				},
			);

			// No options -> default deliverAs "steer": when idle (a command runs idle)
			// the message is added and rendered immediately rather than deferred.
			pi.sendMessage({
				customType: RESULT_TYPE,
				content,
				display: true,
				details: { command: cmd.name, isError, agents: buildAgents(), steps: persistSteps(), shell: shellCount, reads: readCount, writes: writeCount },
			});
		} catch (err) {
			const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
			pi.sendMessage({
				customType: RESULT_TYPE,
				content: `Command /${cmd.name} failed:\n\n${detail}`,
				display: true,
				details: { command: cmd.name, isError: true, agents: buildAgents(), steps: persistSteps(), shell: shellCount, reads: readCount, writes: writeCount },
			});
			try {
				ctx.ui.notify(`/${cmd.name} failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			} catch {
				// notify is best-effort.
			}
		} finally {
			try {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
			} catch {
				// best-effort clear
			}
		}
	}
}
