// Standalone test harness for _shared/usage-store.ts (real node:sqlite I/O).
//
// Usage (from anywhere):
//   node ~/.pi/agent/extensions/_shared/usage-store.test.mjs
//
// Uses jiti (ships with @earendil-works/pi-coding-agent) to load the TS source.
// Points PI_CODING_AGENT_DIR at a throwaway temp dir BEFORE importing so the DB
// lands there and the user's real ~/.pi/agent/usage.db is never touched.
//
// Exit: 0 = all passed, 1 = failure(s), 2 = harness setup error (incl. when
// node:sqlite is unavailable — the store would no-op and tests can't run).

import { execSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Isolate the DB into a temp config dir before the module is loaded.
const TMP_DIR = mkdtempSync(join(tmpdir(), "usage-store-test-"));
process.env.PI_CODING_AGENT_DIR = TMP_DIR;
// Start from a clean attribution baseline (depth 0, no agent, no root session).
delete process.env.PI_SUBAGENT_DEPTH;
delete process.env.PI_SUBAGENT_NAME;
delete process.env.PI_USAGE_ROOT_SESSION;
delete process.env.PI_SANDBOX_BOUNDARY;

function findJiti() {
	const candidates = [];
	try {
		const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
		candidates.push(
			join(globalRoot, "@earendil-works/pi-coding-agent/node_modules/jiti"),
			join(globalRoot, "jiti"),
		);
	} catch {
		/* npm not on PATH */
	}
	for (const p of [
		"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti",
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti",
	]) {
		candidates.push(p);
	}
	for (const c of candidates) {
		try {
			const pkg = createRequire(pathToFileURL(`${c}/`).href).resolve("./package.json");
			return dirname(pkg);
		} catch {
			/* try next */
		}
	}
	return null;
}

const jitiDir = findJiti();
if (!jitiDir) {
	console.error("Could not find jiti (ships with @earendil-works/pi-coding-agent).");
	process.exit(2);
}

// Confirm node:sqlite is present; without it the store no-ops and these
// I/O tests are meaningless. Treat as a setup error so CI flags the gap.
try {
	createRequire(import.meta.url)("node:sqlite");
} catch {
	console.error("node:sqlite unavailable in this runtime; cannot run usage-store I/O tests.");
	process.exit(2);
}

let m;
try {
	const { createJiti } = await import(pathToFileURL(join(jitiDir, "lib/jiti.mjs")).href).catch(() =>
		import(pathToFileURL(join(jitiDir, "dist/jiti.mjs")).href),
	);
	const jiti = createJiti(import.meta.url, { interopDefault: true });
	m = await jiti.import(pathResolve(join(here, "usage-store.ts")));
} catch (e) {
	console.error("Failed to load usage-store.ts via jiti:");
	console.error(e);
	process.exit(2);
}

const {
	attribution,
	resolveProject,
	recordLlmUsage,
	recordSavings,
	fetchUsage,
	fetchSavings,
	pruneOlderThan,
	dbSizeBytes,
} = m;

let pass = 0;
let fail = 0;
const failures = [];

function assertEq(label, actual, expected) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) pass++;
	else {
		fail++;
		failures.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
	}
}
function assert(label, cond) {
	if (cond) pass++;
	else {
		fail++;
		failures.push(`✗ ${label}`);
	}
}

const DAY = 24 * 3600 * 1000;
const since = Date.now() - DAY;

// ── attribution() reads env ───────────────────────────────────────────────────
assertEq("attribution default depth 0 / no agent / no root", attribution(), {
	depth: 0,
	agent: null,
	rootSession: null,
});
assertEq(
	"attribution reads env",
	attribution({ PI_SUBAGENT_DEPTH: "2", PI_SUBAGENT_NAME: "coder", PI_USAGE_ROOT_SESSION: "sess-1" }),
	{ depth: 2, agent: "coder", rootSession: "sess-1" },
);
assertEq(
	"attribution bad depth → 0",
	attribution({ PI_SUBAGENT_DEPTH: "garbage" }),
	{ depth: 0, agent: null, rootSession: null },
);

// ── resolveProject ─────────────────────────────────────────────────────────
assertEq(
	"resolveProject honors PI_SANDBOX_BOUNDARY",
	resolveProject("/tmp/whatever/sub", { PI_SANDBOX_BOUNDARY: "/real/repo" }),
	"/real/repo",
);
// No .git above a temp path → falls back to the cwd itself.
const noGit = join(TMP_DIR, "no-git-here");
assertEq("resolveProject no .git → cwd", resolveProject(noGit, { PI_SANDBOX_BOUNDARY: "" }), noGit);

// ── recordLlmUsage + fetchUsage (depth 0, top-level) ──────────────────────────
recordLlmUsage({
	cwd: "/tmp/projA",
	provider: "anthropic",
	model: "sonnet-4",
	input: 1000,
	output: 200,
	cacheRead: 50,
	cacheWrite: 10,
	totalTokens: 1250,
	cost: 0.5,
	stopReason: "stop",
});
recordLlmUsage({
	cwd: "/tmp/projA",
	provider: "openai",
	model: "gpt-5",
	input: 2000,
	output: 400,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2400,
	cost: 1.2,
});

// Subagent row (depth 1, agent coder) via env.
process.env.PI_SUBAGENT_DEPTH = "1";
process.env.PI_SUBAGENT_NAME = "coder";
recordLlmUsage({
	cwd: "/tmp/projA",
	provider: "anthropic",
	model: "sonnet-4",
	input: 500,
	output: 100,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 600,
	cost: 0.25,
});
delete process.env.PI_SUBAGENT_DEPTH;
delete process.env.PI_SUBAGENT_NAME;

const usage = fetchUsage({ sinceMs: since, granularity: "day" });
// 3 rows but grouped by bucket×provider×model×agent → 3 distinct groups
// (sonnet/null, gpt-5/null, sonnet/coder).
assertEq("fetchUsage group count", usage.length, 3);

const totalCalls = usage.reduce((a, r) => a + r.calls, 0);
assertEq("fetchUsage total calls", totalCalls, 3);
const totalCost = usage.reduce((a, r) => a + r.cost, 0);
assert("fetchUsage total cost ≈ 1.95", Math.abs(totalCost - 1.95) < 1e-9);

const sonnetTop = usage.find((r) => r.model === "sonnet-4" && r.agent === null);
assertEq("fetchUsage sonnet/top-level input", sonnetTop.input, 1000);
const sonnetAgent = usage.find((r) => r.model === "sonnet-4" && r.agent === "coder");
assert("fetchUsage subagent row attributed to coder", sonnetAgent && sonnetAgent.cost === 0.25);

// ── Scope filter (project = exact match) ──────────────────────────────────────
recordLlmUsage({ cwd: "/tmp/projB", provider: "anthropic", model: "haiku", input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01 });
const scopedA = fetchUsage({ sinceMs: since, granularity: "day", scopeProject: "/tmp/projA" });
assert("fetchUsage scopeProject=/tmp/projA excludes projB", scopedA.every((r) => r.model !== "haiku"));
const scopedB = fetchUsage({ sinceMs: since, granularity: "day", scopeProject: "/tmp/projB" });
assertEq("fetchUsage scopeProject=/tmp/projB only haiku", scopedB.map((r) => r.model), ["haiku"]);

// ── recordSavings + fetchSavings (estSavedUsd math) ──────────────────────────
recordSavings({
	cwd: "/tmp/projA",
	provider: "anthropic",
	model: "sonnet-4",
	source: "lean-ctx",
	tool: "read",
	originalTokens: 5000,
	compressedTokens: 1000,
	inputCostPerM: 3.0, // (5000-1000)*3/1e6 = 0.012
});
recordSavings({
	cwd: "/tmp/projA",
	provider: null,
	model: null,
	source: "lean-ctx",
	tool: "bash",
	originalTokens: 1000,
	compressedTokens: 900,
	inputCostPerM: null, // free model → contributes 0 to estSavedUsd
});

const sav = fetchSavings({ sinceMs: since, granularity: "day" });
const readRow = sav.find((r) => r.tool === "read");
assert("fetchSavings read estSavedUsd ≈ 0.012", Math.abs(readRow.estSavedUsd - 0.012) < 1e-9);
const bashRow = sav.find((r) => r.tool === "bash");
assertEq("fetchSavings null inputCostPerM → 0 usd", bashRow.estSavedUsd, 0);
assertEq("fetchSavings bash original tokens", bashRow.originalTokens, 1000);

// ── Time filter excludes old rows ────────────────────────────────────────────
const futureOnly = fetchUsage({ sinceMs: Date.now() + DAY, granularity: "day" });
assertEq("fetchUsage future lower-bound → empty", futureOnly.length, 0);

// ── Prune ────────────────────────────────────────────────────────────────────
// Nothing is older than cutoff (rows just written), so prune is a no-op here;
// assert it doesn't throw and leaves rows intact.
pruneOlderThan(Date.now() - 730 * DAY);
const afterPrune = fetchUsage({ sinceMs: since, granularity: "day" });
assert("pruneOlderThan keeps recent rows", afterPrune.length >= 3);

// ── dbSizeBytes + file location ──────────────────────────────────────────────
const dbFile = join(TMP_DIR, "usage.db");
assert("usage.db created under PI_CODING_AGENT_DIR", existsSync(dbFile));
assert("dbSizeBytes > 0 after writes", dbSizeBytes() > 0);

// ── Granularity buckets differ ────────────────────────────────────────────────
const monthly = fetchUsage({ sinceMs: since, granularity: "month" });
assert("fetchUsage month bucket = YYYY-MM", monthly.every((r) => /^\d{4}-\d{2}$/.test(r.bucket)));
const daily = fetchUsage({ sinceMs: since, granularity: "day" });
assert("fetchUsage day bucket = YYYY-MM-DD", daily.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.bucket)));

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nusage-store tests: ${pass} passed, ${fail} failed.   (db: ${TMP_DIR}/usage.db)\n`);
if (failures.length > 0) {
	for (const f of failures) console.log(f);
	process.exit(1);
}
process.exit(0);
