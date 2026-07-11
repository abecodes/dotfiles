/**
 * stats-view.ts — interactive /stats dashboard (TUI-only).
 *
 * Owns the Component, key handling, the (timeframe, scope) DB-fetch cache, and
 * all rendering. The pure filter/group/sum/layout math lives in bars.ts; this
 * file is the terminal-facing half.
 *
 * The dashboard is modal: while it's open the agent is idle and no new rows are
 * written, so a fetched dataset is valid for the dashboard's lifetime. DB is
 * hit once per distinct (timeframe, scope); the p/m/a filters, the c metric
 * toggle, and the s savings toggle are pure in-memory recompute over the cached
 * rows.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import {
	type Granularity,
	type SavingsRow,
	type UsageRow,
	fetchSavings,
	fetchUsage,
} from "../_shared/usage-store.ts";
import {
	type Filters,
	type Metric,
	type Scope,
	buildBars,
	computeSavingsSummary,
	computeTotals,
	cycleSel,
	defaultFilters,
	filterSavings,
	filterUsage,
	formatTokens,
	formatUsd,
	granularityFor,
	nextTimeframe,
	type Timeframe,
	selLabel,
	sinceMsFor,
	timeframeLabel,
} from "./bars.ts";

type ColorToken = Parameters<Theme["fg"]>[0];

// Segment color palette (cycled by sorted model index). Solid █ glyph for the
// first cycle, ▓ for the second so >8 models still differ when colors repeat.
const SEGMENT_COLORS: ColorToken[] = [
	"accent",
	"success",
	"warning",
	"error",
	"mdHeading",
	"syntaxString",
	"syntaxType",
	"mdLink",
];

export interface CachedData {
	usage: UsageRow[];
	savings: SavingsRow[];
}

export class StatsView implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: () => void;
	private readonly currentProject: string;
	// Optional data source (used by /stats-demo to inject fabricated rows instead
	// of querying the DB). When unset, the dashboard reads the real store.
	private readonly dataProvider?: (granularity: Granularity) => CachedData;

	private timeframe: Timeframe = "30d";
	private metric: Metric = "cost";
	private filters: Filters = defaultFilters();
	private scope: Scope = "global";
	private savingsOn = false;

	private readonly cache = new Map<string, CachedData>();

	constructor(opts: {
		tui: TUI;
		theme: Theme;
		done: () => void;
		currentProject: string;
		dataProvider?: (granularity: Granularity) => CachedData;
	}) {
		this.tui = opts.tui;
		this.theme = opts.theme;
		this.done = opts.done;
		this.currentProject = opts.currentProject;
		this.dataProvider = opts.dataProvider;
	}

	// ─── Data ────────────────────────────────────────────────────────────────

	private getData(): CachedData {
		const key = `${this.timeframe}|${this.scope}`;
		const cached = this.cache.get(key);
		if (cached) return cached;
		const sinceMs = sinceMsFor(this.timeframe);
		const granularity = granularityFor(this.timeframe);
		const scopeProject = this.scope === "project" ? this.currentProject : undefined;
		const data: CachedData = this.dataProvider
			? this.dataProvider(granularity)
			: {
					usage: fetchUsage({ sinceMs, granularity, scopeProject }),
					savings: fetchSavings({ sinceMs, granularity, scopeProject }),
				};
		// Bound the cache (≤8 distinct timeframe|scope combos exist anyway).
		if (this.cache.size >= 8) {
			const first = this.cache.keys().next().value;
			if (first !== undefined) this.cache.delete(first);
		}
		this.cache.set(key, data);
		return data;
	}

	// ─── Input ───────────────────────────────────────────────────────────────

	handleInput(data: string): void {
		const before = this.snapshot();
		if (matchesKey(data, Key.escape) || data === "q") {
			this.done();
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.timeframe = nextTimeframe(this.timeframe, -1);
		} else if (matchesKey(data, Key.tab)) {
			this.timeframe = nextTimeframe(this.timeframe, 1);
		} else if (data === "c") {
			this.metric = this.metric === "cost" ? "tokens" : "cost";
		} else if (data === "p") {
			this.filters.provider = cycleSel(this.filters.provider, this.getData().usage, "provider");
		} else if (data === "m") {
			this.filters.model = cycleSel(this.filters.model, this.getData().usage, "model");
		} else if (data === "a") {
			this.filters.agent = cycleSel(this.filters.agent, this.getData().usage, "agent");
		} else if (data === "u") {
			this.scope = this.scope === "global" ? "project" : "global";
		} else if (data === "s") {
			this.savingsOn = !this.savingsOn;
		} else if (data === "r") {
			this.timeframe = "30d";
			this.metric = "cost";
			this.filters = defaultFilters();
			this.scope = "global";
			this.savingsOn = false;
		}
		if (this.snapshot() !== before) this.tui.requestRender();
	}

	private snapshot(): string {
		const sel = (s: Filters["provider"]): string => (typeof s === "symbol" ? "ALL" : s === null ? "NULL" : s);
		return [
			this.timeframe,
			this.metric,
			this.scope,
			String(this.savingsOn),
			sel(this.filters.provider),
			sel(this.filters.model),
			sel(this.filters.agent),
		].join("|");
	}

	invalidate(): void {
		// Render is stateless (themed strings computed fresh each call), so there
		// is no pre-baked cache to clear.
	}

	// ─── Render ──────────────────────────────────────────────────────────────

	render(width: number): string[] {
		const w = Math.max(20, width);
		const fg = this.theme.fg.bind(this.theme);
		const data = this.getData();
		const fUsage = filterUsage(data.usage, this.filters);
		const fSavings = filterSavings(data.savings, this.filters);
		const totals = computeTotals(fUsage);
		const bars = buildBars(fUsage, this.savingsOn ? fSavings : null, this.metric);
		const styles = this.modelStyles(bars.models);

		const lines: string[] = [];

		// ── Header ──
		const left =
			`stats · ${timeframeLabel(this.timeframe)} · ` +
			`prov:${selLabel(this.filters.provider, "provider")} · ` +
			`model:${selLabel(this.filters.model, "model")} · ` +
			`agent:${selLabel(this.filters.agent, "agent")} · ` +
			`${this.scope === "project" ? "project" : "global"}`;
		const right = `↑${formatTokens(totals.input)} ↓${formatTokens(totals.output)}`;
		lines.push(this.spread(fg("toolTitle", left), fg("muted", right), w));
		lines.push("");

		// ── Bars ──
		if (bars.rows.length === 0) {
			lines.push(" " + fg("muted", "(no usage recorded for this timeframe / scope)"));
		} else {
			const labelW = 11;
			const valueW = 9;
			const barW = Math.max(4, w - 3 - labelW - valueW);
			for (const row of bars.rows) {
				const label = this.bucketLabel(row.label).padEnd(labelW).slice(0, labelW);
				const bar = this.renderBar(row, bars.maxTotal, barW, styles);
				const valueText = this.metric === "cost" ? formatUsd(row.total) : formatTokens(row.total);
				const value = valueText.padStart(valueW).slice(-valueW);
				lines.push(` ${fg("muted", label)} ${bar} ${fg("dim", value)}`);
			}
		}
		lines.push("");

		// ── Legend ──
		lines.push(...this.renderLegend(bars.models, styles, w));

		// ── Totals + savings ──
		const divider = fg("muted", "─".repeat(Math.min(w, 76)));
		lines.push(divider);
		lines.push(
			truncateToWidth(
				" " +
					fg("muted", "total  ") +
					`${totals.calls} calls · ↑${formatTokens(totals.input)} ↓${formatTokens(totals.output)} · ` +
					`cacheR ${formatTokens(totals.cacheRead)} cacheW ${formatTokens(totals.cacheWrite)} · ` +
					fg("accent", formatUsd(totals.cost)),
				w,
			),
		);
		lines.push(this.renderSavingsLine(fSavings, w));
		lines.push(divider);

		// ── Keys ──
		lines.push(
			truncateToWidth(
				" " +
					fg(
						"muted",
						"[tab]time [c]ost/tok [p]rov [m]odel [a]gent [u]scope [s]avings [r]eset [q]uit",
					),
				w,
			),
		);

		return lines;
	}

	// ─── Render helpers ────────────────────────────────────────────────────

	private modelStyles(models: string[]): Map<string, { color: ColorToken; glyph: string }> {
		const m = new Map<string, { color: ColorToken; glyph: string }>();
		models.forEach((model, i) => {
			m.set(model, {
				color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
				glyph: i < SEGMENT_COLORS.length ? "█" : "▓",
			});
		});
		return m;
	}

	private renderBar(
		row: ReturnType<typeof buildBars>["rows"][number],
		maxTotal: number,
		barW: number,
		styles: Map<string, { color: ColorToken; glyph: string }>,
	): string {
		const fg = this.theme.fg.bind(this.theme);
		let out = "";
		let used = 0;
		if (maxTotal > 0) {
			for (const seg of row.segments) {
				const wseg = Math.round((seg.value / maxTotal) * barW);
				if (wseg <= 0) continue;
				if (seg.ghost) {
					out += fg("dim", "░".repeat(wseg));
				} else {
					const style = styles.get(seg.key) ?? { color: "accent" as ColorToken, glyph: "█" };
					out += fg(style.color, style.glyph.repeat(wseg));
				}
				used += wseg;
			}
		}
		if (used < barW) out += " ".repeat(barW - used);
		return out;
	}

	private renderLegend(
		models: string[],
		styles: Map<string, { color: ColorToken; glyph: string }>,
		w: number,
	): string[] {
		const fg = this.theme.fg.bind(this.theme);
		const chips: string[] = [];
		for (const model of models) {
			const style = styles.get(model)!;
			chips.push(`${fg(style.color, "■")} ${fg("dim", model)}`);
		}
		if (this.savingsOn) chips.push(`${fg("dim", "░")} ${fg("dim", "saved")}`);
		if (chips.length === 0) return [];

		// Wrap chips to width; "(by model)" suffix on the last legend line.
		const lines: string[] = [];
		let current = " ";
		let currentWidth = 1;
		for (const chip of chips) {
			const chipWidth = visibleWidth(chip) + 3; // chip + "   " gap
			if (currentWidth + chipWidth > w && current.trim() !== "") {
				lines.push(current);
				current = " ";
				currentWidth = 1;
			}
			current += chip + "   ";
			currentWidth += chipWidth;
		}
		const suffix = fg("muted", "(by model)");
		if (currentWidth + visibleWidth(suffix) + 1 <= w) {
			current += suffix;
		} else {
			lines.push(current);
			current = " " + suffix;
		}
		lines.push(current);
		lines.push("");
		return lines.map((l) => truncateToWidth(l, w));
	}

	private renderSavingsLine(fSavings: SavingsRow[], w: number): string {
		const fg = this.theme.fg.bind(this.theme);
		if (!this.savingsOn) {
			return " " + fg("muted", "savings  ") + fg("dim", "[s] off");
		}
		const s = computeSavingsSummary(fSavings);
		if (s.originalTokens <= 0) {
			return " " + fg("muted", "savings  ") + fg("dim", "lean-ctx: none recorded") + fg("dim", "   [s] on");
		}
		const usd = s.estSavedUsd >= 0.01 ? `  ~${formatUsd(s.estSavedUsd)}` : "";
		return truncateToWidth(
			" " +
				fg("muted", "savings  ") +
				fg("dim", `lean-ctx ${formatTokens(s.originalTokens)}→${formatTokens(s.compressedTokens)} tok`) +
				fg("success", usd) +
				fg("dim", "   [s] on"),
			w,
		);
	}

	private bucketLabel(bucket: string): string {
		// bucket is a strftime label: '%Y-%m-%d %H:00' | '%Y-%m-%d' | '%Y-%m'.
		switch (granularityFor(this.timeframe)) {
			case "hour":
				return bucket.length > 5 ? bucket.slice(5) : bucket; // MM-DD HH:00
			case "day":
				return bucket.length > 5 ? bucket.slice(5) : bucket; // MM-DD
			case "month":
				return bucket; // YYYY-MM
		}
	}

	/** Place `left` and `right` on one line, right-aligned `right`, clamped to w. */
	private spread(left: string, right: string, w: number): string {
		const lw = visibleWidth(left);
		const rw = visibleWidth(right);
		if (lw + rw + 1 > w) return truncateToWidth(left, w);
		const gap = w - lw - rw;
		return left + " ".repeat(gap) + right;
	}
}
