// ---------------------------------------------------------------------------
// Pure helpers for the subagent extension.
//
// Lives in its own file so plain `node --test` can import them without
// resolving pi's bundled packages (same trick as depth.ts). No side-effects,
// no third-party imports.
// ---------------------------------------------------------------------------

// Cap the per-step previous-output that gets substituted into the next chain
// step's task. Without this, a verbose locator can produce 200KB+ of text
// that overflows the next agent's context budget on the first turn.
export const MAX_CHAIN_PREVIOUS_OUTPUT_CHARS = 100_000;

// Cap accumulated stderr per subagent at 64 KB. Misbehaving children that
// stream MB of warnings would otherwise blow the parent's heap because we
// hold the whole buffer in memory until the result returns.
export const MAX_STDERR_BYTES = 64 * 1024;

const STDERR_TRUNCATION_MARKER = "\n[… stderr truncated …]\n";

export function truncatePreviousOutput(text: string, max = MAX_CHAIN_PREVIOUS_OUTPUT_CHARS): string {
	if (text.length <= max) return text;
	const dropped = text.length - max;
	return `${text.slice(0, max)}\n\n[… truncated ${dropped} chars from previous step output …]`;
}

export function appendBoundedStderr(current: string, chunk: string, max = MAX_STDERR_BYTES): string {
	if (current.length >= max) {
		return current.endsWith(STDERR_TRUNCATION_MARKER) ? current : current + STDERR_TRUNCATION_MARKER;
	}
	const combined = current + chunk;
	if (combined.length <= max) return combined;
	return combined.slice(0, max) + STDERR_TRUNCATION_MARKER;
}

// Strip a trailing \r so CRLF-terminated stdout (Windows / some transports)
// parses as JSON cleanly. Returns the original string if nothing to strip.
export function stripCarriageReturn(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// ---------------------------------------------------------------------------
// Thinking-level frontmatter coercion. Mirrored locally rather than imported
// from @earendil-works/pi-agent-core so this module stays loadable from the
// dep-free test harness (same reason parseToolEntries lives here).
// ---------------------------------------------------------------------------

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

/**
 * Coerce a frontmatter value to a valid ThinkingLevel.
 *
 * Accepts strings only (case-insensitive, trimmed). Anything else — unknown
 * level, empty string, non-string — yields undefined so the spawn falls back
 * to the parent's default rather than passing garbage to `pi --thinking`,
 * which would error out the child.
 */
export function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase() as ThinkingLevel;
	return VALID_THINKING_LEVELS.includes(normalized) ? normalized : undefined;
}

// ---------------------------------------------------------------------------
// Public spawn result shape. Produced by spawnSubagent (index.ts) and
// re-exported by command-runner/c-api.ts as part of the `c.agent` contract.
// Defined here in the dep-free module so the type lives with its producer
// (subagent), not its consumer (command-runner) — the dependency runs
// command-runner -> subagent, never the reverse.
// ---------------------------------------------------------------------------

/** Per-call usage receipt, summed the same way the subagent tool sums it. */
export interface AgentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

/** What a single spawnSubagent / `c.agent(...)` call resolves to. */
export interface AgentResult {
	/** false on non-zero exit, timeout, abort, or stopReason "error"/"aborted". */
	ok: boolean;
	/** Final assistant text — the value scripts normally consume. */
	text: string;
	/** Present when ok === false. */
	error?: string;
	agent?: string;
	model?: string;
	usage: AgentUsage;
}

/**
 * Minimal structural view of a finished spawn that `toAgentResult` consumes.
 * Kept dep-free (a subset of index.ts's internal SingleResult, with the final
 * assistant text pre-extracted) so the mapping stays unit-testable without
 * importing the heavy orchestration module.
 */
export interface SpawnOutcome {
	exitCode: number;
	stopReason?: string;
	/** Final assistant text already extracted from the child's messages. */
	text: string;
	agent?: string;
	model?: string;
	errorMessage?: string;
	stderr: string;
	usage: AgentUsage;
}

/**
 * Pure mapping from a finished spawn to the public AgentResult. `ok` is false
 * on a non-zero exit or a terminal stopReason of "error"/"aborted"; on failure
 * `error` falls back errorMessage -> stderr -> a synthesized exit-code string.
 */
export function toAgentResult(o: SpawnOutcome): AgentResult {
	const ok = o.exitCode === 0 && o.stopReason !== "error" && o.stopReason !== "aborted";
	const result: AgentResult = {
		ok,
		text: o.text,
		usage: {
			input: o.usage.input,
			output: o.usage.output,
			cacheRead: o.usage.cacheRead,
			cacheWrite: o.usage.cacheWrite,
			cost: o.usage.cost,
			contextTokens: o.usage.contextTokens,
			turns: o.usage.turns,
		},
	};
	if (o.agent) result.agent = o.agent;
	if (o.model) result.model = o.model;
	if (!ok) {
		result.error =
			o.errorMessage ||
			o.stderr.trim() ||
			`agent exited with code ${o.exitCode}${o.stopReason ? ` (stopReason: ${o.stopReason})` : ""}`;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Model alias resolution. Lets agent frontmatter say `model: portkey/claude-opus`
// and have it expand to the latest concrete version the provider actually
// offers (e.g. `portkey/claude-opus-4-8`), while `model: portkey/claude-opus-4-8`
// is passed through verbatim. Resolved against the live model registry so new
// versions are picked up with zero edits.
//
// Kept dep-free (structural registry type) so it stays unit-testable without
// booting pi: any object exposing getAll(): { id, provider }[] works.
// ---------------------------------------------------------------------------

type RegistryModelLite = { id: string; provider: string };
export type ModelRegistryLite = { getAll(): RegistryModelLite[] };

// Parse the version tail after a family prefix (e.g. "4-8" or "4-1-20250805")
// into a numeric tuple. Stops at the first non-numeric segment. A segment of
// >=5 digits is treated as a date-stamped snapshot (YYYYMMDD) and flags the id
// as `dated` so clean aliases win over pinned snapshots.
function parseVersionTail(rest: string): { nums: number[]; dated: boolean } {
	const nums: number[] = [];
	let dated = false;
	for (const seg of rest.split("-")) {
		if (!/^[0-9]+$/.test(seg)) break;
		if (seg.length >= 5) dated = true;
		nums.push(Number(seg));
	}
	return { nums, dated };
}

// Tuple compare, missing trailing components treated as 0 (so 4-8 > 4 > 4-0... ).
function compareVersionTuples(a: number[], b: number[]): number {
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Resolve a possibly-aliased model string against the registry.
 *
 * - `provider/family` (no concrete match) -> latest `provider/family-<ver>`
 *   that THAT provider offers (provider-scoped, so we never claim a version the
 *   provider doesn't actually serve).
 * - bare `family` -> latest `family-<ver>` id across all providers (the version
 *   lives in the id, which is shared across providers), returned bare.
 * - already-concrete ids and unknown/typo'd values are returned unchanged.
 *
 * Clean versions are preferred over date-stamped snapshots of the same family.
 * Returns `model` untouched when there's no registry, no `/`-less id, or no
 * candidate match.
 */
export function resolveModelAlias(
	model: string | undefined,
	registry: ModelRegistryLite | undefined,
): string | undefined {
	if (!model || !registry) return model;

	const slash = model.indexOf("/");
	const provider = slash >= 0 ? model.slice(0, slash) : undefined;
	const idPart = slash >= 0 ? model.slice(slash + 1) : model;
	if (!idPart) return model;

	let all: RegistryModelLite[];
	try {
		all = registry.getAll() ?? [];
	} catch {
		return model; // registry blew up; don't block the spawn
	}
	const inScope = (m: RegistryModelLite) => provider === undefined || m.provider === provider;

	// Already a concrete model id? Pass through.
	if (all.some((m) => m.id === idPart && inScope(m))) return model;

	// Treat idPart as a family prefix: "<family>-<numeric version...>".
	const prefix = `${idPart}-`;
	const candidates = all.filter(
		(m) => inScope(m) && m.id.startsWith(prefix) && /^[0-9]/.test(m.id.slice(prefix.length)),
	);
	if (candidates.length === 0) return model; // unknown/typo: leave as authored

	const parsed = candidates.map((m) => ({ m, ...parseVersionTail(m.id.slice(prefix.length)) }));
	const clean = parsed.filter((p) => !p.dated);
	const pool = clean.length > 0 ? clean : parsed;
	let best = pool[0];
	for (const p of pool) {
		if (compareVersionTuples(p.nums, best.nums) > 0) best = p;
	}

	return provider !== undefined ? `${provider}/${best.m.id}` : best.m.id;
}

// `tools` in agent frontmatter may be authored as either a comma-separated
// string ("read, grep") or a YAML list (`tools: [read, grep]`). Some YAML
// parsers preserve the array shape; others stringify it. Handle both, and
// ignore anything else.
//
// Returns bare tool names (no scoping syntax). Use parseToolEntries() to keep
// the per-tool patterns from `bash(go test:*)` style entries.
export function normalizeTools(raw: unknown): string[] | undefined {
	const entries = parseToolEntries(raw);
	if (!entries) return undefined;
	return entries.map((e) => e.name);
}

// Parsed tool entry from frontmatter. `patterns` is present only when the
// entry used the `name(prefix:*)` scoping syntax — otherwise the tool is
// unscoped and any invocation passes.
export interface ParsedToolEntry {
	name: string;
	patterns?: string[];
}

// Split a comma-separated string at the top level only, leaving commas inside
// parens intact. So `bash(go test:*, git diff:*), read` splits into two
// entries, not three. Used by both the top-level tools list and the per-entry
// pattern list inside parens.
function splitTopLevelCommas(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "(") depth++;
		else if (c === ")") depth = Math.max(0, depth - 1);
		else if (c === "," && depth === 0) {
			out.push(s.slice(start, i));
			start = i + 1;
		}
	}
	out.push(s.slice(start));
	return out;
}

// Parse one tool entry. Accepts:
//   read                     -> { name: "read" }
//   bash                     -> { name: "bash" }                (unscoped)
//   bash(go test:*)          -> { name: "bash", patterns: ["go test"] }
//   bash(go test:*, git:*)   -> { name: "bash", patterns: ["go test", "git"] }
//   bash(go test)            -> { name: "bash", patterns: ["go test"] } (`:*` optional)
// Returns null if the entry isn't a recognized shape.
function parseSingleEntry(entry: string): ParsedToolEntry | null {
	const trimmed = entry.trim();
	if (!trimmed) return null;

	const paren = trimmed.indexOf("(");
	if (paren === -1) {
		// Bare tool name. Allow word chars, dashes, underscores.
		if (!/^[A-Za-z_][\w-]*$/.test(trimmed)) return null;
		return { name: trimmed };
	}

	if (!trimmed.endsWith(")")) return null;
	const name = trimmed.slice(0, paren).trim();
	if (!/^[A-Za-z_][\w-]*$/.test(name)) return null;

	const inside = trimmed.slice(paren + 1, -1).trim();
	if (!inside) return { name };

	const patterns = splitTopLevelCommas(inside)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => (p.endsWith(":*") ? p.slice(0, -2).trimEnd() : p))
		.filter(Boolean);

	return patterns.length > 0 ? { name, patterns } : { name };
}

// Public: parse a frontmatter `tools` value into structured entries. Mirrors
// normalizeTools' input handling (string or array). Unknown shapes -> undef.
export function parseToolEntries(raw: unknown): ParsedToolEntry[] | undefined {
	let rawEntries: string[] | null = null;

	if (Array.isArray(raw)) {
		rawEntries = raw.map((t) => (typeof t === "string" ? t : "")).filter(Boolean);
	} else if (typeof raw === "string") {
		rawEntries = splitTopLevelCommas(raw);
	} else {
		return undefined;
	}

	const out: ParsedToolEntry[] = [];
	const byName = new Map<string, ParsedToolEntry>();

	for (const e of rawEntries) {
		const parsed = parseSingleEntry(e);
		if (!parsed) continue;
		// Dedupe by name. If the same tool is listed twice with different patterns,
		// merge the pattern lists. If one is unscoped and another is scoped, the
		// unscoped wins (no patterns => no restriction). Last-write-wins on that.
		const existing = byName.get(parsed.name);
		if (!existing) {
			// Push the same reference into both `out` and `byName` so subsequent
			// merges mutate one object visible from both places.
			byName.set(parsed.name, parsed);
			out.push(parsed);
			continue;
		}
		if (!parsed.patterns) {
			// New entry is unscoped — drop the patterns on the existing entry.
			// Use `delete` (not `= undefined`) so deepStrictEqual / JSON output
			// treat the merged record as truly bare.
			delete existing.patterns;
		} else if (existing.patterns) {
			const merged = [...existing.patterns, ...parsed.patterns];
			existing.patterns = Array.from(new Set(merged));
		}
		// existing.patterns === undefined && parsed.patterns: leave existing as
		// unscoped (more permissive wins).
	}

	return out;
}

// Pattern enforcement now lives in the allow-list extension; the subagent
// extension only parses the agent frontmatter and serializes patterns into a
// permission-override env var. The previous local prefix-matcher (and its
// blanket shell-composition rejection) was deleted because allow-list's
// per-leaf bash decomposition is strictly more expressive.
