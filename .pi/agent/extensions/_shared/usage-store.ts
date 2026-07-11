/**
 * usage-store.ts — SQLite-backed, concurrency-safe usage tracking.
 *
 * Shared between `usage-tracker` (records LLM calls, queries for /stats) and
 * `lean-ctx` (records token savings). Lives under `_shared/` so both import
 * the same module. See usage-tracker/DESIGN.md for the full rationale.
 *
 * Design invariants:
 *   - Best-effort: every public call is wrapped in try/catch and NEVER throws
 *     into the agent loop. A locked or missing DB drops the row, it does not
 *     crash or block.
 *   - Lazy open: the DB is opened on first write and kept for process lifetime.
 *   - One connection per process, keyed on globalThis under a Symbol.for() slot
 *     so that the two extensions importing this module (which pi loads as
 *     separate module graphs — see _shared/README.md) share a single handle.
 *   - node:sqlite (DatabaseSync) only. If unavailable, the store no-ops after a
 *     single debug log.
 */

import { createRequire } from "node:module";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

// node:sqlite ships a synchronous binding (DatabaseSync). We resolve it via
// createRequire so the public API can stay synchronous (the recorders are
// called from synchronous hook bodies). Wrapped in try/catch: if the binding
// is missing, `sqlite` stays null and every call becomes a silent no-op.
type Database = {
	exec(sql: string): void;
	prepare(sql: string): {
		run(...params: unknown[]): unknown;
		get(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
	};
	close(): void;
};

const SCHEMA_VERSION = 1;
const STATE_KEY = Symbol.for("@pi-agent/usage-store/state");

interface Slot {
	db: Database | null;
	openAttempted: boolean;
	sqliteUnavailable: boolean;
	loggedUnavailable: boolean;
	projectCache: Map<string, string>;
}

function slot(): Slot {
	const g = globalThis as unknown as Record<symbol, Slot>;
	if (!g[STATE_KEY]) {
		g[STATE_KEY] = {
			db: null,
			openAttempted: false,
			sqliteUnavailable: false,
			loggedUnavailable: false,
			projectCache: new Map(),
		};
	}
	return g[STATE_KEY];
}

function configDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function dbPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(configDir(env), "usage.db");
}

function loadDatabaseSync(): (new (path: string) => Database) | null {
	try {
		const require = createRequire(import.meta.url);
		const mod = require("node:sqlite") as { DatabaseSync: new (path: string) => Database };
		return mod.DatabaseSync;
	} catch {
		return null;
	}
}

/**
 * Lazily open (and initialize) the process-wide DB connection. Returns null if
 * node:sqlite is unavailable or the open failed — callers must treat null as
 * "store disabled" and no-op.
 */
function getDb(): Database | null {
	const s = slot();
	if (s.db) return s.db;
	if (s.sqliteUnavailable) return null;
	if (s.openAttempted && !s.db) {
		// A previous open threw (not an sqlite-missing case). Don't retry
		// every call — but allow a fresh attempt after /reload rebinds, which
		// creates a new module graph and thus a fresh globalThis slot only if
		// the symbol changes; it doesn't, so this stays sticky for the process.
		return null;
	}
	s.openAttempted = true;

	const DatabaseSync = loadDatabaseSync();
	if (!DatabaseSync) {
		s.sqliteUnavailable = true;
		if (!s.loggedUnavailable) {
			s.loggedUnavailable = true;
			// Debug-only: best-effort tracking degrades to a no-op.
			console.debug?.("[usage-store] node:sqlite unavailable; usage tracking disabled");
		}
		return null;
	}

	try {
		const db = new DatabaseSync(dbPath());
		db.exec("PRAGMA journal_mode=WAL;");
		db.exec("PRAGMA busy_timeout=5000;");
		db.exec("PRAGMA synchronous=NORMAL;");
		initSchema(db);
		s.db = db;
		return db;
	} catch (err) {
		console.debug?.("[usage-store] failed to open usage.db:", err);
		return null;
	}
}

function initSchema(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS meta (
			key TEXT PRIMARY KEY,
			value TEXT
		);
		CREATE TABLE IF NOT EXISTS llm_usage (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			ts            INTEGER NOT NULL,
			root_session  TEXT,
			cwd           TEXT,
			project       TEXT,
			depth         INTEGER NOT NULL,
			agent         TEXT,
			provider      TEXT,
			model         TEXT,
			input         INTEGER NOT NULL DEFAULT 0,
			output        INTEGER NOT NULL DEFAULT 0,
			cache_read    INTEGER NOT NULL DEFAULT 0,
			cache_write   INTEGER NOT NULL DEFAULT 0,
			total_tokens  INTEGER NOT NULL DEFAULT 0,
			cost          REAL    NOT NULL DEFAULT 0,
			stop_reason   TEXT
		);
		CREATE TABLE IF NOT EXISTS token_savings (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			ts                INTEGER NOT NULL,
			root_session      TEXT,
			cwd               TEXT,
			project           TEXT,
			depth             INTEGER NOT NULL,
			agent             TEXT,
			provider          TEXT,
			model             TEXT,
			source            TEXT NOT NULL,
			tool              TEXT,
			original_tokens   INTEGER NOT NULL,
			compressed_tokens INTEGER NOT NULL,
			input_cost_per_m  REAL
		);
		CREATE INDEX IF NOT EXISTS idx_usage_ts      ON llm_usage(ts);
		CREATE INDEX IF NOT EXISTS idx_usage_model   ON llm_usage(model);
		CREATE INDEX IF NOT EXISTS idx_usage_agent   ON llm_usage(agent);
		CREATE INDEX IF NOT EXISTS idx_usage_project ON llm_usage(project);
		CREATE INDEX IF NOT EXISTS idx_savings_ts    ON token_savings(ts);
	`);
	// Record schema version once. Future migrations read this and ALTER TABLE
	// under an explicit guard (see DESIGN §11.14).
	const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
		| { value: string }
		| undefined;
	if (!row) {
		db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
	}
}

// ─── Project resolution (write-time, single source of truth) ────────────────

/**
 * Walk up from `start` looking for the closest enclosing `.git` (dir or file —
 * worktrees/submodules use a `.git` file). Returns the directory containing it,
 * or null if none found before the filesystem root.
 */
function nearestGitRoot(start: string): string | null {
	let dir = resolve(start);
	// Guard against infinite loops; dirname() of "/" returns "/".
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Canonical project root for a cwd, computed at WRITE time so the dashboard's
 * `project = ?` filter compares like-for-like. Honors PI_SANDBOX_BOUNDARY
 * (already the real repo root, realpath'd — see subagent/sandbox.ts) so
 * sandboxed subagents attribute to the project they work on, not their
 * throwaway worktree. Otherwise the closest enclosing `.git`, else cwd itself.
 *
 * Cached per cwd within the process (cwd is ~constant) to avoid an fs walk on
 * every message_end.
 */
export function resolveProject(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	const boundary = env.PI_SANDBOX_BOUNDARY;
	if (boundary && boundary.length > 0) return boundary;
	if (!cwd) return cwd;
	const cache = slot().projectCache;
	const cached = cache.get(cwd);
	if (cached !== undefined) return cached;
	const resolved = nearestGitRoot(cwd) ?? cwd;
	cache.set(cwd, resolved);
	return resolved;
}

// ─── Attribution ────────────────────────────────────────────────────────────

export interface Attribution {
	depth: number;
	agent: string | null;
	rootSession: string | null;
}

export function attribution(env: NodeJS.ProcessEnv = process.env): Attribution {
	const rawDepth = env.PI_SUBAGENT_DEPTH;
	let depth = 0;
	if (rawDepth) {
		const n = Number.parseInt(rawDepth, 10);
		if (Number.isFinite(n) && n >= 0) depth = n;
	}
	const agent = env.PI_SUBAGENT_NAME && env.PI_SUBAGENT_NAME.length > 0 ? env.PI_SUBAGENT_NAME : null;
	const rootSession =
		env.PI_USAGE_ROOT_SESSION && env.PI_USAGE_ROOT_SESSION.length > 0 ? env.PI_USAGE_ROOT_SESSION : null;
	return { depth, agent, rootSession };
}

// ─── Recording ──────────────────────────────────────────────────────────────

export interface LlmUsageInput {
	cwd?: string | null;
	provider?: string | null;
	model?: string | null;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens?: number;
	cost: number;
	stopReason?: string | null;
}

export function recordLlmUsage(row: LlmUsageInput): void {
	try {
		const db = getDb();
		if (!db) return;
		const attr = attribution();
		const cwd = row.cwd ?? null;
		const project = cwd ? resolveProject(cwd) : null;
		db.prepare(
			`INSERT INTO llm_usage
				(ts, root_session, cwd, project, depth, agent, provider, model,
				 input, output, cache_read, cache_write, total_tokens, cost, stop_reason)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			Date.now(),
			attr.rootSession,
			cwd,
			project,
			attr.depth,
			attr.agent,
			row.provider ?? null,
			row.model ?? null,
			Math.round(row.input || 0),
			Math.round(row.output || 0),
			Math.round(row.cacheRead || 0),
			Math.round(row.cacheWrite || 0),
			Math.round(row.totalTokens || 0),
			row.cost || 0,
			row.stopReason ?? null,
		);
	} catch (err) {
		console.debug?.("[usage-store] recordLlmUsage failed:", err);
	}
}

export interface SavingsInput {
	cwd?: string | null;
	provider?: string | null;
	model?: string | null;
	source: string;
	tool?: string | null;
	originalTokens: number;
	compressedTokens: number;
	inputCostPerM?: number | null;
}

export function recordSavings(row: SavingsInput): void {
	try {
		const db = getDb();
		if (!db) return;
		const attr = attribution();
		const cwd = row.cwd ?? null;
		const project = cwd ? resolveProject(cwd) : null;
		db.prepare(
			`INSERT INTO token_savings
				(ts, root_session, cwd, project, depth, agent, provider, model,
				 source, tool, original_tokens, compressed_tokens, input_cost_per_m)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			Date.now(),
			attr.rootSession,
			cwd,
			project,
			attr.depth,
			attr.agent,
			row.provider ?? null,
			row.model ?? null,
			row.source,
			row.tool ?? null,
			Math.round(row.originalTokens || 0),
			Math.round(row.compressedTokens || 0),
			typeof row.inputCostPerM === "number" ? row.inputCostPerM : null,
		);
	} catch (err) {
		console.debug?.("[usage-store] recordSavings failed:", err);
	}
}

// ─── Querying (for the dashboard) ───────────────────────────────────────────

export type Granularity = "hour" | "day" | "month";

export interface UsageRow {
	bucket: string;
	provider: string | null;
	model: string | null;
	agent: string | null;
	calls: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface SavingsRow {
	bucket: string;
	provider: string | null;
	model: string | null;
	agent: string | null;
	tool: string | null;
	originalTokens: number;
	compressedTokens: number;
	estSavedUsd: number;
}

export interface FetchOpts {
	sinceMs: number;
	granularity: Granularity;
	scopeProject?: string;
}

function bucketExpr(granularity: Granularity): string {
	// ts is epoch ms; strftime wants seconds → ts/1000 with 'unixepoch'.
	// 'localtime' so buckets align to the user's wall clock.
	const fmt = granularity === "hour" ? "%Y-%m-%d %H:00" : granularity === "month" ? "%Y-%m" : "%Y-%m-%d";
	return `strftime('${fmt}', ts/1000, 'unixepoch', 'localtime')`;
}

export function fetchUsage(o: FetchOpts): UsageRow[] {
	try {
		const db = getDb();
		if (!db) return [];
		const where = ["ts >= ?"];
		const params: unknown[] = [o.sinceMs];
		if (o.scopeProject) {
			where.push("project = ?");
			params.push(o.scopeProject);
		}
		const sql =
			`SELECT ${bucketExpr(o.granularity)} AS bucket, provider, model, agent,
				COUNT(*) AS calls, SUM(input) AS input, SUM(output) AS output,
				SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(cost) AS cost
			 FROM llm_usage
			 WHERE ${where.join(" AND ")}
			 GROUP BY bucket, provider, model, agent`;
		const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
		return rows.map((r) => ({
			bucket: String(r.bucket ?? ""),
			provider: (r.provider as string | null) ?? null,
			model: (r.model as string | null) ?? null,
			agent: (r.agent as string | null) ?? null,
			calls: Number(r.calls ?? 0),
			input: Number(r.input ?? 0),
			output: Number(r.output ?? 0),
			cacheRead: Number(r.cacheRead ?? 0),
			cacheWrite: Number(r.cacheWrite ?? 0),
			cost: Number(r.cost ?? 0),
		}));
	} catch (err) {
		console.debug?.("[usage-store] fetchUsage failed:", err);
		return [];
	}
}

export function fetchSavings(o: FetchOpts): SavingsRow[] {
	try {
		const db = getDb();
		if (!db) return [];
		const where = ["ts >= ?"];
		const params: unknown[] = [o.sinceMs];
		if (o.scopeProject) {
			where.push("project = ?");
			params.push(o.scopeProject);
		}
		const sql =
			`SELECT ${bucketExpr(o.granularity)} AS bucket, provider, model, agent, tool,
				SUM(original_tokens) AS originalTokens, SUM(compressed_tokens) AS compressedTokens,
				SUM((original_tokens - compressed_tokens) * COALESCE(input_cost_per_m, 0)) / 1e6 AS estSavedUsd
			 FROM token_savings
			 WHERE ${where.join(" AND ")}
			 GROUP BY bucket, provider, model, agent, tool`;
		const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
		return rows.map((r) => ({
			bucket: String(r.bucket ?? ""),
			provider: (r.provider as string | null) ?? null,
			model: (r.model as string | null) ?? null,
			agent: (r.agent as string | null) ?? null,
			tool: (r.tool as string | null) ?? null,
			originalTokens: Number(r.originalTokens ?? 0),
			compressedTokens: Number(r.compressedTokens ?? 0),
			estSavedUsd: Number(r.estSavedUsd ?? 0),
		}));
	} catch (err) {
		console.debug?.("[usage-store] fetchSavings failed:", err);
		return [];
	}
}

// ─── Maintenance ──────────────────────────────────────────────────────────

export function pruneOlderThan(cutoffMs: number): void {
	try {
		const db = getDb();
		if (!db) return;
		db.prepare("DELETE FROM llm_usage WHERE ts < ?").run(cutoffMs);
		db.prepare("DELETE FROM token_savings WHERE ts < ?").run(cutoffMs);
	} catch (err) {
		console.debug?.("[usage-store] pruneOlderThan failed:", err);
	}
}

export function dbSizeBytes(): number {
	try {
		const path = dbPath();
		if (!existsSync(path)) return 0;
		return statSync(path).size;
	} catch {
		return 0;
	}
}
