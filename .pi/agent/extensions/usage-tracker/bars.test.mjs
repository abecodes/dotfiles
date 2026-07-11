// Standalone test harness for usage-tracker/bars.ts (pure functions, no DB).
//
// Usage (from anywhere):
//   node ~/.pi/agent/extensions/usage-tracker/bars.test.mjs
//
// Uses jiti (ships with @earendil-works/pi-coding-agent) to load the TS source.
// bars.ts imports the store only via `import type`, which jiti erases, so this
// harness never touches node:sqlite.
//
// Exit: 0 = all passed, 1 = failure(s), 2 = harness setup error.

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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

let m;
try {
	const { createJiti } = await import(pathToFileURL(join(jitiDir, "lib/jiti.mjs")).href).catch(() =>
		import(pathToFileURL(join(jitiDir, "dist/jiti.mjs")).href),
	);
	const jiti = createJiti(import.meta.url, { interopDefault: true });
	m = await jiti.import(pathResolve(join(here, "bars.ts")));
} catch (e) {
	console.error("Failed to load bars.ts via jiti:");
	console.error(e);
	process.exit(2);
}

const {
	TIMEFRAMES,
	timeframeLabel,
	granularityFor,
	sinceMsFor,
	nextTimeframe,
	ALL,
	defaultFilters,
	distinctValues,
	cycleSel,
	selLabel,
	filterUsage,
	filterSavings,
	metricValue,
	modelKey,
	SAVED_KEY,
	buildBars,
	segmentWidths,
	computeTotals,
	computeSavingsSummary,
	formatTokens,
	formatUsd,
	formatMetricValue,
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

// Sel → stable label for assertions (ALL is a symbol, unprintable via JSON).
function sel(s) {
	return typeof s === "symbol" ? "ALL" : s === null ? "NULL" : s;
}

// ── Fixtures ────────────────────────────────────────────────────────────────
function usageRow(o) {
	return {
		bucket: o.bucket ?? "2026-06-26",
		provider: o.provider ?? null,
		model: o.model ?? null,
		agent: o.agent ?? null,
		calls: o.calls ?? 1,
		input: o.input ?? 0,
		output: o.output ?? 0,
		cacheRead: o.cacheRead ?? 0,
		cacheWrite: o.cacheWrite ?? 0,
		cost: o.cost ?? 0,
	};
}
function savingsRow(o) {
	return {
		bucket: o.bucket ?? "2026-06-26",
		provider: o.provider ?? null,
		model: o.model ?? null,
		agent: o.agent ?? null,
		tool: o.tool ?? null,
		originalTokens: o.originalTokens ?? 0,
		compressedTokens: o.compressedTokens ?? 0,
		estSavedUsd: o.estSavedUsd ?? 0,
	};
}

// ── Timeframe helpers ────────────────────────────────────────────────────────
assertEq("TIMEFRAMES order", TIMEFRAMES, ["today", "24h", "30d", "1y"]);
assertEq("granularityFor today=hour", granularityFor("today"), "hour");
assertEq("granularityFor 24h=hour", granularityFor("24h"), "hour");
assertEq("granularityFor 30d=day", granularityFor("30d"), "day");
assertEq("granularityFor 1y=month", granularityFor("1y"), "month");
assertEq("timeframeLabel 30d", timeframeLabel("30d"), "last 30 days");
assertEq("nextTimeframe forward today→24h", nextTimeframe("today", 1), "24h");
assertEq("nextTimeframe wrap 1y→today", nextTimeframe("1y", 1), "today");
assertEq("nextTimeframe back today→1y", nextTimeframe("today", -1), "1y");

const NOW = new Date("2026-06-26T12:00:00").getTime();
assert("sinceMsFor today = local midnight (≤ now)", sinceMsFor("today", NOW) <= NOW);
assert("sinceMsFor today is start of day", new Date(sinceMsFor("today", NOW)).getHours() === 0);
assertEq("sinceMsFor 24h = now-24h", sinceMsFor("24h", NOW), NOW - 24 * 3600 * 1000);
assertEq("sinceMsFor 30d = now-30d", sinceMsFor("30d", NOW), NOW - 30 * 24 * 3600 * 1000);
assertEq("sinceMsFor 1y = now-365d", sinceMsFor("1y", NOW), NOW - 365 * 24 * 3600 * 1000);

// ── Filters: distinctValues + NULL handling ───────────────────────────────────
const rows = [
	usageRow({ provider: "anthropic", model: "sonnet", agent: null, cost: 1 }),
	usageRow({ provider: "openai", model: "gpt-5", agent: "coder", cost: 2 }),
	usageRow({ provider: "anthropic", model: "sonnet", agent: "coder", cost: 0.5 }),
	usageRow({ provider: null, model: null, agent: null, cost: 0.1 }),
];

assertEq("distinctValues provider (NULL last)", distinctValues(rows, "provider"), [
	"anthropic",
	"openai",
	null,
]);
assertEq("distinctValues model (NULL last)", distinctValues(rows, "model"), ["gpt-5", "sonnet", null]);
assertEq("distinctValues agent (NULL last)", distinctValues(rows, "agent"), ["coder", null]);

// cycleSel: ALL → each distinct (incl NULL) → ALL
let s = ALL;
const seq = [];
for (let i = 0; i < 5; i++) {
	s = cycleSel(s, rows, "provider");
	seq.push(sel(s));
}
assertEq("cycleSel provider sequence ALL→anthropic→openai→NULL→ALL→anthropic", seq, [
	"anthropic",
	"openai",
	"NULL",
	"ALL",
	"anthropic",
]);

assertEq("selLabel ALL", selLabel(ALL, "provider"), "all");
assertEq("selLabel NULL agent → top-level", selLabel(null, "agent"), "top-level");
assertEq("selLabel NULL provider → (unknown)", selLabel(null, "provider"), "(unknown)");
assertEq("selLabel value passes through", selLabel("anthropic", "provider"), "anthropic");

assertEq("defaultFilters all ALL", [
	sel(defaultFilters().provider),
	sel(defaultFilters().model),
	sel(defaultFilters().agent),
], ["ALL", "ALL", "ALL"]);

// filterUsage: ALL passes everything; specific value (incl NULL) narrows
assertEq("filterUsage ALL → all rows", filterUsage(rows, defaultFilters()).length, 4);
assertEq(
	"filterUsage provider=anthropic → 2 rows",
	filterUsage(rows, { provider: "anthropic", model: ALL, agent: ALL }).length,
	2,
);
assertEq(
	"filterUsage provider=NULL → 1 row (the unknown one)",
	filterUsage(rows, { provider: null, model: ALL, agent: ALL }).length,
	1,
);
assertEq(
	"filterUsage agent=NULL → 2 top-level rows",
	filterUsage(rows, { provider: ALL, model: ALL, agent: null }).length,
	2,
);

const savings = [
	savingsRow({ provider: "anthropic", model: "sonnet", agent: "coder", originalTokens: 100, compressedTokens: 30, estSavedUsd: 0.2 }),
	savingsRow({ provider: "openai", model: "gpt-5", agent: null, originalTokens: 50, compressedTokens: 10, estSavedUsd: 0.1 }),
];
assertEq(
	"filterSavings provider=anthropic → 1 row",
	filterSavings(savings, { provider: "anthropic", model: ALL, agent: ALL }).length,
	1,
);

// ── Metric ─────────────────────────────────────────────────────────────────
assertEq("metricValue cost", metricValue(usageRow({ cost: 3.5 }), "cost"), 3.5);
assertEq(
	"metricValue tokens = input+output (excludes cache)",
	metricValue(usageRow({ input: 100, output: 20, cacheRead: 999999, cacheWrite: 7 }), "tokens"),
	120,
);
assertEq("modelKey NULL → (unknown)", modelKey(null), "(unknown)");
assertEq("modelKey passthrough", modelKey("sonnet"), "sonnet");

// ── buildBars: stacking, ordering, ghost, maxTotal ────────────────────────────
const barRows = [
	usageRow({ bucket: "2026-06-25", model: "sonnet", cost: 1, input: 10, output: 5 }),
	usageRow({ bucket: "2026-06-26", model: "sonnet", cost: 2, input: 20, output: 5 }),
	usageRow({ bucket: "2026-06-26", model: "gpt-5", cost: 3, input: 30, output: 5 }),
];

const builtCost = buildBars(barRows, null, "cost");
assertEq("buildBars chronological labels", builtCost.rows.map((r) => r.label), ["2026-06-25", "2026-06-26"]);
assertEq("buildBars models sorted", builtCost.models, ["gpt-5", "sonnet"]);
assertEq("buildBars day1 total", builtCost.rows[0].total, 1);
assertEq("buildBars day2 total (2+3)", builtCost.rows[1].total, 5);
assertEq("buildBars maxTotal", builtCost.maxTotal, 5);
// Segments within a bucket follow the sorted-model order (gpt-5 before sonnet).
assertEq(
	"buildBars day2 segment order = sorted models",
	builtCost.rows[1].segments.map((seg) => seg.key),
	["gpt-5", "sonnet"],
);
assertEq("buildBars no ghost when savings null", builtCost.rows.some((r) => r.segments.some((seg) => seg.ghost)), false);

// With savings → ghost segment in active metric unit; maxTotal includes ghost.
const savedRows = [savingsRow({ bucket: "2026-06-26", estSavedUsd: 4, originalTokens: 500, compressedTokens: 100 })];
const builtSavCost = buildBars(barRows, savedRows, "cost");
const day2 = builtSavCost.rows.find((r) => r.label === "2026-06-26");
assertEq("buildBars+savings day2 saved (cost)", day2.saved, 4);
assertEq("buildBars+savings ghost segment present", day2.segments.some((seg) => seg.ghost && seg.key === SAVED_KEY), true);
assertEq("buildBars+savings maxTotal includes ghost (5+4)", builtSavCost.maxTotal, 9);

// tokens metric: ghost uses original-compressed token delta
const builtSavTok = buildBars(barRows, savedRows, "tokens");
const day2Tok = builtSavTok.rows.find((r) => r.label === "2026-06-26");
assertEq("buildBars+savings day2 saved (tokens=orig-comp)", day2Tok.saved, 400);

// bucket with only savings still appears
const onlySav = buildBars([], [savingsRow({ bucket: "2026-06-26", estSavedUsd: 1 })], "cost");
assertEq("buildBars savings-only bucket appears", onlySav.rows.length, 1);

// ── segmentWidths: proportional to maxTotal ──────────────────────────────────
const sw = segmentWidths(builtCost.rows[1], builtCost.maxTotal, 50); // total 5 of max 5 → full 50
const swTotal = sw.reduce((acc, x) => acc + x.width, 0);
assert("segmentWidths full bar ≈ barWidth", Math.abs(swTotal - 50) <= 1);
const swHalf = segmentWidths(builtCost.rows[0], builtCost.maxTotal, 50); // total 1 of max 5 → ~10
const swHalfTotal = swHalf.reduce((acc, x) => acc + x.width, 0);
assert("segmentWidths smaller bucket scales down (≈10)", Math.abs(swHalfTotal - 10) <= 1);
assertEq("segmentWidths empty when maxTotal=0", segmentWidths(builtCost.rows[0], 0, 50), []);

// ── Totals & savings summary ──────────────────────────────────────────────────
const totals = computeTotals(barRows);
assertEq("computeTotals calls", totals.calls, 3);
assertEq("computeTotals input", totals.input, 60);
assertEq("computeTotals output", totals.output, 15);
assertEq("computeTotals cost", totals.cost, 6);

const sumSav = computeSavingsSummary(savings);
assertEq("computeSavingsSummary orig", sumSav.originalTokens, 150);
assertEq("computeSavingsSummary comp", sumSav.compressedTokens, 40);
assert("computeSavingsSummary usd", Math.abs(sumSav.estSavedUsd - 0.3) < 1e-9);

// ── Formatters ─────────────────────────────────────────────────────────────
assertEq("formatTokens <1k", formatTokens(950), "950");
assertEq("formatTokens k", formatTokens(12345), "12.3k");
assertEq("formatTokens M", formatTokens(1_500_000), "1.5M");
assertEq("formatUsd", formatUsd(48.1), "$48.10");
assertEq("formatMetricValue cost", formatMetricValue(3.5, "cost"), "$3.50");
assertEq("formatMetricValue tokens", formatMetricValue(12345, "tokens"), "12.3k");

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nbars tests: ${pass} passed, ${fail} failed.\n`);
if (failures.length > 0) {
	for (const f of failures) console.log(f);
	process.exit(1);
}
process.exit(0);
