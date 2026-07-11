/**
 * bars.ts — pure layout + aggregation math for the /stats dashboard.
 *
 * No TUI / terminal imports: every function here takes plain data and returns
 * plain data so it is unit-testable without a terminal. stats-view.ts owns the
 * Component, key handling, theming, and DB calls; this module owns the
 * filter/group/sum/layout logic over the cached rows.
 */

import type { Granularity, SavingsRow, UsageRow } from "../_shared/usage-store.ts";

// ─── Timeframe ──────────────────────────────────────────────────────────────

export type Timeframe = "today" | "24h" | "30d" | "1y";
export const TIMEFRAMES: Timeframe[] = ["today", "24h", "30d", "1y"];

export function timeframeLabel(tf: Timeframe): string {
	switch (tf) {
		case "today":
			return "today";
		case "24h":
			return "last 24h";
		case "30d":
			return "last 30 days";
		case "1y":
			return "last year";
	}
}

export function granularityFor(tf: Timeframe): Granularity {
	return tf === "today" || tf === "24h" ? "hour" : tf === "1y" ? "month" : "day";
}

/** Lower-bound epoch-ms for a timeframe, relative to `now`. */
export function sinceMsFor(tf: Timeframe, now: number = Date.now()): number {
	switch (tf) {
		case "today": {
			const d = new Date(now);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}
		case "24h":
			return now - 24 * 60 * 60 * 1000;
		case "30d":
			return now - 30 * 24 * 60 * 60 * 1000;
		case "1y":
			return now - 365 * 24 * 60 * 60 * 1000;
	}
}

export function nextTimeframe(tf: Timeframe, dir: 1 | -1 = 1): Timeframe {
	const i = TIMEFRAMES.indexOf(tf);
	const n = (i + dir + TIMEFRAMES.length) % TIMEFRAMES.length;
	return TIMEFRAMES[n];
}

// ─── Filters ──────────────────────────────────────────────────────────────

export type Metric = "cost" | "tokens";
export type Scope = "global" | "project";
export type Dimension = "provider" | "model" | "agent";

/** Sentinel meaning "no filter on this dimension" (distinct from a NULL value). */
export const ALL = Symbol("all");
export type Sel = typeof ALL | string | null;

export interface Filters {
	provider: Sel;
	model: Sel;
	agent: Sel;
}

export function defaultFilters(): Filters {
	return { provider: ALL, model: ALL, agent: ALL };
}

/**
 * Distinct values present for a dimension in the cached set, sorted with NULL
 * last. The cycling order is [ALL, ...distinct]; ALL is prepended by the
 * caller (cycleSel).
 */
export function distinctValues(rows: UsageRow[], dim: Dimension): Array<string | null> {
	let hasNull = false;
	const set = new Set<string>();
	for (const r of rows) {
		const v = r[dim];
		if (v === null) hasNull = true;
		else set.add(v);
	}
	const out: Array<string | null> = Array.from(set).sort();
	if (hasNull) out.push(null);
	return out;
}

/** Cycle the selection for a dimension: ALL → each distinct value → ALL. */
export function cycleSel(current: Sel, rows: UsageRow[], dim: Dimension): Sel {
	const options: Sel[] = [ALL, ...distinctValues(rows, dim)];
	const idx = options.findIndex((o) => selEquals(o, current));
	const next = idx < 0 ? 0 : (idx + 1) % options.length;
	return options[next];
}

function selEquals(a: Sel, b: Sel): boolean {
	if (a === ALL || b === ALL) return a === b;
	return a === b; // string|null structural equality
}

export function selLabel(sel: Sel, dim: Dimension): string {
	if (sel === ALL) return "all";
	if (sel === null) return dim === "agent" ? "top-level" : "(unknown)";
	return sel;
}

function matchesFilter(value: string | null, sel: Sel): boolean {
	if (sel === ALL) return true;
	return value === sel;
}

export function filterUsage(rows: UsageRow[], f: Filters): UsageRow[] {
	return rows.filter(
		(r) =>
			matchesFilter(r.provider, f.provider) &&
			matchesFilter(r.model, f.model) &&
			matchesFilter(r.agent, f.agent),
	);
}

export function filterSavings(rows: SavingsRow[], f: Filters): SavingsRow[] {
	return rows.filter(
		(r) =>
			matchesFilter(r.provider, f.provider) &&
			matchesFilter(r.model, f.model) &&
			matchesFilter(r.agent, f.agent),
	);
}

// ─── Aggregation ──────────────────────────────────────────────────────────

export function metricValue(row: UsageRow, metric: Metric): number {
	// tokens excludes cache by design (cache_read can dwarf the bars); cache
	// totals live in the totals panel only. See DESIGN §11.12.
	return metric === "cost" ? row.cost : row.input + row.output;
}

/** Stable display key for a model (NULL collapses to "(unknown)"). */
export function modelKey(model: string | null): string {
	return model ?? "(unknown)";
}

export const SAVED_KEY = "__saved__";

export interface BarSegment {
	key: string;
	value: number;
	ghost: boolean;
}

export interface BarRow {
	label: string;
	segments: BarSegment[];
	/** Sum of non-ghost segment values (the real metric for this bucket). */
	total: number;
	/** Saved value (active metric unit) shown as a ghost segment, 0 if off. */
	saved: number;
}

/** Saved value per bucket, in the active metric's unit. */
function savedPerBucket(savings: SavingsRow[], metric: Metric): Map<string, number> {
	const m = new Map<string, number>();
	for (const r of savings) {
		const v = metric === "cost" ? r.estSavedUsd : r.originalTokens - r.compressedTokens;
		m.set(r.bucket, (m.get(r.bucket) ?? 0) + v);
	}
	return m;
}

export interface BuildBarsResult {
	rows: BarRow[];
	/** Largest (total + saved) across buckets — bar scaling reference. */
	maxTotal: number;
	/** Distinct model keys present, sorted — drives legend + color assignment. */
	models: string[];
}

/**
 * Group filtered usage rows into chronological buckets, each stacked by model.
 * When `savings` is provided, appends a per-bucket ghost "saved" segment in the
 * active metric unit.
 */
export function buildBars(
	usage: UsageRow[],
	savings: SavingsRow[] | null,
	metric: Metric,
): BuildBarsResult {
	const buckets = new Map<string, Map<string, number>>();
	const modelSet = new Set<string>();
	for (const r of usage) {
		const v = metricValue(r, metric);
		const key = modelKey(r.model);
		modelSet.add(key);
		let byModel = buckets.get(r.bucket);
		if (!byModel) {
			byModel = new Map();
			buckets.set(r.bucket, byModel);
		}
		byModel.set(key, (byModel.get(key) ?? 0) + v);
	}

	const saved = savings ? savedPerBucket(savings, metric) : null;
	// Ensure buckets that only have savings still appear.
	if (saved) for (const b of saved.keys()) if (!buckets.has(b)) buckets.set(b, new Map());

	const models = Array.from(modelSet).sort();
	const labels = Array.from(buckets.keys()).sort();
	const rows: BarRow[] = [];
	let maxTotal = 0;

	for (const label of labels) {
		const byModel = buckets.get(label)!;
		const segments: BarSegment[] = [];
		let total = 0;
		for (const key of models) {
			const value = byModel.get(key);
			if (value && value > 0) {
				segments.push({ key, value, ghost: false });
				total += value;
			}
		}
		const savedVal = saved ? Math.max(0, saved.get(label) ?? 0) : 0;
		if (savedVal > 0) segments.push({ key: SAVED_KEY, value: savedVal, ghost: true });
		rows.push({ label, segments, total, saved: savedVal });
		maxTotal = Math.max(maxTotal, total + savedVal);
	}

	return { rows, maxTotal, models };
}

/**
 * Lay out one bar's segments into integer column widths, scaled so that the
 * widest bucket (maxTotal) fills `barWidth`. Bars are comparable across rows
 * because every bucket is scaled against the same maxTotal.
 */
export function segmentWidths(
	row: BarRow,
	maxTotal: number,
	barWidth: number,
): Array<{ key: string; ghost: boolean; width: number }> {
	if (maxTotal <= 0 || barWidth <= 0) return [];
	const out: Array<{ key: string; ghost: boolean; width: number }> = [];
	for (const seg of row.segments) {
		const w = Math.round((seg.value / maxTotal) * barWidth);
		if (w > 0) out.push({ key: seg.key, ghost: seg.ghost, width: w });
	}
	return out;
}

// ─── Totals ─────────────────────────────────────────────────────────────────

export interface Totals {
	calls: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export function computeTotals(rows: UsageRow[]): Totals {
	const t: Totals = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const r of rows) {
		t.calls += r.calls;
		t.input += r.input;
		t.output += r.output;
		t.cacheRead += r.cacheRead;
		t.cacheWrite += r.cacheWrite;
		t.cost += r.cost;
	}
	return t;
}

export interface SavingsSummary {
	originalTokens: number;
	compressedTokens: number;
	estSavedUsd: number;
}

export function computeSavingsSummary(rows: SavingsRow[]): SavingsSummary {
	const s: SavingsSummary = { originalTokens: 0, compressedTokens: 0, estSavedUsd: 0 };
	for (const r of rows) {
		s.originalTokens += r.originalTokens;
		s.compressedTokens += r.compressedTokens;
		s.estSavedUsd += r.estSavedUsd;
	}
	return s;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatTokens(n: number): string {
	const v = Math.round(n);
	if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
	return String(v);
}

export function formatUsd(n: number): string {
	return `$${n.toFixed(2)}`;
}

export function formatMetricValue(value: number, metric: Metric): string {
	return metric === "cost" ? formatUsd(value) : formatTokens(value);
}
