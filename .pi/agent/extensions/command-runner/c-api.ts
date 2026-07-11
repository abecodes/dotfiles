/**
 * `c` — the orchestration API injected into every command script.
 *
 * A command lives at  ~/.pi/agent/commands/<name>/index.js  and exports a
 * default async function. The command-runner extension loads it via a native
 * dynamic `import()` (NO node:vm — see DESIGN.md "Trust model") and calls:
 *
 *     export default async function (c, args) {
 *       const findings = await c.map(targets, t =>
 *         c.agent({ agent: "reviewer", prompt: `Review ${t} ...` }));
 *       const report = await c.agent({ agent: "synth",
 *         prompt: `Combine:\n${findings.map(f => f.text).join("\n---\n")}` });
 *       return report.text;            // <- becomes the command's output
 *     }
 *
 * The plan (which calls, in what order, how combined) is deterministic code.
 * The *results* of each call are not (agents/LLM vary; bash/read depend on the
 * current tree). `c` is the only door the script is meant to use to reach the
 * system; everything else (fs, child_process, network) should go through it so
 * the runner can log, time-box, and render each step. `/commandify` lints a
 * draft for raw fs/child_process/process use and rewrites it to `c.*`.
 */

import type { ThinkingLevel } from "../subagent/helpers.ts";

// AgentResult / AgentUsage are produced by the subagent extension's
// `spawnSubagent` and re-exported here so command scripts import the whole `c`
// contract from one place. The canonical definitions live in subagent (the
// producer); the dependency runs command-runner -> subagent, never the reverse.
import type { AgentResult, AgentUsage } from "../subagent/helpers.ts";
export type { AgentResult, AgentUsage };

// QuestionParams / QuestionnaireResult define the c.ask contract. They are
// re-exported from the ask-user-question extension (the producer) so a command
// script gets the whole `c` contract from one import. Type-only: erased at
// runtime, so there is no runtime dependency on that extension here.
import type { QuestionParams, QuestionnaireResult } from "../ask-user-question/tool.ts";
export type { QuestionParams, QuestionnaireResult };

export interface AgentRequest {
	/** Self-contained task prompt. Inline any material the agent must reason over. */
	prompt: string;
	/** Named agent from ~/.pi/agent/agents. Omit to run a bare prompt on the default model. */
	agent?: string;
	/** Tier name (cheap|standard|heavy|...) or literal provider/id. Omit -> agent/default. */
	model?: string;
	/** off|minimal|low|medium|high|xhigh. Omit -> agent/session default. */
	thinking?: ThinkingLevel;
	/** Tool allowlist override for this spawn (same grammar as agent frontmatter). */
	tools?: string[];
	/** Working dir for the spawned pi. Defaults to the command's cwd. */
	cwd?: string;
	/** Wall-clock cap (ms). On expiry the child is killed and ok:false, error:"timeout". */
	timeoutMs?: number;
}

export interface BashResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface MapOptions {
	/** Max concurrent callbacks in flight. Defaults to the runner cap (4). */
	concurrency?: number;
}

/**
 * The injected orchestration handle. One instance per command invocation.
 *
 * Mapping to existing infrastructure (see DESIGN.md for the full table):
 *   agent()  -> the extracted subagent spawn (buildSpawnArgs + the runSingleAgent
 *               collect loop). Inherits allow-list permission override + depth
 *               guard, so a command's agents are gated exactly like the
 *               `subagent` tool's agents.
 *   map()    -> concurrency-capped fan-out (cannot exceed the runner cap, so a
 *               command can't fork-bomb pi with hundreds of child processes).
 *   bash()   -> pi.exec(...). Runs as the (trusted) command itself; NOT
 *   read()      allow-list-gated. They exist for a clean API + per-step logging
 *   write()     and time-boxing, not as a permission boundary.
 *   ask()    -> ctx.ui.custom() + the ask-user-question Dialog; prompts the user
 *               mid-run, resolving to a cancelled result when there is no UI.
 *   log()    -> a progress line in the command's tool widget.
 *   phase()  -> groups log lines under a named phase in the widget.
 */
export interface CommandApi {
	/** Raw invocation text after `/<name> ` (also passed as the 2nd argument). */
	readonly args: string;

	/** Spawn one subagent and await its final output. */
	agent(req: AgentRequest): Promise<AgentResult>;

	/** Concurrency-capped fan-out. Order of results matches `items`. */
	map<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>, opts?: MapOptions): Promise<R[]>;

	/** Promise.all helper (no concurrency cap — you already created the promises). */
	all<T>(promises: Array<Promise<T>>): Promise<T[]>;

	/** Run a shell command as the command process. Trusted, ungated. */
	bash(command: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<BashResult>;

	/** Read a file as the command process. Trusted, ungated. */
	read(path: string): Promise<string>;

	/** Write a file as the command process (parent dirs created). Trusted, ungated. */
	write(path: string, content: string): Promise<void>;

	/**
	 * Prompt the user with a questionnaire — same contract as the
	 * `ask_user_question` tool (1–4 questions, 2–6 options each; a free-form
	 * "Type something." row is appended to single-select questions, plus a
	 * "Chat about this" escape hatch). Set `optionsOnly: true` on a question to
	 * suppress BOTH of those runtime rows when the answer is consumed
	 * programmatically (control flow) rather than handed to an LLM — leaving the
	 * authored options + Esc only. In a headless session (no UI) `ask` resolves
	 * to `{ answers: [], cancelled: true, error: "no_ui" }` instead of throwing,
	 * so the command can fall back. Distinguish a real user cancel from headless
	 * by checking `error`: `cancelled && !error` == the user pressed Esc.
	 */
	ask(params: QuestionParams): Promise<QuestionnaireResult>;

	/** Emit a progress line into the command's tool widget. */
	log(message: string): void;

	/** Group nested work under a named phase for progress display. */
	phase<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** The contract every command module's default export must satisfy. */
export type CommandModule = (c: CommandApi, args: string) => Promise<string>;
