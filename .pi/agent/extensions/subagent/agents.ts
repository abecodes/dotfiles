/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
	parseThinkingLevel,
	parseToolEntries,
	type ParsedToolEntry,
	type ThinkingLevel,
} from "./helpers.ts";

export type AgentScope = "user" | "project" | "both";
export type { ThinkingLevel } from "./helpers.ts";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	/** Parsed entries including any per-tool prefix patterns (e.g. bash(go test:*)). */
	toolEntries?: ParsedToolEntry[];
	model?: string;
	/** Optional override for the child pi process's reasoning effort. */
	thinkingLevel?: ThinkingLevel;
	/**
	 * When "worktree", each run of this agent is isolated in a private git
	 * worktree and atomically integrated back on exit (see sandbox.ts). Opt-in
	 * via frontmatter `sandbox: worktree`.
	 */
	sandbox?: "worktree";
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

// Dedupe key = `${filePath}@${mtimeMs}`. discoverAgents runs on every prompt
// injection and every tool call, so an unconditional warn would spam stderr.
// Keying on mtime means an edited-but-still-broken file warns again.
const warnedParseFailures = new Set<string>();

function warnAgentLoadFailure(filePath: string, err: unknown): void {
	let key = filePath;
	try {
		key = `${filePath}@${fs.statSync(filePath).mtimeMs}`;
	} catch {
		// stat failed; fall back to bare path so we at least warn once.
	}
	if (warnedParseFailures.has(key)) return;
	warnedParseFailures.add(key);
	const reason = err instanceof Error ? err.message : String(err);
	console.warn(`[subagent] skipped agent file (failed to parse): ${filePath}\n  reason: ${reason}`);
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		// Per-file try/catch: a single malformed agent file (read error,
		// frontmatter parser blow-up, unexpected YAML shape) must not abort
		// discovery for the rest of the directory. The before_agent_start hook
		// runs this on every parent startup; one bad file would otherwise
		// silently break the user's session.
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);

			const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
			const description =
				typeof frontmatter.description === "string" ? frontmatter.description : undefined;
			if (!name || !description) continue;

			const toolEntries = parseToolEntries(frontmatter.tools);
			const tools = toolEntries?.map((e) => e.name);
			const model = typeof frontmatter.model === "string" ? frontmatter.model : undefined;
			// Accept either `thinking:` or `thinkingLevel:` for ergonomic frontmatter.
			// Both go through parseThinkingLevel which silently drops unknown values,
			// matching how an unrecognized `model:` would just fail at spawn — but
			// here we'd rather inherit the parent's default than crash the child on
			// a typo.
			const thinkingLevel =
				parseThinkingLevel(frontmatter.thinking) ??
				parseThinkingLevel(frontmatter.thinkingLevel);
			const sandbox = frontmatter.sandbox === "worktree" ? "worktree" : undefined;

			agents.push({
				name,
				description,
				tools: tools && tools.length > 0 ? tools : undefined,
				toolEntries: toolEntries && toolEntries.length > 0 ? toolEntries : undefined,
				model,
				thinkingLevel,
				sandbox,
				systemPrompt: body,
				source,
				filePath,
			});
		} catch (err) {
			// Skip this file; keep loading the rest. Warn (deduped) so a malformed
			// agent file isn't silently invisible — e.g. an unquoted `description:`
			// containing `: ` that YAML mis-reads as a nested mapping.
			warnAgentLoadFailure(filePath, err);
			continue;
		}
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
