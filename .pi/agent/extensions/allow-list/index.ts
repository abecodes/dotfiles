/**
 * allow-list extension
 *
 * Gates every tool_call against allow / ask / deny rules stored in:
 *   - ~/.pi/agent/permission.json   (global)
 *   - <cwd>/.pi/permission.json     (project, wins on conflict)
 *
 * Rule format (Claude-Code-style):
 *   {
 *     "allow": ["Edit", "Read", "Bash(git diff:*)", "WebFetch(domain:docs.anthropic.com)"],
 *     "ask":   ["Bash(git push:*)", "Bash(rm:*)"],
 *     "deny":  ["Bash(python:*)"]
 *   }
 *
 * Behavior:
 *   - allow → pass through
 *   - deny  → block with rule reason
 *   - ask   → confirm with the user; "no" blocks
 *   - no match (unknown) → ask user with options:
 *       * Allow once
 *       * Deny once
 *       * Save a permanent allow / ask / deny rule (choose pattern + scope)
 *
 * Slash command:
 *   /permissions [list|add|remove|reload]
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type BashLeaf,
	decomposeBash,
	KNOWN_MULTI_SUBCOMMAND_TOOLS,
	tokenize,
} from "../_shared/bash-parse.js";
import {
	type BashAggregate,
	type Decision,
	type LeafReview,
	type LoadedRules,
	type ParsedRule,
	type RuleFile,
	type Scope,
	type Verdict,
	argKeyValueMatches as sharedArgKeyValueMatches,
	bashBodyMatches as sharedBashBodyMatches,
	canonicalToolName as sharedCanonicalToolName,
	classify as sharedClassify,
	decide as sharedDecide,
	decideBash as sharedDecideBash,
	emptyRuleFile,
	expandHome as sharedExpandHome,
	parseRule,
	ruleMatches as sharedRuleMatches,
	sanitizeRuleFile,
	TOOL_ALIASES,
} from "../_shared/permission-rules.js";
import { publishLoadedRules } from "../_shared/rule-state.js";

// Re-export local aliases so the rest of this file keeps its prior call sites.
// Trade-off: a small block of forwarding wrappers in exchange for not
// touching ~50 internal call sites that pass `os.homedir()` explicitly. The
// shared module takes homedir as a parameter so it stays pure and testable;
// here we curry it once.
const HOMEDIR = os.homedir();
const EMPTY_FILE = emptyRuleFile;
const canonicalToolName = sharedCanonicalToolName;
const bashBodyMatches = sharedBashBodyMatches;
const expandHome = (s: string) => sharedExpandHome(s, HOMEDIR);
const argKeyValueMatches = (input: unknown, key: string, value: string, mode: "any" | "all") =>
	sharedArgKeyValueMatches(input, key, value, mode, HOMEDIR);
const ruleMatches = (rule: ParsedRule, toolName: string, input: unknown, mode: "any" | "all" = "all") =>
	sharedRuleMatches(rule, toolName, input, mode, HOMEDIR);
const classify = (rules: RuleFile, toolName: string, input: unknown) =>
	sharedClassify(rules, toolName, input, HOMEDIR);
const decide = (loaded: LoadedRules, toolName: string, input: unknown) =>
	sharedDecide(loaded, toolName, input, HOMEDIR);
const decideBash = (loaded: LoadedRules, command: string, cwd?: string) =>
	sharedDecideBash(loaded, command, HOMEDIR, cwd);

// --------------------------------------------------------------------------------------
// File IO
// --------------------------------------------------------------------------------------

function configDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function globalPath(): string {
	return path.join(configDir(), "permission.json");
}

function projectPath(cwd: string): string {
	return path.join(cwd, ".pi", "permission.json");
}

function readRuleFile(p: string): { rules: RuleFile; error?: string } {
	try {
		if (!fs.existsSync(p)) return { rules: EMPTY_FILE() };
		const raw = fs.readFileSync(p, "utf8");
		return { rules: sanitizeRuleFile(JSON.parse(raw)) };
	} catch (e) {
		return { rules: EMPTY_FILE(), error: (e as Error).message };
	}
}

function writeRuleFile(p: string, rules: RuleFile): void {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	const ordered = {
		allow: [...rules.allow],
		ask: [...rules.ask],
		deny: [...rules.deny],
	};
	fs.writeFileSync(p, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

function loadAllRules(cwd: string): LoadedRules {
	const gp = globalPath();
	const pp = projectPath(cwd);
	const g = readRuleFile(gp);
	const pr = readRuleFile(pp);
	return {
		global: g.rules,
		project: pr.rules,
		session: EMPTY_FILE(),
		globalPath: gp,
		projectPath: pp,
	};
}

// Rule parsing, matching, classify/decide/decideBash now live in
// ../_shared/permission-rules.ts. Local thin wrappers near the top of this
// file curry os.homedir() into the shared functions so the rest of allow-list
// keeps its prior call-site shape (no per-call homedir argument).

// --------------------------------------------------------------------------------------
// Subagent multi-leaf decomposition
// --------------------------------------------------------------------------------------
//
// `subagent` calls come in three shapes:
//   - single:  { agent, task }
//   - parallel: { tasks: [{agent,task}, ...] }
//   - chain:    { chain: [{agent,task}, ...] }
//
// We treat each entry as a "leaf" and evaluate it against the rule set
// independently, then aggregate the verdicts the same way Bash chains are
// aggregated:
//   - any leaf denied → deny the whole call
//   - all leaves allowed (possibly by different rules) → allow
//   - otherwise → review (prompt the user with a per-leaf overview)
//
// This is what lets a chain `[scout, tracer]` go through when each agent has
// its own `allow: subagent(agent:<name>)` rule, even though no single rule
// matches every entry.

interface SubagentLeaf {
	agent: string;
	form: "single" | "tasks" | "chain";
	index: number; // -1 for single
	display: string;
}

interface SubagentLeafReview {
	leaf: SubagentLeaf;
	decision: Decision | null;
}

type SubagentAggregate =
	| { kind: "allow" }
	| { kind: "deny"; rule: string; scope: Scope; leaf: SubagentLeaf }
	| { kind: "review"; allLeaves: SubagentLeafReview[]; pending: SubagentLeafReview[] }
	| { kind: "passthrough" }; // no extractable agent fields

function decomposeSubagent(input: unknown): SubagentLeaf[] {
	const raw = input as Record<string, unknown> | null | undefined;
	if (!raw || typeof raw !== "object") return [];
	const out: SubagentLeaf[] = [];
	const push = (entry: unknown, form: SubagentLeaf["form"], index: number) => {
		const a = (entry as Record<string, unknown> | null)?.agent;
		if (typeof a === "string" && a) {
			const label =
				form === "single"
					? `agent: ${a}`
					: `${form}[${index}] agent: ${a}`;
			out.push({ agent: a, form, index, display: label });
		}
	};

	const chain = raw.chain;
	if (Array.isArray(chain)) {
		chain.forEach((e, i) => push(e, "chain", i));
		return out;
	}
	const tasks = raw.tasks;
	if (Array.isArray(tasks)) {
		tasks.forEach((e, i) => push(e, "tasks", i));
		return out;
	}
	push(raw, "single", -1);
	return out;
}

function decideSubagent(loaded: LoadedRules, input: unknown): SubagentAggregate {
	const leaves = decomposeSubagent(input);
	if (leaves.length === 0) return { kind: "passthrough" };

	const reviews: SubagentLeafReview[] = leaves.map((leaf) => {
		const d = decide(loaded, "subagent", { agent: leaf.agent });
		return { leaf, decision: d };
	});

	for (const r of reviews) {
		if (r.decision?.verdict === "deny") {
			return { kind: "deny", rule: r.decision.rule, scope: r.decision.scope, leaf: r.leaf };
		}
	}

	const pending = reviews.filter((r) => r.decision?.verdict !== "allow");
	if (pending.length === 0) return { kind: "allow" };
	return { kind: "review", allLeaves: reviews, pending };
}

// --------------------------------------------------------------------------------------
// Suggestion + summary helpers
// --------------------------------------------------------------------------------------

function summarize(toolName: string, input: unknown): string {
	const canon = canonicalToolName(toolName);
	const raw = input as Record<string, unknown> | null | undefined;

	if (canon === "Bash") return `bash: ${String(raw?.command ?? "").trim()}`;
	if (canon === "Read" || canon === "Edit" || canon === "Write") {
		const p = String(raw?.path ?? "");
		return `${toolName}: ${p}`;
	}
	if (canon === "WebFetch") return `WebFetch: ${String(raw?.url ?? "")}`;

	let s: string;
	try {
		s = JSON.stringify(input);
	} catch {
		s = String(input);
	}
	if (s.length > 240) s = `${s.slice(0, 237)}...`;
	return `${toolName}: ${s}`;
}

function suggestPatterns(toolName: string, input: unknown): string[] {
	const canon = canonicalToolName(toolName);
	const raw = input as Record<string, unknown> | null | undefined;

	if (canon === "Bash") {
		const cmd = String(raw?.command ?? "").trim();
		const tokens = tokenize(cmd);
		const out: string[] = [];
		if (tokens.length >= 2) out.push(`Bash(${tokens[0]} ${tokens[1]}:*)`);
		if (tokens.length >= 1) out.push(`Bash(${tokens[0]}:*)`);
		if (cmd) out.push(`Bash(${cmd})`);
		out.push("Bash"); // any bash command
		return [...new Set(out)];
	}

	if (canon === "WebFetch") {
		const url = String(raw?.url ?? "");
		const out: string[] = [];
		try {
			const host = new URL(url).hostname;
			out.push(`WebFetch(domain:${host})`);
			const parts = host.split(".");
			if (parts.length >= 2) {
				out.push(`WebFetch(domain:${parts.slice(-2).join(".")})`);
			}
		} catch {
			/* ignore */
		}
		out.push("WebFetch");
		return [...new Set(out)];
	}

	// Subagent: surface `subagent(agent:<name>)` patterns. Handles single,
	// parallel (`tasks: [...]`) and chain (`chain: [...]`) call shapes.
	if (canon.toLowerCase() === "subagent") {
		const out: string[] = [];
		const collect = (entry: unknown) => {
			const a = (entry as Record<string, unknown> | null)?.agent;
			if (typeof a === "string" && a) out.push(`${canon}(agent:${a})`);
		};
		collect(raw);
		const tasks = (raw as any)?.tasks;
		if (Array.isArray(tasks)) tasks.forEach(collect);
		const chain = (raw as any)?.chain;
		if (Array.isArray(chain)) chain.forEach(collect);
		out.push(canon);
		return [...new Set(out)];
	}

	return [canon];
}

// --------------------------------------------------------------------------------------
// Saving rules
// --------------------------------------------------------------------------------------

function fileForScope(loaded: LoadedRules, scope: Scope): RuleFile {
	if (scope === "global") return loaded.global;
	if (scope === "project") return loaded.project;
	return loaded.session;
}

/** Returns null on success, or an error message string on failure. */
function addRule(loaded: LoadedRules, scope: Scope, verdict: Verdict, rule: string): string | null {
	const file = fileForScope(loaded, scope);

	// Snapshot for rollback on write failure.
	const snapshot: RuleFile = {
		allow: [...file.allow],
		ask: [...file.ask],
		deny: [...file.deny],
	};

	// Avoid duplicating the same rule under any verdict in this file.
	for (const v of ["allow", "ask", "deny"] as const) {
		file[v] = file[v].filter((r) => r !== rule);
	}
	file[verdict].push(rule);

	if (scope === "session") return null; // in-memory only, no write

	const filePath = scope === "global" ? loaded.globalPath : loaded.projectPath;
	try {
		writeRuleFile(filePath, file);
		return null;
	} catch (e) {
		file.allow = snapshot.allow;
		file.ask = snapshot.ask;
		file.deny = snapshot.deny;
		return `failed to write ${filePath}: ${(e as Error).message}`;
	}
}

/** Returns null on success, or an error message string on failure. */
function removeRule(loaded: LoadedRules, scope: Scope, verdict: Verdict, rule: string): string | null {
	const file = fileForScope(loaded, scope);
	const snapshot = [...file[verdict]];
	file[verdict] = file[verdict].filter((r) => r !== rule);

	if (scope === "session") return null; // in-memory only, no write

	const filePath = scope === "global" ? loaded.globalPath : loaded.projectPath;
	try {
		writeRuleFile(filePath, file);
		return null;
	} catch (e) {
		file[verdict] = snapshot;
		return `failed to write ${filePath}: ${(e as Error).message}`;
	}
}

// --------------------------------------------------------------------------------------
// UI helpers
// --------------------------------------------------------------------------------------

/**
 * Run an async UI flow with the working-indicator suppressed.
 *
 * Pi's working indicator (the streaming spinner) re-renders the TUI on every
 * animation frame. While a dialog is open, those re-renders snap the
 * terminal's scrollback back to the bottom on every tick, making it
 * impossible to scroll up and read the model's prose that preceded the
 * prompt. setWorkingVisible(false) stops the loader and its interval; we
 * restore it in finally so a thrown error or abort doesn't leave the
 * indicator hidden forever.
 */
async function withQuietUI<T>(ctx: ExtensionContext, fn: () => Promise<T>): Promise<T> {
	if (!ctx.hasUI) return fn();
	ctx.ui.setWorkingVisible(false);
	try {
		return await fn();
	} finally {
		ctx.ui.setWorkingVisible(true);
	}
}

// --------------------------------------------------------------------------------------
// Interactive flows
// --------------------------------------------------------------------------------------

const VERDICT_LABEL: Record<Verdict, string> = {
	allow: "✅ allow",
	ask: "❓ ask",
	deny: "🛑 deny",
};

const SCOPE_LABEL: Record<Scope, string> = {
	global: "Global (~/.pi/agent/permission.json)",
	project: "Project (.pi/permission.json)",
	session: "Session (in-memory, this run only)",
};

async function pickPattern(
	ctx: ExtensionContext,
	toolName: string,
	input: unknown,
): Promise<string | undefined> {
	const suggestions = suggestPatterns(toolName, input);
	const options = [...suggestions, "Custom pattern…"];
	const choice = await ctx.ui.select("Pattern to save:", options);
	if (!choice) return undefined;
	if (choice !== "Custom pattern…") return choice;
	const custom = await ctx.ui.input("Custom rule pattern", suggestions[0] ?? toolName);
	const trimmed = (custom ?? "").trim();
	return trimmed || undefined;
}

async function pickScope(ctx: ExtensionContext): Promise<Scope | undefined> {
	const choice = await ctx.ui.select("Save where?", [SCOPE_LABEL.project, SCOPE_LABEL.global]);
	if (!choice) return undefined;
	return choice === SCOPE_LABEL.global ? "global" : "project";
}

async function pickVerdict(ctx: ExtensionContext, current?: Verdict): Promise<Verdict | undefined> {
	const order: Verdict[] = ["allow", "ask", "deny"];
	const labels = order.map((v) => `${VERDICT_LABEL[v]}${v === current ? " (current)" : ""}`);
	const choice = await ctx.ui.select("Verdict:", labels);
	if (!choice) return undefined;
	const idx = labels.indexOf(choice);
	return order[idx];
}

interface PromptForCallOpts {
	/** "single" = top-level prompt for one tool call.
	 *  "leaf"   = prompt inside the configure-each loop for one subcommand of a Bash chain. */
	mode?: "single" | "leaf";
	/** Original (pre-strip) display form of the leaf, when mode=="leaf". */
	display?: string;
}

/**
 * Prompt for a tool call that has no matching rule, or matches an "ask" rule.
 * Returns whether to allow this single execution.
 */
async function promptForCall(
	ctx: ExtensionContext,
	loaded: LoadedRules,
	toolName: string,
	input: unknown,
	matched: Decision | null,
	opts: PromptForCallOpts = {},
): Promise<{ allow: boolean; reason?: string }> {
	const mode = opts.mode ?? "single";
	const summary = mode === "leaf" && opts.display
		? `bash subcommand: ${opts.display}`
		: summarize(toolName, input);

	const header = matched
		? `Rule "${matched.rule}" (${matched.scope}, verdict: ask) requires confirmation:\n${summary}`
		: mode === "leaf"
			? `No rule matches this subcommand:\n${summary}`
			: `No rule matches this tool call:\n${summary}`;

	const ALLOW_ONCE = mode === "leaf"
		? "✅ Allow this subcommand for this call (no rule saved)"
		: "✅ Allow once";
	const ALLOW_SESSION = mode === "leaf"
		? "✅ Allow this subcommand for this session (in-memory, not saved)"
		: "✅ Allow for this session (in-memory, not saved)";
	const DENY_ONCE = mode === "leaf"
		? "🛑 Deny this subcommand (blocks the whole call)"
		: "🛑 Deny once";
	const SAVE_ALLOW = "📌 Save permanent allow rule";
	const SAVE_ASK = "📌 Save permanent ask rule";
	const SAVE_DENY = "📌 Save permanent deny rule";

	// "ask" matches: don't offer "save permanent ask" — they already have one.
	const baseOptions = matched?.verdict === "ask"
		? [ALLOW_ONCE, ALLOW_SESSION, DENY_ONCE, SAVE_ALLOW, SAVE_DENY]
		: [ALLOW_ONCE, ALLOW_SESSION, DENY_ONCE, SAVE_ALLOW, SAVE_ASK, SAVE_DENY];

	const choice = await ctx.ui.select(header, baseOptions);
	if (!choice) return { allow: false, reason: "User dismissed permission prompt" };

	if (choice === ALLOW_ONCE) return { allow: true };
	if (choice === DENY_ONCE) return { allow: false, reason: "User denied this tool call" };

	if (choice === ALLOW_SESSION) {
		const pattern = await pickPattern(ctx, toolName, input);
		if (!pattern) return { allow: false, reason: "No pattern selected" };
		const err = addRule(loaded, "session", "allow", pattern);
		if (err) {
			ctx.ui.notify(`allow-list: ${err}`, "error");
			return { allow: false, reason: `Could not save session rule: ${err}` };
		}
		ctx.ui.notify(`Session-allow ${pattern} (this run only)`, "info");
		return { allow: true };
	}

	const verdict: Verdict = choice === SAVE_ALLOW ? "allow" : choice === SAVE_ASK ? "ask" : "deny";

	const pattern = await pickPattern(ctx, toolName, input);
	if (!pattern) return { allow: false, reason: "No pattern selected" };

	const scope = await pickScope(ctx);
	if (!scope) return { allow: false, reason: "No scope selected" };

	const err = addRule(loaded, scope, verdict, pattern);
	if (err) {
		ctx.ui.notify(`allow-list: ${err}`, "error");
		return { allow: false, reason: `Could not save rule: ${err}` };
	}
	ctx.ui.notify(`Saved ${VERDICT_LABEL[verdict]} ${pattern} → ${SCOPE_LABEL[scope]}`, "info");

	if (verdict === "allow") return { allow: true };
	if (verdict === "deny") return { allow: false, reason: `Saved deny rule: ${pattern}` };

	// verdict === "ask": still need a one-time decision for this call.
	const onceConfirmed = await ctx.ui.confirm("Allow this call?", `Saved ask rule: ${pattern}`);
	return onceConfirmed
		? { allow: true }
		: { allow: false, reason: "User denied (ask rule saved)" };
}

// --------------------------------------------------------------------------------------
// Bash multi-leaf review prompt
// --------------------------------------------------------------------------------------

function renderLeafOverview(allLeaves: LeafReview[]): string {
	const lines: string[] = [];
	for (const r of allLeaves) {
		const icon = r.decision?.verdict === "allow"
			? "✅"
			: r.decision?.verdict === "ask"
				? "❔"
				: r.decision?.verdict === "deny"
					? "🛑"
					: "❔"; // unknown
		const depthMarker = r.leaf.depth > 0 ? `··${"·".repeat(r.leaf.depth - 1)} ` : "";
		const snippet = r.leaf.display.length > 120 ? `${r.leaf.display.slice(0, 117)}...` : r.leaf.display;
		const rule = r.decision
			? `  ← ${r.decision.rule} (${r.decision.scope})`
			: "";
		lines.push(`  ${icon} ${depthMarker}${snippet}${rule}`);
	}
	return lines.join("\n");
}

/**
 * Pick the preferred default rule pattern for a leaf when batch-saving.
 *
 * For tools whose first arg is conventionally a subcommand (`go`, `git`, …)
 * the two-token form (`Bash(go build:*)`) is right. For everything else
 * — especially shell builtins and absolute-path commands — the single-token
 * form (`Bash(cd:*)`) is what the user almost always wants.
 */
function preferredPatternForLeaf(leaf: BashLeaf): string {
	const suggestions = suggestPatterns("Bash", { command: leaf.match });
	const tokens = tokenize(leaf.match);
	const head = tokens[0] ?? "";
	if (KNOWN_MULTI_SUBCOMMAND_TOOLS.has(head)) {
		// Find the first two-token suggestion (it'll be at index 0 if present).
		const twoTok = suggestions.find((s) => /^Bash\([^\s]+\s[^\s]+:\*\)$/.test(s));
		if (twoTok) return twoTok;
	}
	const oneTok = suggestions.find((s) => /^Bash\([^\s]+:\*\)$/.test(s));
	if (oneTok) return oneTok;
	return suggestions[0] ?? `Bash(${leaf.match})`;
}

/** Group pending leaves by suggested top-level pattern (e.g. `Bash(go env:*)`). */
function groupPendingByPattern(pending: LeafReview[]): Map<string, LeafReview[]> {
	const groups = new Map<string, LeafReview[]>();
	for (const r of pending) {
		const preferred = preferredPatternForLeaf(r.leaf);
		const list = groups.get(preferred) ?? [];
		list.push(r);
		groups.set(preferred, list);
	}
	return groups;
}

async function configureLeafIndividually(
	ctx: ExtensionContext,
	loaded: LoadedRules,
	leaf: BashLeaf,
	matched: Decision | null,
): Promise<{ allow: boolean; reason?: string }> {
	return promptForCall(ctx, loaded, "Bash", { command: leaf.match }, matched, { mode: "leaf", display: leaf.display });
}

async function promptForBashCall(
	ctx: ExtensionContext,
	loaded: LoadedRules,
	fullCommand: string,
	aggregate: Extract<BashAggregate, { kind: "review" }>,
): Promise<{ allow: boolean; reason?: string }> {
	const overview = renderLeafOverview(aggregate.allLeaves);
	const pendingCount = aggregate.pending.length;
	const groups = groupPendingByPattern(aggregate.pending);

	const header =
		`Bash command has ${pendingCount} subcommand(s) without a matching allow rule:\n\n${overview}\n\n` +
		`Full command:\n  ${fullCommand.length > 400 ? `${fullCommand.slice(0, 397)}...` : fullCommand}`;

	const ALLOW_ONCE = "✅ Allow this whole call once";
	const ALLOW_SESSION_ALL = `✅ Allow all unmatched for this session (${groups.size} pattern${groups.size === 1 ? "" : "s"}, in-memory)`;
	const DENY_ONCE = "🛑 Deny this call";
	const SAVE_ALL = `📌 Save permanent allow rules for all unmatched (${groups.size} pattern${groups.size === 1 ? "" : "s"})`;
	const CONFIGURE = "🔧 Configure each unmatched subcommand individually…";

	const choice = await ctx.ui.select(header, [ALLOW_ONCE, ALLOW_SESSION_ALL, DENY_ONCE, SAVE_ALL, CONFIGURE]);
	if (!choice) return { allow: false, reason: "User dismissed permission prompt" };

	if (choice === ALLOW_ONCE) return { allow: true };
	if (choice === DENY_ONCE) return { allow: false, reason: "User denied this tool call" };

	if (choice === ALLOW_SESSION_ALL) {
		const patterns = [...groups.keys()];
		const errors: string[] = [];
		for (const pattern of patterns) {
			const err = addRule(loaded, "session", "allow", pattern);
			if (err) errors.push(`${pattern}: ${err}`);
		}
		if (errors.length > 0) {
			ctx.ui.notify(`allow-list: failed to save ${errors.length} session rule(s):\n${errors.join("\n")}`, "error");
			return { allow: false, reason: `Could not save session rules: ${errors[0]}` };
		}
		ctx.ui.notify(
			`allow-list: session-allowed ${patterns.length} pattern(s) for this run`,
			"info",
		);
		return { allow: true };
	}

	if (choice === SAVE_ALL) {
		const patterns = [...groups.keys()];
		const preview = patterns.map((p) => `  • ${p}`).join("\n");
		const confirmed = await ctx.ui.confirm(
			`Save these allow rules?`,
			`The following ${patterns.length} pattern(s) will be added:\n${preview}`,
		);
		if (!confirmed) return { allow: false, reason: "User cancelled rule save" };

		const scope = await pickScope(ctx);
		if (!scope) return { allow: false, reason: "No scope selected" };

		const errors: string[] = [];
		for (const pattern of patterns) {
			const err = addRule(loaded, scope, "allow", pattern);
			if (err) errors.push(`${pattern}: ${err}`);
		}
		if (errors.length > 0) {
			ctx.ui.notify(`allow-list: failed to save ${errors.length} rule(s):\n${errors.join("\n")}`, "error");
			return { allow: false, reason: `Could not save rules: ${errors[0]}` };
		}
		ctx.ui.notify(
			`allow-list: saved ${patterns.length} allow rule(s) to ${SCOPE_LABEL[scope]}`,
			"info",
		);
		return { allow: true };
	}

	// Configure each unmatched leaf individually. Group by pattern so duplicates
	// (e.g. two `go env GOWORK` in one call) only ask once.
	let anyDeny: string | undefined;
	for (const [, leafReviews] of groups) {
		const first = leafReviews[0]!;
		const result = await configureLeafIndividually(ctx, loaded, first.leaf, first.decision);
		if (!result.allow) {
			anyDeny = result.reason ?? `Subcommand denied: ${first.leaf.display}`;
			break;
		}
	}
	if (anyDeny) return { allow: false, reason: anyDeny };
	return { allow: true };
}

// --------------------------------------------------------------------------------------
// Subagent multi-leaf review prompt
// --------------------------------------------------------------------------------------

function renderSubagentOverview(allLeaves: SubagentLeafReview[]): string {
	const lines: string[] = [];
	for (const r of allLeaves) {
		const icon =
			r.decision?.verdict === "allow"
				? "✅"
				: r.decision?.verdict === "ask"
					? "❔"
					: r.decision?.verdict === "deny"
						? "🛑"
						: "❔";
		const rule = r.decision ? `  ← ${r.decision.rule} (${r.decision.scope})` : "";
		lines.push(`  ${icon} ${r.leaf.display}${rule}`);
	}
	return lines.join("\n");
}

async function promptForSubagentCall(
	ctx: ExtensionContext,
	loaded: LoadedRules,
	aggregate: Extract<SubagentAggregate, { kind: "review" }>,
): Promise<{ allow: boolean; reason?: string }> {
	const overview = renderSubagentOverview(aggregate.allLeaves);
	const pendingCount = aggregate.pending.length;

	// Group pending agents by suggested pattern. Each unique agent name maps
	// to one rule pattern, so duplicate entries (same agent invoked twice in
	// a chain) only produce one "save" entry.
	const pendingPatterns = new Map<string, SubagentLeafReview[]>();
	for (const r of aggregate.pending) {
		const pattern = `subagent(agent:${r.leaf.agent})`;
		const list = pendingPatterns.get(pattern) ?? [];
		list.push(r);
		pendingPatterns.set(pattern, list);
	}

	const form = aggregate.allLeaves[0]?.leaf.form ?? "single";
	const formLabel =
		form === "chain" ? "chain" : form === "tasks" ? "parallel call" : "call";

	const header =
		`Subagent ${formLabel} has ${pendingCount} agent invocation(s) without a matching allow rule:\n\n${overview}`;

	const ALLOW_ONCE = "✅ Allow this whole call once";
	const ALLOW_SESSION_ALL = `✅ Allow all unmatched agent(s) for this session (${pendingPatterns.size}, in-memory)`;
	const DENY_ONCE = "🛑 Deny this call";
	const SAVE_ALL = `📌 Save permanent allow rules for all unmatched agent(s) (${pendingPatterns.size})`;

	const choice = await ctx.ui.select(header, [ALLOW_ONCE, ALLOW_SESSION_ALL, DENY_ONCE, SAVE_ALL]);
	if (!choice) return { allow: false, reason: "User dismissed permission prompt" };

	if (choice === ALLOW_ONCE) return { allow: true };
	if (choice === DENY_ONCE) return { allow: false, reason: "User denied this tool call" };

	if (choice === ALLOW_SESSION_ALL) {
		const patterns = [...pendingPatterns.keys()];
		const errors: string[] = [];
		for (const pattern of patterns) {
			const err = addRule(loaded, "session", "allow", pattern);
			if (err) errors.push(`${pattern}: ${err}`);
		}
		if (errors.length > 0) {
			ctx.ui.notify(`allow-list: failed to save ${errors.length} session rule(s):\n${errors.join("\n")}`, "error");
			return { allow: false, reason: `Could not save session rules: ${errors[0]}` };
		}
		ctx.ui.notify(
			`allow-list: session-allowed ${patterns.length} agent pattern(s) for this run`,
			"info",
		);
		return { allow: true };
	}

	// SAVE_ALL
	const patterns = [...pendingPatterns.keys()];
	const preview = patterns.map((p) => `  • ${p}`).join("\n");
	const confirmed = await ctx.ui.confirm(
		`Save these allow rules?`,
		`The following ${patterns.length} pattern(s) will be added:\n${preview}`,
	);
	if (!confirmed) return { allow: false, reason: "User cancelled rule save" };

	const scope = await pickScope(ctx);
	if (!scope) return { allow: false, reason: "No scope selected" };

	const errors: string[] = [];
	for (const pattern of patterns) {
		const err = addRule(loaded, scope, "allow", pattern);
		if (err) errors.push(`${pattern}: ${err}`);
	}
	if (errors.length > 0) {
		ctx.ui.notify(`allow-list: failed to save ${errors.length} rule(s):\n${errors.join("\n")}`, "error");
		return { allow: false, reason: `Could not save rules: ${errors[0]}` };
	}
	ctx.ui.notify(
		`allow-list: saved ${patterns.length} allow rule(s) to ${SCOPE_LABEL[scope]}`,
		"info",
	);
	return { allow: true };
}

// --------------------------------------------------------------------------------------
// /permissions command helpers
// --------------------------------------------------------------------------------------

function listText(loaded: LoadedRules): string {
	const lines: string[] = [];
	for (const [scope, file, location] of [
		["session", loaded.session, "in-memory, this run only"],
		["project", loaded.project, loaded.projectPath],
		["global", loaded.global, loaded.globalPath],
	] as const) {
		const total = file.allow.length + file.ask.length + file.deny.length;
		lines.push(`── ${scope.toUpperCase()} ${location} (${total} rule${total === 1 ? "" : "s"}) ──`);
		for (const v of ["allow", "ask", "deny"] as const) {
			if (file[v].length === 0) continue;
			lines.push(`  ${VERDICT_LABEL[v]}:`);
			for (const r of file[v]) lines.push(`    • ${r}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

async function addRuleInteractive(ctx: ExtensionContext, loaded: LoadedRules): Promise<void> {
	const verdict = await pickVerdict(ctx);
	if (!verdict) return;
	const pattern = await ctx.ui.input(`Rule pattern for ${VERDICT_LABEL[verdict]}`, "");
	const trimmed = (pattern ?? "").trim();
	if (!trimmed) {
		ctx.ui.notify("No pattern entered", "warning");
		return;
	}
	if (!parseRule(trimmed)) {
		ctx.ui.notify(`Invalid rule pattern: ${trimmed}`, "error");
		return;
	}
	const scope = await pickScope(ctx);
	if (!scope) return;
	const err = addRule(loaded, scope, verdict, trimmed);
	if (err) {
		ctx.ui.notify(`allow-list: ${err}`, "error");
		return;
	}
	ctx.ui.notify(`Added ${VERDICT_LABEL[verdict]} ${trimmed} → ${SCOPE_LABEL[scope]}`, "info");
}

interface RuleRef {
	scope: Scope;
	verdict: Verdict;
	rule: string;
}

function flattenRules(loaded: LoadedRules): RuleRef[] {
	const out: RuleRef[] = [];
	for (const [scope, file] of [
		["session", loaded.session],
		["project", loaded.project],
		["global", loaded.global],
	] as const) {
		for (const v of ["deny", "ask", "allow"] as const) {
			for (const r of file[v]) out.push({ scope, verdict: v, rule: r });
		}
	}
	return out;
}

async function removeRuleInteractive(ctx: ExtensionContext, loaded: LoadedRules): Promise<void> {
	const flat = flattenRules(loaded);
	if (flat.length === 0) {
		ctx.ui.notify("No rules to remove", "info");
		return;
	}
	const labels = flat.map((r) => `[${r.scope}/${r.verdict}] ${r.rule}`);
	const choice = await ctx.ui.select("Remove which rule?", labels);
	if (!choice) return;
	const idx = labels.indexOf(choice);
	if (idx < 0) return;
	const ref = flat[idx]!;
	const ok = await ctx.ui.confirm("Remove?", choice);
	if (!ok) return;
	const err = removeRule(loaded, ref.scope, ref.verdict, ref.rule);
	if (err) {
		ctx.ui.notify(`allow-list: ${err}`, "error");
		return;
	}
	ctx.ui.notify(`Removed ${choice}`, "info");
}

/**
 * Render the decomposition of a bash command and the verdict each leaf would
 * receive against the loaded rule set. No side effects — this is a debug
 * helper for `/permissions decompose <cmd>`.
 */
function decomposeText(loaded: LoadedRules, command: string): string {
	if (!command.trim()) return "(no command provided)";
	let leaves: BashLeaf[];
	try {
		leaves = decomposeBash(command);
	} catch (e) {
		return `Tokenizer error: ${(e as Error).message}`;
	}
	if (leaves.length === 0) {
		return "No leaves extracted (empty command, all builtins, or all skipped).";
	}
	const lines: string[] = [];
	lines.push(`Decomposition of: ${command.length > 200 ? `${command.slice(0, 197)}...` : command}`);
	lines.push("");
	for (const leaf of leaves) {
		const d = decide(loaded, "Bash", { command: leaf.match });
		const icon = d?.verdict === "allow"
			? "✅"
			: d?.verdict === "deny"
				? "🛑"
				: d?.verdict === "ask"
					? "❔"
					: "❔";
		const depthMarker = leaf.depth > 0 ? `··${"·".repeat(leaf.depth - 1)} ` : "";
		const rule = d ? `  ← ${d.rule} (${d.scope})` : "  (no rule)";
		lines.push(`  ${icon} ${depthMarker}${leaf.display}${rule}`);
		if (leaf.match !== leaf.display) {
			lines.push(`       match: ${leaf.match}`);
		}
	}
	return lines.join("\n");
}

// --------------------------------------------------------------------------------------
// Extension entry point
// --------------------------------------------------------------------------------------

// Sentinel set in factory init so other extensions in the same parent
// process can detect at runtime that allow-list is loaded. The subagent
// extension reads this before spawning a child whose agent declared scoped
// tools; if it's missing, the spawn is refused because the patterns would
// otherwise silently no-op on the child side. Documented in the README of
// both extensions; see SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR below for the
// other half of the protocol.
export const ALLOW_LIST_ACTIVE_ENV_VAR = "PI_ALLOW_LIST_ACTIVE";

// Env-var carrying a per-spawn permission override. Used by the subagent
// extension to push the agent's frontmatter `tools:` list into allow-list's
// rule engine. Payload is JSON of shape `{ allow, ask, deny }` with
// string-array values — the same shape as a permission.json file.
//
// **Constrained-override mode.** When this env var is present:
//   - The override's `allow` list IS the only positive surface for this
//     run. Project + global allow rules are dropped (they're
//     pre-approvals for the user's own interactive runs, not part of an
//     agent's contract).
//   - Project + global `deny` and `ask` rules are INHERITED as a
//     defense-in-depth backstop. A user-level `deny: Bash(rm -rf:*)` will
//     bind inside the subagent even if the agent declared bare `bash`.
//
// Mechanically this is implemented by merging the inherited deny+ask
// rules into the session rule file alongside the override. We rely on
// `classify`'s within-file precedence (`deny > ask > allow`) so an
// inherited deny shadows an override allow without needing to change
// cross-scope resolution. project + global rule sets are then wiped to
// keep the resolution path session-only and self-contained.
export const SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR = "PI_SUBAGENT_PERMISSION_OVERRIDE";

function readSubagentOverride(): RuleFile | null {
	const raw = process.env[SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR];
	if (!raw) return null;
	try {
		const sanitized = sanitizeRuleFile(JSON.parse(raw));
		const total = sanitized.allow.length + sanitized.ask.length + sanitized.deny.length;
		return total > 0 ? sanitized : null;
	} catch {
		return null;
	}
}

// Build the effective session rule file for a subagent override:
//   - allow: override only (parent allows are NOT inherited)
//   - ask:   parent project+global ask ∪ override.ask
//   - deny:  parent project+global deny ∪ override.deny
// Deduped while preserving first-occurrence order so reading the rule
// list back is stable and the parent's safeguards appear before the
// agent's own entries.
export function buildConstrainedOverride(
	override: RuleFile,
	parentProject: RuleFile,
	parentGlobal: RuleFile,
): RuleFile {
	const uniq = (xs: string[]): string[] => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const x of xs) {
			if (seen.has(x)) continue;
			seen.add(x);
			out.push(x);
		}
		return out;
	};
	return {
		allow: [...override.allow],
		ask: uniq([...parentProject.ask, ...parentGlobal.ask, ...override.ask]),
		deny: uniq([...parentProject.deny, ...parentGlobal.deny, ...override.deny]),
	};
}

export default function (pi: ExtensionAPI) {
	// Mark allow-list active so the subagent extension's spawn-side check
	// (parent process) can verify presence before pushing scoped patterns.
	// Set unconditionally on factory entry, before any tool call can fire.
	process.env[ALLOW_LIST_ACTIVE_ENV_VAR] = "1";

	let rules: LoadedRules = loadAllRules(process.cwd());

	pi.on("session_start", async (_event, ctx) => {
		rules = loadAllRules(ctx.cwd);

		const checkErr = (p: string) => {
			if (!fs.existsSync(p)) return;
			const { error } = readRuleFile(p);
			if (error) ctx.ui.notify(`allow-list: failed to parse ${p}: ${error}`, "warning");
		};
		checkErr(rules.globalPath);
		checkErr(rules.projectPath);

		// Per-spawn override from the subagent extension. Constrained-override
		// mode: the override's allow list is the only positive surface, but
		// project + global deny+ask rules are inherited as a defense-in-depth
		// backstop (e.g. a user-level `deny: Bash(rm -rf:*)` still binds).
		// We merge inherited deny+ask into the session rule file so within-
		// file precedence (deny > ask > allow in classify) handles shadowing
		// without changing cross-scope resolution. project + global are then
		// wiped to make resolution session-only and self-contained.
		// Reading from process.env (not from a session field on `event`)
		// keeps allow-list decoupled from the subagent extension at the type
		// level — the contract is just an env var name and a JSON shape,
		// both documented above and in both extensions' READMEs.
		const override = readSubagentOverride();
		let inheritedDenyCount = 0;
		let inheritedAskCount = 0;
		if (override) {
			const merged = buildConstrainedOverride(override, rules.project, rules.global);
			inheritedDenyCount = merged.deny.length - override.deny.length;
			inheritedAskCount = merged.ask.length - override.ask.length;
			rules.global = EMPTY_FILE();
			rules.project = EMPTY_FILE();
			rules.session = merged;
		}

		publishLoadedRules(rules);

		if (override) {
			const sessionTotal =
				rules.session.allow.length + rules.session.ask.length + rules.session.deny.length;
			const inheritedNote =
				inheritedDenyCount + inheritedAskCount > 0
					? `; inherited ${inheritedDenyCount} deny + ${inheritedAskCount} ask from project/global`
					: "; no parent deny/ask to inherit";
			ctx.ui.notify(
				`allow-list: constrained subagent override active (${sessionTotal} rule(s)${inheritedNote})`,
				"info",
			);
		} else {
			const total =
				rules.global.allow.length +
				rules.global.ask.length +
				rules.global.deny.length +
				rules.project.allow.length +
				rules.project.ask.length +
				rules.project.deny.length;
			if (total > 0) {
				ctx.ui.notify(`allow-list: ${total} rule(s) loaded`, "info");
			}
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		const canon = canonicalToolName(event.toolName);

		// Bash: try the multi-leaf decomposition first, so chained commands
		// (`cd … && go build`) can be approved out of existing rules.
		if (canon === "Bash") {
			const command = typeof (event.input as any)?.command === "string"
				? ((event.input as any).command as string)
				: "";
			const aggregate = decideBash(rules, command, ctx.cwd);

			if (aggregate.kind === "allow") return undefined;

			if (aggregate.kind === "deny") {
				return {
					block: true,
					reason:
						`allow-list deny rule "${aggregate.rule}" (${aggregate.scope}) ` +
						`matched subcommand: ${aggregate.leaf.display}`,
				};
			}

			// review path
			// Unknown-under-override: block hard if any pending leaf has no rule
			// match.  Only inherited ask rules (decision !== null) proceed to the
			// prompt path (design decision #2 in todo_implement_rpc_agent.md).
			if (process.env[SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR]) {
				const unknownLeaf = aggregate.pending.find((r) => r.decision === null);
				if (unknownLeaf) {
					return {
						block: true,
						reason: `Bash subcommand "${unknownLeaf.leaf.display}" is not declared in the agent's tools list. Subagents may only use tools their frontmatter explicitly grants.`,
					};
				}
			}
			if (!ctx.hasUI) {
				const preview = aggregate.pending
					.map((r) => `  • ${r.leaf.display}`)
					.join("\n");
				return {
					block: true,
					reason:
						`allow-list: ${aggregate.pending.length} subcommand(s) need confirmation and no UI is available:\n${preview}`,
				};
			}

			// Heads-up via notify.ts when the kitty/iTerm window isn't focused.
			pi.events.emit("notify:attention", {
				title: "pi",
				body: `Permission needed: bash (${aggregate.pending.length} subcommand${aggregate.pending.length === 1 ? "" : "s"})`,
			});

			const result = await withQuietUI(ctx, () =>
				promptForBashCall(ctx, rules, command, aggregate),
			);
			if (result.allow) return undefined;
			return { block: true, reason: result.reason ?? "Blocked by allow-list" };
		}

		// Subagent: per-leaf decomposition for single / tasks / chain shapes,
		// aggregated like Bash chains so a chain whose every entry is allowed
		// by *some* rule passes without prompting.
		if (canon.toLowerCase() === "subagent") {
			const aggregate = decideSubagent(rules, event.input);

			if (aggregate.kind === "allow") return undefined;

			if (aggregate.kind === "deny") {
				return {
					block: true,
					reason:
						`allow-list deny rule "${aggregate.rule}" (${aggregate.scope}) ` +
						`matched: ${aggregate.leaf.display}`,
				};
			}

			if (aggregate.kind === "review") {
				// Unknown-under-override: block hard if any pending leaf has no rule
				// match.  Only inherited ask rules (decision !== null) proceed to the
				// prompt path (design decision #2 in todo_implement_rpc_agent.md).
				if (process.env[SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR]) {
					const unknownLeaf = aggregate.pending.find((r) => r.decision === null);
					if (unknownLeaf) {
						return {
							block: true,
							reason: `Subagent call "${unknownLeaf.leaf.display}" is not declared in the agent's tools list. Subagents may only use tools their frontmatter explicitly grants.`,
						};
					}
				}
				if (!ctx.hasUI) {
					const preview = aggregate.pending
						.map((r) => `  • ${r.leaf.display}`)
						.join("\n");
					return {
						block: true,
						reason:
							`allow-list: ${aggregate.pending.length} agent invocation(s) need confirmation and no UI is available:\n${preview}`,
					};
				}

				pi.events.emit("notify:attention", {
					title: "pi",
					body: `Permission needed: subagent (${aggregate.pending.length} agent${aggregate.pending.length === 1 ? "" : "s"})`,
				});

				const result = await withQuietUI(ctx, () =>
					promptForSubagentCall(ctx, rules, aggregate),
				);
				if (result.allow) return undefined;
				return { block: true, reason: result.reason ?? "Blocked by allow-list" };
			}
			// kind === "passthrough" → no agent fields extractable; fall through
			// to the legacy generic decide path below so bare `subagent` rules
			// still work.
		}

		// Non-Bash tools: legacy single-call classification.
		const decision = decide(rules, event.toolName, event.input);

		if (decision?.verdict === "allow") return undefined;

		if (decision?.verdict === "deny") {
			return {
				block: true,
				reason: `allow-list deny rule "${decision.rule}" (${decision.scope})`,
			};
		}

		// Unknown-under-override: the agent's declared tools are its only positive
		// permission surface. Anything not declared is not granted — block hard
		// without prompting (design decision #2 in todo_implement_rpc_agent.md).
		// Only inherited ask rules (non-null decision with verdict="ask") should
		// ever reach the UI prompt path below.
		if (decision === null && process.env[SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR]) {
			return {
				block: true,
				reason: `Tool "${event.toolName}" is not declared in the agent's tools list. Subagents may only use tools their frontmatter explicitly grants.`,
			};
		}

		// ask or unknown → need user confirmation
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: decision
					? `allow-list ask rule "${decision.rule}" requires confirmation; no UI available`
					: "allow-list: no rule matches this tool call and no UI available for confirmation",
			};
		}

		pi.events.emit("notify:attention", {
			title: "pi",
			body: decision
				? `Permission needed: ${event.toolName} (ask rule)`
				: `Permission needed: ${event.toolName}`,
		});

		const result = await withQuietUI(ctx, () => promptForCall(ctx, rules, event.toolName, event.input, decision));
		if (result.allow) return undefined;
		return { block: true, reason: result.reason ?? "Blocked by allow-list" };
	});

	pi.registerCommand("permissions", {
		description: "View and manage allow-list permission rules",
		handler: async (args, ctx) => {
			await withQuietUI(ctx, async () => {
			const trimmed = (args ?? "").trim();
			let action = trimmed.split(/\s+/)[0] || "";

			if (!action) {
				const choice = await ctx.ui.select("Permissions:", [
					"List rules",
					"Add rule",
					"Remove rule",
					"Reload from disk",
					"Decompose bash command (debug)",
				]);
				if (!choice) return;
				if (choice === "List rules") action = "list";
				else if (choice === "Add rule") action = "add";
				else if (choice === "Remove rule") action = "remove";
				else if (choice === "Reload from disk") action = "reload";
				else if (choice === "Decompose bash command (debug)") action = "decompose";
			}

			switch (action) {
				case "list":
					ctx.ui.notify(listText(rules), "info");
					return;
				case "add":
					await addRuleInteractive(ctx, rules);
					return;
				case "remove":
					await removeRuleInteractive(ctx, rules);
					return;
				case "reload":
					rules = loadAllRules(ctx.cwd);
					ctx.ui.notify("allow-list: rules reloaded from disk (JSON only; restart pi for code changes)", "info");
					return;
				case "decompose": {
					// `args` is the raw text after `decompose `; strip the leading
					// action word if it was passed inline.
					const inline = trimmed.replace(/^decompose\s*/i, "").trim();
					let cmd = inline;
					if (!cmd) {
						const typed = await ctx.ui.input("Bash command to decompose", "");
						cmd = (typed ?? "").trim();
					}
					if (!cmd) {
						ctx.ui.notify("No command provided", "warning");
						return;
					}
					ctx.ui.notify(decomposeText(rules, cmd), "info");
					return;
				}
				default:
					ctx.ui.notify(
						`Unknown action: ${action}. Use list|add|remove|reload|decompose`,
						"warning",
					);
			}
			});
		},
	});
}
