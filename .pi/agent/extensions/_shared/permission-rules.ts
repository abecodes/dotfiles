/**
 * permission-rules — shared rule grammar + matcher.
 *
 * Extracted from the allow-list extension so multiple extensions can speak the
 * same Claude-Code-style rule language without re-implementing the parser /
 * matcher / decomposer. Current consumers:
 *   - allow-list  (interactive enforcement, file IO, prompts)
 *   - subagent    (serializes agent-frontmatter patterns into rule strings
 *                  and ships them to the spawned child via env var, where
 *                  allow-list merges them into its session rule set)
 *
 * Lives in _shared/ for the same reason as bash-parse.ts: not auto-discovered
 * by pi (path doesn't match the extension globs), so it sits as a plain
 * module that other extensions import.
 *
 * Contract:
 *   - parseRule:  raw string ("Bash(go test:*)") -> ParsedRule | null
 *   - ruleMatches: ParsedRule × tool name × tool input -> boolean
 *   - classify / decide / decideBash: aggregate rule files into a verdict.
 *
 * Anything that touches disk, prompts the user, or knows about subagent
 * specifics stays in allow-list. This module is pure.
 */

import * as path from "node:path";
import { type BashLeaf, decomposeBash } from "./bash-parse.ts";

// --------------------------------------------------------------------------------------
// Public types
// --------------------------------------------------------------------------------------

export type Verdict = "allow" | "ask" | "deny";
export type Scope = "global" | "project" | "session";

export interface RuleFile {
	allow: string[];
	ask: string[];
	deny: string[];
}

export interface LoadedRules {
	global: RuleFile;
	project: RuleFile;
	/** In-memory only — populated via the "Allow for this session" prompt option,
	 * or by external extensions injecting per-session overrides on session_start.
	 * Never written to disk. */
	session: RuleFile;
	globalPath: string;
	projectPath: string;
}

export interface ParsedRule {
	raw: string;
	/** Canonical tool name as written by the user, e.g. "Bash". Comparisons are
	 * case-insensitive (see ruleMatches). */
	tool: string;
	/** Contents inside the top-level parens, undefined for bare-name rules
	 * like "Edit" or "Read". */
	body?: string;
}

export interface Decision {
	verdict: Verdict;
	rule: string;
	scope: Scope;
}

export interface LeafReview {
	leaf: BashLeaf;
	decision: Decision | null; // null = no rule matches
}

export type BashAggregate =
	| { kind: "allow" }
	| { kind: "deny"; rule: string; scope: Scope; leaf: BashLeaf }
	| { kind: "review"; allLeaves: LeafReview[]; pending: LeafReview[] };

// --------------------------------------------------------------------------------------
// Tool-name canonicalization
// --------------------------------------------------------------------------------------

/** Pi's lowercase built-in tool names → Claude-style canonical name used in rules. */
export const TOOL_ALIASES: Record<string, string> = {
	bash: "Bash",
	read: "Read",
	write: "Write",
	edit: "Edit",
	grep: "Grep",
	find: "Find",
	ls: "List",
};

export function canonicalToolName(name: string): string {
	const lower = name.toLowerCase();
	return TOOL_ALIASES[lower] ?? name;
}

// --------------------------------------------------------------------------------------
// Empty rule helpers
// --------------------------------------------------------------------------------------

export function emptyRuleFile(): RuleFile {
	return { allow: [], ask: [], deny: [] };
}

// --------------------------------------------------------------------------------------
// Tilde expansion (for path-valued key:value rules)
// --------------------------------------------------------------------------------------

/**
 * Expand a leading `~` / `~/` to the user's home directory. Unlike a generic
 * shell expansion, only the leading-tilde forms are handled — `~user` and
 * embedded `~` are left literal because expanding them would require an async
 * lookup we don't want here. Callable with any string; non-tilde input passes
 * through unchanged so existing rules and inputs aren't perturbed.
 *
 * Imported by ruleMatches so a rule `Edit(path:~/.pi/agent/AGENTS.md)` matches
 * whether the tool was called with the tilde form or the absolute form.
 */
export function expandHome(s: string, homedir: string): string {
	if (s === "~") return homedir;
	if (s.startsWith("~/")) {
		// path.join would pull in node:path; do it manually since this is hot.
		const tail = s.slice(2);
		if (homedir.endsWith("/")) return homedir + tail;
		return `${homedir}/${tail}`;
	}
	return s;
}

// --------------------------------------------------------------------------------------
// Rule parsing
// --------------------------------------------------------------------------------------

/**
 * Parse a rule string of the form `Tool` or `Tool(...)`. The body regex is
 * greedy on purpose — it captures everything between the first "(" and the
 * last ")" so nested parens (e.g. `Task(Bash(git diff:*))`) survive.
 */
export function parseRule(raw: string): ParsedRule | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const m = trimmed.match(/^([A-Za-z_][\w]*)(?:\((.*)\))?$/s);
	if (!m) return null;
	return { raw: trimmed, tool: m[1]!, body: m[2] };
}

// --------------------------------------------------------------------------------------
// Bash body matching
// --------------------------------------------------------------------------------------

/**
 *   "rm:*"             → prefix "rm" + boundary (so "rmdir" doesn't match)
 *   "git diff:*"       → prefix "git diff" + boundary
 *   "./:*"             → literal "./" prefix (no boundary required because the
 *                        prefix doesn't end on a word char)
 *   "docker --version" → exact match
 */
export function bashBodyMatches(body: string, command: string): boolean {
	const cmd = command.trim();
	if (body.endsWith(":*")) {
		const prefix = body.slice(0, -2).trim();
		if (!prefix) return true;
		if (cmd === prefix) return true;
		if (!cmd.startsWith(prefix)) return false;
		// Require a shell-token boundary after the prefix only if the prefix ends in a word char.
		if (/\w$/.test(prefix)) {
			const next = cmd[prefix.length];
			return next === undefined || /[\s;|&]/.test(next);
		}
		return true;
	}
	return cmd === body.trim();
}

// --------------------------------------------------------------------------------------
// Generic Tool(key:value) matching for non-Bash / non-WebFetch tools
// --------------------------------------------------------------------------------------

/**
 * Generic `Tool(key:value)` matcher for tools whose input is a structured
 * object. Used as the fallback after the Bash / WebFetch / Task special cases.
 *
 * Matches in three shapes, all top-level only (no dotted paths):
 *   1. `input[key] === value` (single-form calls, e.g. `subagent({agent: "scout"})`)
 *   2. Every entry in `input.tasks[]` has `[key] === value` (parallel form)
 *   3. Every entry in `input.chain[]` has `[key] === value` (chain form)
 *
 * `mode`:
 *   - "all": every entry must match. Used for allow/ask rules so a mixed call
 *           like `[scout, worker]` does NOT count as "all-scout" → falls
 *           through to a stricter rule or the prompt.
 *   - "any": any entry matching is enough. Used for deny rules so a single
 *           disallowed entry blocks the whole call.
 *
 * Both sides are run through `expandHome` before comparison so a path-valued
 * rule matches whether the tool was called with the tilde form or the
 * absolute form.
 */
export function argKeyValueMatches(
	input: unknown,
	key: string,
	value: string,
	mode: "any" | "all",
	homedir: string,
): boolean {
	const obj = input as Record<string, unknown> | null | undefined;
	if (!obj || typeof obj !== "object") return false;

	const expected = expandHome(value, homedir);

	const direct = obj[key];
	if (typeof direct === "string") return expandHome(direct, homedir) === expected;

	for (const aggKey of ["tasks", "chain"] as const) {
		const arr = obj[aggKey];
		if (Array.isArray(arr) && arr.length > 0) {
			const check = (entry: unknown) => {
				const v = (entry as Record<string, unknown> | null)?.[key];
				return typeof v === "string" && expandHome(v, homedir) === expected;
			};
			return mode === "any" ? arr.some(check) : arr.every(check);
		}
	}

	return false;
}

// --------------------------------------------------------------------------------------
// Rule × tool-call matching
// --------------------------------------------------------------------------------------

export function ruleMatches(
	rule: ParsedRule,
	toolName: string,
	input: unknown,
	mode: "any" | "all",
	homedir: string,
): boolean {
	if (rule.tool.toLowerCase() !== toolName.toLowerCase()) return false;
	if (rule.body === undefined) return true; // bare "Edit" / "Read" matches anything

	const canon = canonicalToolName(toolName);

	if (canon === "Bash") {
		const cmd =
			typeof (input as { command?: unknown })?.command === "string"
				? ((input as { command: string }).command)
				: "";
		return bashBodyMatches(rule.body, cmd);
	}

	if (canon === "WebFetch") {
		const colon = rule.body.indexOf(":");
		if (colon > 0) {
			const key = rule.body.slice(0, colon).trim();
			const value = rule.body.slice(colon + 1).trim();
			if (key === "domain") {
				const url =
					typeof (input as { url?: unknown })?.url === "string" ? ((input as { url: string }).url) : "";
				try {
					const host = new URL(url).hostname.toLowerCase();
					const want = value.toLowerCase();
					return host === want || host.endsWith(`.${want}`);
				} catch {
					return false;
				}
			}
		}
		// Unknown qualifier syntax: substring against URL.
		const url = typeof (input as { url?: unknown })?.url === "string" ? ((input as { url: string }).url) : "";
		return url.includes(rule.body);
	}

	if (canon === "Task") {
		// Recursive: Task(Edit), Task(Bash(git:*)). Pi has no Task tool, so this only fires if a custom Task tool exists.
		const inner = parseRule(rule.body);
		if (!inner) return false;
		// We don't know the inner sub-tool's input here; permissively match if the inner rule has no body.
		return inner.body === undefined && inner.tool.toLowerCase() === toolName.toLowerCase();
	}

	// Generic key:value matcher (e.g. `subagent(agent:scout)`).
	const colon = rule.body.indexOf(":");
	if (colon > 0) {
		const key = rule.body.slice(0, colon).trim();
		const value = rule.body.slice(colon + 1).trim();
		if (key && value) return argKeyValueMatches(input, key, value, mode, homedir);
	}
	return false;
}

// --------------------------------------------------------------------------------------
// Classification (single rule file)
// --------------------------------------------------------------------------------------

/**
 * Most-restrictive-wins within a single rule file: deny > ask > allow. `mode`
 * differs for deny vs. ask/allow so aggregated calls (subagent parallel/chain)
 * are denied if ANY entry triggers a deny rule but only allowed/asked if ALL
 * entries match.
 */
export function classify(
	rules: RuleFile,
	toolName: string,
	input: unknown,
	homedir: string,
): { verdict: Verdict; rule: string } | null {
	const order: Verdict[] = ["deny", "ask", "allow"];
	for (const v of order) {
		const mode: "any" | "all" = v === "deny" ? "any" : "all";
		for (const raw of rules[v]) {
			const r = parseRule(raw);
			if (!r) continue;
			if (ruleMatches(r, toolName, input, mode, homedir)) return { verdict: v, rule: raw };
		}
	}
	return null;
}

// --------------------------------------------------------------------------------------
// Multi-scope decision: session > project > global
// --------------------------------------------------------------------------------------

/**
 * Session wins so a just-now "allow for this session" decision (or a per-spawn
 * permission override injected by another extension) always applies for the
 * rest of the run, even when an outdated project file lacks the rule.
 */
export function decide(
	loaded: LoadedRules,
	toolName: string,
	input: unknown,
	homedir: string,
): Decision | null {
	const session = classify(loaded.session, toolName, input, homedir);
	if (session) return { ...session, scope: "session" };
	const project = classify(loaded.project, toolName, input, homedir);
	if (project) return { ...project, scope: "project" };
	const global = classify(loaded.global, toolName, input, homedir);
	if (global) return { ...global, scope: "global" };
	return null;
}

// --------------------------------------------------------------------------------------
// Bash command decomposition + per-leaf aggregation
// --------------------------------------------------------------------------------------

/**
 * If `match` starts with a relative-path program token (`./foo`, `../foo`,
 * `bin/foo`), return a copy of the command with that token replaced by its
 * cwd-resolved absolute path. Returns null when the first token is already
 * absolute (`/foo`, `~/foo`) or is a bare PATH name (`go`, `git`).
 *
 * Used as a second-chance match in decideBash: if a leaf has no rule match
 * with its original (relative) form but the user has an absolute-path allow
 * rule for the same script, this lets the rule bind. Quoted paths with
 * embedded spaces aren't handled — simple whitespace split is enough for
 * the common case.
 */
function expandRelativeProgram(match: string, cwd: string): string | null {
	const trimmed = match.trimStart();
	if (!trimmed) return null;
	const wsIdx = trimmed.search(/\s/);
	const first = wsIdx === -1 ? trimmed : trimmed.slice(0, wsIdx);
	const rest = wsIdx === -1 ? "" : trimmed.slice(wsIdx);
	if (!first.includes("/")) return null; // PATH lookup, not a path
	if (first.startsWith("/") || first.startsWith("~/") || first === "~") return null;
	const absolute = path.resolve(cwd, first);
	if (absolute === first) return null;
	return absolute + rest;
}

/**
 * Decompose a Bash command (using the shared bash-parse tokenizer, which
 * already handles `;`, `&&`, `||`, `|`, `&`, `$(…)`, `<(…)`, heredocs,
 * `for`/`while`/`if` constructs, etc.) and aggregate per-leaf verdicts:
 *
 *   - any leaf denied (anywhere, including in $(...)) → deny the call
 *   - all leaves allowed → allow the call
 *   - otherwise (some unknown or ask) → return the leaves needing user review
 *
 * When `cwd` is provided, leaves whose first token is a relative path get a
 * second-chance classification with that token resolved to absolute, so an
 * absolute-path allow rule can bind on a relatively-invoked command. Only
 * applied when the first attempt returned no rule match — a deny or ask on
 * the original form is honored as-is.
 *
 * If decomposition produces zero leaves (empty command, all builtins) the call
 * is allowed.
 */
export function decideBash(
	loaded: LoadedRules,
	command: string,
	homedir: string,
	cwd?: string,
): BashAggregate {
	let leaves: BashLeaf[];
	try {
		leaves = decomposeBash(command);
	} catch {
		// Tokenizer failure → fall back to a single "leaf" that is the whole command.
		const trimmed = command.trim();
		leaves = [{ display: trimmed, match: trimmed, depth: 0 }];
	}

	if (leaves.length === 0) return { kind: "allow" };

	const reviews: LeafReview[] = leaves.map((leaf) => {
		let d = decide(loaded, "Bash", { command: leaf.match }, homedir);
		if (d === null && cwd) {
			const expanded = expandRelativeProgram(leaf.match, cwd);
			if (expanded !== null) {
				d = decide(loaded, "Bash", { command: expanded }, homedir);
			}
		}
		return { leaf, decision: d };
	});

	for (const r of reviews) {
		if (r.decision?.verdict === "deny") {
			return {
				kind: "deny",
				rule: r.decision.rule,
				scope: r.decision.scope,
				leaf: r.leaf,
			};
		}
	}

	const pending = reviews.filter((r) => r.decision?.verdict !== "allow");
	if (pending.length === 0) return { kind: "allow" };
	return { kind: "review", allLeaves: reviews, pending };
}

// --------------------------------------------------------------------------------------
// Rule-file sanitization (used by both file-IO and env-var ingestion)
// --------------------------------------------------------------------------------------

/**
 * Coerce an untrusted rule-file-shaped value (parsed JSON, env var payload)
 * into a clean RuleFile. Drops non-string entries, non-array verdicts, and
 * unknown top-level keys. Always returns a fresh object — safe to mutate.
 */
export function sanitizeRuleFile(raw: unknown): RuleFile {
	const out = emptyRuleFile();
	if (!raw || typeof raw !== "object") return out;
	const obj = raw as Record<string, unknown>;
	for (const v of ["allow", "ask", "deny"] as const) {
		const arr = obj[v];
		if (Array.isArray(arr)) {
			out[v] = arr.filter((x): x is string => typeof x === "string" && x.length > 0);
		}
	}
	return out;
}
