/**
 * `createCommandApi` — builds the `c` handle injected into a command script.
 *
 * All effects are taken as injected `deps` so the API is unit-testable without
 * spawning a real pi or shelling out. The runner (index.ts) wires the real
 * deps: `spawn` -> spawnSubagent, `exec` -> pi.exec, `readFile` -> fs, and
 * `onProgress` -> the tool widget.
 */

import type { QuestionParams, QuestionnaireResult } from "../ask-user-question/tool.ts";
import type { AgentRequest, AgentResult, BashResult, CommandApi, MapOptions } from "./c-api.ts";

export interface CommandApiDeps {
	/** Raw invocation text after `/<name> `. */
	args: string;
	/** The command's working directory. */
	cwd: string;
	/** Spawn one subagent. Wired to spawnSubagent in the runner. */
	spawn: (req: AgentRequest) => Promise<AgentResult>;
	/** Run a shell command. Wired to pi.exec in the runner. */
	exec: (command: string, opts?: { cwd?: string; timeoutMs?: number }) => Promise<BashResult>;
	/** Read a file. Wired to fs.promises.readFile in the runner. */
	readFile: (filePath: string) => Promise<string>;
	/** Write a file (parent dirs created). Wired to fs.promises in the runner. */
	writeFile: (filePath: string, content: string) => Promise<void>;
	/** Prompt the user. Wired to ctx.ui.custom + the ask-user-question Dialog in the runner. */
	ask: (params: QuestionParams) => Promise<QuestionnaireResult>;
	/** Emit a progress line (optionally tagged with the active phase). */
	onProgress: (line: string, phase?: string) => void;
	/** Hard ceiling on concurrent `c.map` callbacks. Per-call concurrency can lower but not raise it. */
	maxConcurrency: number;
}

/**
 * Order-preserving, concurrency-limited map. Ported (not imported) to keep this
 * module dep-free. Results align to input order regardless of completion order.
 */
async function mapWithConcurrencyLimit<TIn, TOut>(
	items: readonly TIn[],
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

export function createCommandApi(deps: CommandApiDeps): CommandApi {
	// Floor of 1; a non-positive or NaN ceiling collapses to serial execution.
	const ceiling = Math.max(1, Math.floor(deps.maxConcurrency) || 1);
	let currentPhase: string | undefined;

	return {
		args: deps.args,

		agent(req: AgentRequest): Promise<AgentResult> {
			return deps.spawn(req);
		},

		map<T, R>(
			items: readonly T[],
			fn: (item: T, index: number) => Promise<R>,
			opts?: MapOptions,
		): Promise<R[]> {
			const requested = opts?.concurrency ?? ceiling;
			// Per-call concurrency can lower the cap but never raise it above the
			// runner ceiling, so a command can't fork-bomb pi with child processes.
			const limit = Math.max(1, Math.min(requested, ceiling));
			return mapWithConcurrencyLimit(items, limit, fn);
		},

		all<T>(promises: Array<Promise<T>>): Promise<T[]> {
			return Promise.all(promises);
		},

		bash(command: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<BashResult> {
			return deps.exec(command, opts);
		},

		read(filePath: string): Promise<string> {
			return deps.readFile(filePath);
		},

		write(filePath: string, content: string): Promise<void> {
			return deps.writeFile(filePath, content);
		},

		ask(params: QuestionParams): Promise<QuestionnaireResult> {
			return deps.ask(params);
		},

		log(message: string): void {
			deps.onProgress(message, currentPhase);
		},

		async phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
			const previous = currentPhase;
			currentPhase = name;
			const start = Date.now();
			// Phase boundary markers are emitted untagged (they already name the
			// phase); only log lines *inside* the phase carry the phase tag, so a
			// consumer renders "▶ build" / "[build] <log>" rather than "[build] ▶ build".
			deps.onProgress(`▶ ${name}`);
			try {
				const result = await fn();
				deps.onProgress(`✓ ${name} (${Date.now() - start}ms)`);
				return result;
			} catch (err) {
				deps.onProgress(`✗ ${name} (${Date.now() - start}ms)`);
				throw err;
			} finally {
				// Restore the outer phase so nested phases tag correctly.
				currentPhase = previous;
			}
		},
	};
}
