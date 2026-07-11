/**
 * dialog.ts — Subagent permission prompt dialog.
 *
 * Displayed by the subagent pump (Phase 3) when a child pi process sends an
 * `extension_ui_request` for a dialog method (select / confirm / input). Shows
 * enriched context so the user knows which agent is asking, for which task,
 * and which allow-list rule was matched — before they decide.
 *
 * Implements the pi-tui `Component` interface; rendered via `ctx.ui.custom()`.
 *
 * Mirrors the cancel() / done() idempotency pattern from
 * ask-user-question/dialog.ts (lines 485–497 there).
 *
 * Requires pi ≥ v0.75.0 (RPC mode).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface DialogParams {
	/** Which interaction style to show */
	method: "select" | "confirm" | "input";

	// ── Enrichment context ──────────────────────────────────────────────────
	/** Name of the agent that triggered the prompt */
	agentName: string;
	/** First ~80 chars of the agent's task (pre-truncated by the pump) */
	taskPreview: string;
	/**
	 * Tool call summary, e.g. "Bash(git push origin main)".
	 * Optional — RPC `extension_ui_request` payloads do not currently carry
	 * the originating tool name, so the pump leaves this undefined and the
	 * line is omitted from the header. Wire this up if/when the protocol
	 * starts including it.
	 */
	toolCall?: string;
	/**
	 * Matched rule string, e.g. "ask: Bash(git push:*)".
	 * Undefined for edge cases (unknown verdict passed down from child).
	 */
	matchedRule?: string;
	/**
	 * Free-form context lines captured from the child's `setWidget` calls
	 * (the child extension typically uses widgets to show what's being asked
	 * about — e.g. the bash command pending approval). Rendered as part of
	 * the header block, dim, between the Agent/Task lines and the divider.
	 * Each entry is one display row; the dialog clamps each to terminal width.
	 */
	extraLines?: string[];

	// ── Actual prompt ────────────────────────────────────────────────────────
	/** User-facing question title shown above the input UI */
	title: string;
	/** method="select": list of option strings the user can pick from */
	options?: string[];
	/** method="confirm": additional context message alongside yes/no */
	message?: string;
	/** method="input": placeholder hint rendered above the text field */
	placeholder?: string;
}

export type DialogResult =
	| { value: string } // select or input
	| { confirmed: boolean } // confirm
	| { cancelled: true }; // cancel / abort / timeout

// ─── Internal constants ────────────────────────────────────────────────────────

/** Width of the label column in the header ("Agent: " etc.) */
const LABEL_WIDTH = 7;

/** Cap for the "─" divider in the header */
const DIVIDER_MAX = 60;

// ─── Dialog ───────────────────────────────────────────────────────────────────

/**
 * Subagent permission dialog component.
 *
 * Phase 3's pump instantiates this as:
 * ```ts
 * const result = await ctx.ui.custom<DialogResult>((tui, theme, _kb, done) => {
 *   dialog = new Dialog({ tui, theme, params, done });
 *   return dialog;
 * });
 * ```
 * External cancellation (child crash / abort signal) calls
 * `dialog.cancel()` which is idempotent and resolves the Promise immediately.
 */
export class Dialog implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly params: DialogParams;
	private readonly doneCb: (result: DialogResult) => void;

	/** SelectList used for "select" and "confirm" modes */
	private readonly selectList?: SelectList;
	/** Input field used for "input" mode */
	private readonly inputField?: Input;

	/** Guards done() so it's called at most once */
	private finished = false;

	constructor(opts: {
		tui: TUI;
		theme: Theme;
		params: DialogParams;
		done: (result: DialogResult) => void;
	}) {
		this.tui = opts.tui;
		this.theme = opts.theme;
		this.params = opts.params;
		this.doneCb = opts.done;

		const { method, options } = this.params;

		if (method === "select") {
			const items: SelectItem[] = (options ?? []).map((o) => ({
				value: o,
				label: o,
			}));
			this.selectList = new SelectList(items, 8, this.makeSelectTheme());
			this.selectList.onSelect = (item: SelectItem) => this.finishSelect(item.value);
			this.selectList.onCancel = () => this.cancelAndDone();
		} else if (method === "confirm") {
			const items: SelectItem[] = [
				{ value: "yes", label: "Yes" },
				{ value: "no", label: "No" },
			];
			this.selectList = new SelectList(items, 4, this.makeSelectTheme());
			this.selectList.onSelect = (item: SelectItem) =>
				this.finishConfirm(item.value === "yes");
			this.selectList.onCancel = () => this.cancelAndDone();
		} else {
			// input mode
			this.inputField = new Input();
			this.inputField.focused = true;
			this.inputField.onSubmit = (value: string) => this.finishInput(value);
			this.inputField.onEscape = () => this.cancelAndDone();
		}
	}

	// ─── Component interface ─────────────────────────────────────────────────

	render(width: number): string[] {
		const w = Math.max(1, width);
		const out: string[] = [];

		// ── Header: enriched context ──────────────────────────────────────────
		out.push(...this.renderHeader(w));
		out.push("");

		// ── Prompt title ──────────────────────────────────────────────────────
		// allow-list and other extensions pack multi-line content (leaf
		// overview, full bash command, etc.) into the title with embedded
		// newlines. We MUST split here and push one array element per visual
		// row — otherwise pi-tui under-counts our component's row footprint
		// and the parent's chrome (cwd, status footer) renders ON TOP of our
		// extra rows, producing visible bleed.
		const titleLines = (this.params.title || "").split("\n");
		for (let i = 0; i < titleLines.length; i++) {
			const line = titleLines[i] ?? "";
			// First line is the actual prompt (bold for emphasis); remaining
			// lines are context (full command, overview) — regular weight.
			const styled = i === 0 ? this.theme.bold(line) : line;
			out.push(line === "" ? "" : this.clamp(styled, w));
		}

		// ── confirm: optional extra message ───────────────────────────────────
		if (this.params.method === "confirm" && this.params.message) {
			out.push("");
			for (const line of this.params.message.split("\n")) {
				out.push(line === "" ? "" : this.clamp(this.theme.fg("dim", line), w));
			}
		}

		out.push("");

		// ── Mode-specific prompt UI ───────────────────────────────────────────
		if (this.selectList) {
			out.push(...this.selectList.render(w));
		} else if (this.inputField) {
			// Render placeholder hint above the input widget
			if (this.params.placeholder) {
				out.push(
					this.clamp(this.theme.fg("muted", this.params.placeholder), w),
				);
			}
			out.push(...this.inputField.render(w));
		}

		// ── Footer hint ───────────────────────────────────────────────────────
		out.push(this.renderFooter(w));

		return out;
	}

	handleInput(data: string): void {
		if (this.finished) return;

		// Esc always cancels, regardless of sub-component state
		if (matchesKey(data, Key.escape)) {
			this.cancelAndDone();
			return;
		}

		if (this.selectList) {
			this.selectList.handleInput(data);
		} else if (this.inputField) {
			this.inputField.handleInput(data);
		}
	}

	invalidate(): void {
		this.selectList?.invalidate();
		this.inputField?.invalidate();
	}

	// ─── External cancel hook ─────────────────────────────────────────────────

	/**
	 * Called by the pump when the child process crashes or the abort signal
	 * fires. The user is the principal — there is no parent-side timeout, so
	 * the dialog stays open as long as the user needs.
	 *
	 * Idempotent: only the first invocation has any effect.
	 * Wiring pattern (index.ts):
	 * ```ts
	 * const onClose = () => dialog?.cancel();
	 * proc.once("close", onClose);
	 * signal?.addEventListener("abort", onClose, { once: true });
	 * ```
	 */
	cancel(): void {
		this.cancelAndDone();
	}

	// ─── Termination helpers ──────────────────────────────────────────────────

	private finishSelect(value: string): void {
		if (this.finished) return;
		this.finished = true;
		this.doneCb({ value });
	}

	private finishConfirm(confirmed: boolean): void {
		if (this.finished) return;
		this.finished = true;
		this.doneCb({ confirmed });
	}

	private finishInput(value: string): void {
		if (this.finished) return;
		this.finished = true;
		this.doneCb({ value });
	}

	private cancelAndDone(): void {
		if (this.finished) return;
		this.finished = true;
		this.doneCb({ cancelled: true });
	}

	// ─── Rendering helpers ────────────────────────────────────────────────────

	/**
	 * Renders the enriched-context header block above the actual prompt UI.
	 * Each field uses theme fg colors for visual hierarchy:
	 * - label → "muted"
	 * - agentName → "accent"
	 * - task / tool / rule → "dim"
	 */
	private renderHeader(width: number): string[] {
		const p = this.params;
		const lines: string[] = [];

		const field = (label: string, value: string, color: string): string => {
			const lbl = this.theme.fg("muted", label);
			const val = this.clamp(
				this.theme.fg(color as Parameters<Theme["fg"]>[0], value),
				width - LABEL_WIDTH,
			);
			return `${lbl}${val}`;
		};

		// Agent name (accent — highest visual weight)
		lines.push(field("Agent: ", p.agentName, "accent"));

		// Task preview (truncated upstream to ~80 chars; clamp again for safety)
		const taskPreview =
			p.taskPreview.length > 80
				? p.taskPreview.slice(0, 77) + "…"
				: p.taskPreview;
		lines.push(field("Task:  ", taskPreview, "dim"));

		// Tool call that triggered the prompt (omitted when not distinguishable
		// from the title — RPC payloads currently lack a separate tool field)
		if (p.toolCall && p.toolCall !== p.title) {
			lines.push(field("Tool:  ", p.toolCall, "dim"));
		}

		// Matched rule (absent for edge-case unknown-verdict paths)
		if (p.matchedRule) {
			lines.push(field("Rule:  ", p.matchedRule, "dim"));
		}

		// Captured child widget context (the actual content the user needs to
		// see to make a decision — typically the bash command being approved).
		// Each line is clamped to width independently. Empty array → no rows.
		if (p.extraLines && p.extraLines.length > 0) {
			for (const ln of p.extraLines) {
				lines.push(this.clamp(this.theme.fg("dim", ln), width));
			}
		}

		// Divider separating context from prompt
		lines.push(
			this.theme.fg("muted", "─".repeat(Math.min(width, DIVIDER_MAX))),
		);

		return lines;
	}

	private renderFooter(width: number): string {
		const hint =
			this.params.method === "input"
				? "Enter submit · Esc cancel"
				: "↑↓ navigate · Enter select · Esc cancel";
		return this.theme.fg(
			"muted",
			truncateToWidth(hint, Math.max(1, width), "…", false),
		);
	}

	/**
	 * Clamp `text` to at most `max` visible columns.
	 * Returns the text unchanged if it fits; truncates with ellipsis otherwise.
	 */
	private clamp(text: string, max: number): string {
		if (max <= 0) return "";
		return visibleWidth(text) > max
			? truncateToWidth(text, max, "…", true)
			: text;
	}

	/** Build the SelectListTheme using the current Theme's fg() helper. */
	private makeSelectTheme() {
		const fg = this.theme.fg.bind(this.theme);
		return {
			selectedPrefix: (s: string) => fg("accent", s),
			selectedText: (s: string) => fg("accent", s),
			description: (s: string) => fg("muted", s),
			scrollInfo: (s: string) => fg("muted", s),
			noMatch: (s: string) => fg("muted", s),
		};
	}
}
