/**
 * Report finalization — failure banner + truncation, kept pure via injected
 * deps (truncate + spill) so it is unit-testable without pi's truncateHead or
 * touching the filesystem. The runner wires the real implementations.
 */

export interface TruncationView {
	content: string;
	truncated: boolean;
	outputLines: number;
	totalLines: number;
}

export interface FinalizeDeps {
	/** Truncate to the runner's limits (wired to truncateHead in the runner). */
	truncate: (content: string) => TruncationView;
	/** Persist the full report somewhere durable; return its path, or null on failure. */
	spill: (content: string) => string | null;
}

export interface FinalizedReport {
	/** Text to deliver into the conversation. */
	content: string;
	/** True when any c.agent call failed — the result is marked errored. */
	isError: boolean;
}

/**
 * Build the deliverable report:
 *  - If any agent call failed, prefix a one-line banner so a partial run can't
 *    look clean (mirrors pi-workflow). The banner sits at the head, so it
 *    survives head-truncation.
 *  - Truncate; if truncated, spill the full report and append its path.
 */
export function finalizeReport(
	report: string,
	opts: { agentFailures: number; commandName: string },
	deps: FinalizeDeps,
): FinalizedReport {
	const isError = opts.agentFailures > 0;

	let body = report;
	if (isError) {
		const noun = opts.agentFailures === 1 ? "agent call" : "agent calls";
		body = `⚠️  ${opts.agentFailures} ${noun} failed during /${opts.commandName}; results below may be incomplete.\n\n${body}`;
	}

	const t = deps.truncate(body);
	let content = t.content;
	if (t.truncated) {
		const fullPath = deps.spill(body);
		content += fullPath
			? `\n\n[Output truncated to ${t.outputLines} of ${t.totalLines} lines. Full report written to ${fullPath}]`
			: `\n\n[Output truncated to ${t.outputLines} of ${t.totalLines} lines.]`;
	}

	return { content, isError };
}
