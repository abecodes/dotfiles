/**
 * dialog.ts — stateful TUI dialog wired to ctx.ui.custom().
 *
 * Owns:
 *   - tab bar (one chip per question + a Submit chip)
 *   - global key router (Esc / Tab / arrows / p / etc.)
 *   - footer hint line (mode-dependent)
 *   - single PreviewPane whose content swaps as the focused option changes
 *   - per-question OptionList instances + the SubmitTab review pane
 *   - the answers Map (built incrementally from OptionList callbacks)
 *
 * Does NOT own row rendering, multi-select bookkeeping, "Other" editor
 * lifecycle (delegated to OptionList) or markdown rendering / scroll math
 * (delegated to PreviewPane).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { OptionList, type Row } from "./option-list.js";
import { PreviewPane } from "./preview.js";
import { SubmitTab, type AnswerSnapshot } from "./submit-tab.js";
import {
	MAX_HEADER_LENGTH,
	type QuestionAnswer,
	type QuestionnaireResult,
	type QuestionParams,
} from "./tool.js";

interface DialogOptions {
	tui: TUI;
	theme: Theme;
	params: QuestionParams;
	done: (result: QuestionnaireResult) => void;
}

export class Dialog implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly params: QuestionParams;
	private readonly done: (result: QuestionnaireResult) => void;

	private readonly optionLists: OptionList[];
	private readonly preview: PreviewPane;
	private readonly submit: SubmitTab;

	private activeTab = 0;
	private previewMode: "compact" | "fullscreen" = "compact";
	private previewScroll = 0;
	private readonly answers = new Map<number, QuestionAnswer>();
	private cancelled = false;

	private lastWidth = 80;
	private lastBodyHeight = 20;

	constructor(opts: DialogOptions) {
		this.tui = opts.tui;
		this.theme = opts.theme;
		this.params = opts.params;
		this.done = opts.done;

		this.optionLists = this.params.questions.map((q, i) => {
			const list = new OptionList({
				tui: this.tui,
				theme: this.theme,
				question: q,
				multiSelect: q.multiSelect ?? false,
			});
			list.onSelect = (row) => this.handleRowSelect(i, row);
			list.onCustomCommit = (text) => this.handleCustomCommit(i, text);
			list.onCustomCancel = () => {
				/* user just exited the inline editor; stay on the option list */
			};
			list.onCursorChange = () => {
				if (this.activeTab === i) this.refreshPreviewContent();
			};
			return list;
		});

		this.preview = new PreviewPane(this.theme);
		this.submit = new SubmitTab({
			theme: this.theme,
			questions: this.params.questions,
		});
		this.submit.onSubmit = () => this.commitAndDone();
		this.submit.onCancel = () => this.cancelAndDone();

		this.refreshPreviewContent();
		this.submit.setSnapshots(this.buildSnapshots());
	}

	// ─── Component impl ──────────────────────────────────────────────────

	render(width: number): string[] {
		this.lastWidth = Math.max(1, width);
		const termRows = this.readTerminalRows();
		// Reserve: tab bar (1) + separator (1) + footer (1) + outer chrome (~3).
		this.lastBodyHeight = Math.max(8, termRows - 6);

		const out: string[] = [];
		out.push(this.renderTabBar(this.lastWidth));
		out.push("");
		out.push(...this.renderBody(this.lastWidth, this.lastBodyHeight));
		out.push(this.renderFooter(this.lastWidth));
		return out;
	}

	handleInput(data: string): void {
		// 1. Esc — cascading semantics: exit preview → exit editor → cancel.
		if (matchesKey(data, Key.escape)) {
			if (this.previewMode === "fullscreen") {
				this.previewMode = "compact";
				this.previewScroll = 0;
				this.preview.setMode("compact");
				this.preview.setScroll(0);
				return;
			}
			const list = this.currentOptionList();
			if (list && list.isInCustomEditor()) {
				list.handleInput(data);
				return;
			}
			this.cancelAndDone();
			return;
		}

		// 2. Custom-editor passthrough — editor takes Tab, arrows, etc. as text.
		const list = this.currentOptionList();
		if (list && list.isInCustomEditor()) {
			list.handleInput(data);
			return;
		}

		// 3. Tab switching — only outside editor and outside fullscreen preview.
		if (this.previewMode !== "fullscreen") {
			if (matchesKey(data, Key.tab)) {
				this.changeTab((this.activeTab + 1) % this.tabCount());
				return;
			}
			if (matchesKey(data, Key.shift("tab"))) {
				this.changeTab((this.activeTab - 1 + this.tabCount()) % this.tabCount());
				return;
			}
			if (matchesKey(data, Key.left)) {
				this.changeTab(Math.max(0, this.activeTab - 1));
				return;
			}
			if (matchesKey(data, Key.right)) {
				this.changeTab(Math.min(this.tabCount() - 1, this.activeTab + 1));
				return;
			}
		}

		// 4. `p` — toggle fullscreen preview, only on a question tab with content.
		// Use matchesKey so this works under Kitty keyboard protocol too
		// (raw `data === "p"` would miss `\x1b[112u`).
		if (matchesKey(data, "p") && this.isQuestionTab() && this.hasPreviewContent()) {
			if (this.previewMode === "compact") {
				this.previewMode = "fullscreen";
				this.previewScroll = 0;
				this.preview.setMode("fullscreen");
				this.preview.setScroll(0);
			} else {
				this.previewMode = "compact";
				this.previewScroll = 0;
				this.preview.setMode("compact");
				this.preview.setScroll(0);
			}
			return;
		}

		// 5. Fullscreen preview — scroll keys.
		if (this.previewMode === "fullscreen") {
			const viewportHeight = this.lastBodyHeight;
			const previewWidth = this.lastWidth;
			const maxScroll = this.preview.getMaxScroll(previewWidth, viewportHeight);
			if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
				this.previewScroll = Math.max(0, this.previewScroll - 1);
				this.preview.setScroll(this.previewScroll);
				return;
			}
			if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
				this.previewScroll = Math.min(maxScroll, this.previewScroll + 1);
				this.preview.setScroll(this.previewScroll);
				return;
			}
			if (matchesKey(data, Key.pageUp)) {
				this.previewScroll = Math.max(0, this.previewScroll - viewportHeight);
				this.preview.setScroll(this.previewScroll);
				return;
			}
			if (matchesKey(data, Key.pageDown)) {
				this.previewScroll = Math.min(maxScroll, this.previewScroll + viewportHeight);
				this.preview.setScroll(this.previewScroll);
				return;
			}
			return;
		}

		// 6. Question tab (compact) — forward to OptionList. Cursor-driven
		// preview refresh fires via `onCursorChange` (wired in the constructor),
		// no explicit refresh needed here.
		if (this.isQuestionTab()) {
			this.optionLists[this.activeTab]!.handleInput(data);
			return;
		}

		// 7. Submit tab — forward to SubmitTab.
		this.submit.handleInput(data);
	}

	invalidate(): void {
		for (const list of this.optionLists) list.invalidate();
		this.preview.invalidate();
		this.submit.invalidate();
	}

	/**
	 * Called by pi's TUI when the overlay is torn down (agent abort, session
	 * shutdown, etc). Without this hook the Promise from `ctx.ui.custom()`
	 * would never resolve and the tool call would hang the agent loop.
	 */
	dispose(): void {
		this.cancelAndDone();
	}

	// ─── Row select handling ─────────────────────────────────────────────

	private handleRowSelect(qIndex: number, row: Row): void {
		const q = this.params.questions[qIndex]!;
		switch (row.kind) {
			case "option": {
				this.answers.set(qIndex, {
					questionIndex: qIndex,
					question: q.question,
					kind: "option",
					answer: row.label,
					...(row.preview && row.preview.length > 0 ? { preview: row.preview } : {}),
				});
				this.advanceTab();
				return;
			}
			case "chat": {
				this.answers.set(qIndex, {
					questionIndex: qIndex,
					question: q.question,
					kind: "chat",
					answer: null,
				});
				this.advanceTab();
				return;
			}
			case "next": {
				const list = this.optionLists[qIndex]!;
				const labels: string[] = [];
				for (let i = 0; i < q.options.length; i++) {
					if (list.getSelectedSet().has(i)) labels.push(q.options[i]!.label);
				}
				// Empty multi advance is a no-op: keep the user on this tab
				// rather than committing `selected: []` and letting the submit tab
				// gray out the Submit button (confusing). Reviewer F4.
				if (labels.length === 0) return;
				this.answers.set(qIndex, {
					questionIndex: qIndex,
					question: q.question,
					kind: "multi",
					answer: null,
					selected: labels,
				});
				this.advanceTab();
				return;
			}
			case "other":
				/* defensive: OptionList handles this by entering the inline editor */
				return;
		}
	}

	private handleCustomCommit(qIndex: number, text: string): void {
		const q = this.params.questions[qIndex]!;
		this.answers.set(qIndex, {
			questionIndex: qIndex,
			question: q.question,
			kind: "custom",
			answer: text,
		});
		this.advanceTab();
	}

	// ─── Tab navigation ──────────────────────────────────────────────────

	private advanceTab(): void {
		const next =
			this.activeTab + 1 < this.params.questions.length
				? this.activeTab + 1
				: this.params.questions.length;
		this.changeTab(next);
	}

	private changeTab(next: number): void {
		const clamped = Math.max(0, Math.min(this.tabCount() - 1, next));
		if (clamped === this.activeTab) {
			// Still re-snapshot in case answers changed elsewhere.
			this.submit.setSnapshots(this.buildSnapshots());
			this.refreshPreviewContent();
			return;
		}
		this.activeTab = clamped;
		this.previewMode = "compact";
		this.previewScroll = 0;
		this.preview.setMode("compact");
		this.preview.setScroll(0);
		this.refreshPreviewContent();
		this.submit.setSnapshots(this.buildSnapshots());
	}

	private tabCount(): number {
		return this.params.questions.length + 1; // +1 for the submit tab
	}

	private isQuestionTab(): boolean {
		return this.activeTab < this.params.questions.length;
	}

	private currentOptionList(): OptionList | null {
		return this.isQuestionTab() ? this.optionLists[this.activeTab]! : null;
	}

	// ─── Snapshots & preview content ─────────────────────────────────────

	private buildSnapshots(): AnswerSnapshot[] {
		return this.params.questions.map((_q, i): AnswerSnapshot => {
			const a = this.answers.get(i);
			if (!a) return { kind: "unanswered" };
			switch (a.kind) {
				case "option":
					return { kind: "option", label: a.answer ?? "" };
				case "multi":
					return { kind: "multi", labels: a.selected ?? [] };
				case "custom":
					return { kind: "custom", text: a.answer ?? "" };
				case "chat":
					return { kind: "chat" };
			}
		});
	}

	private refreshPreviewContent(): void {
		if (!this.isQuestionTab()) {
			this.preview.setContent(undefined);
			return;
		}
		const list = this.optionLists[this.activeTab]!;
		const row = list.getFocusedRow();
		if (row.kind === "option" && typeof row.preview === "string" && row.preview.length > 0) {
			this.preview.setContent(row.preview);
		} else {
			this.preview.setContent(undefined);
		}
	}

	private hasPreviewContent(): boolean {
		return this.preview.getContent() !== undefined;
	}

	// ─── Rendering helpers ───────────────────────────────────────────────

	private renderTabBar(width: number): string {
		const chips: string[] = [];
		for (let i = 0; i < this.params.questions.length; i++) {
			const q = this.params.questions[i]!;
			const header = truncateToWidth(q.header, MAX_HEADER_LENGTH, "…", false);
			chips.push(this.formatTabChip(header, i === this.activeTab));
		}
		const submitActive = this.activeTab === this.params.questions.length;
		chips.push(this.formatTabChip("Submit", submitActive));
		const joined = chips.join(" ");
		const inner = Math.max(1, width - 2);
		const trimmed = visibleWidth(joined) > inner ? truncateToWidth(joined, inner, "…", false) : joined;
		return ` ${trimmed}`;
	}

	private formatTabChip(label: string, active: boolean): string {
		if (active) {
			return this.bold(`[ ${label} ]`);
		}
		return `  ${label}  `;
	}

	private renderBody(width: number, bodyHeight: number): string[] {
		if (!this.isQuestionTab()) {
			const lines = this.submit.render(width);
			return this.fitToHeight(lines, bodyHeight);
		}

		const list = this.optionLists[this.activeTab]!;

		if (this.previewMode === "fullscreen") {
			this.preview.setViewportHeight(bodyHeight);
			this.preview.setScroll(this.previewScroll);
			return this.fitToHeight(this.preview.render(width), bodyHeight);
		}

		// Compact mode — side-by-side iff focused option has preview content
		// AND we have enough width that both panes render at usable size. Below
		// the threshold we fall back to options-only (the `… N lines hidden
		// (p to expand)` footer still gives the user a way to see the preview).
		const SIDE_BY_SIDE_MIN_WIDTH = 50;
		if (this.hasPreviewContent() && width >= SIDE_BY_SIDE_MIN_WIDTH) {
			const gutter = " │ ";
			const gutterWidth = visibleWidth(gutter);
			// Cap right pane at 80 cols, but never wider than half the available
			// width minus gutter. Floor at 20 only if the budget allows it.
			const halfBudget = Math.floor((width - gutterWidth) / 2);
			const rightWidth = Math.min(80, Math.max(20, halfBudget));
			const leftWidth = Math.max(1, width - rightWidth - gutterWidth);
			this.preview.setViewportHeight(bodyHeight);
			this.preview.setScroll(0);
			const leftLines = list.render(leftWidth);
			const rightLines = this.preview.render(rightWidth);
			const rows = bodyHeight;
			const out: string[] = [];
			for (let i = 0; i < rows; i++) {
				const left = padRight(leftLines[i] ?? "", leftWidth);
				const right = rightLines[i] ?? " ".repeat(rightWidth);
				out.push(`${left}${gutter}${right}`);
			}
			return out;
		}

		return this.fitToHeight(list.render(width), bodyHeight);
	}

	private fitToHeight(lines: string[], bodyHeight: number): string[] {
		const out = lines.slice(0, bodyHeight);
		while (out.length < bodyHeight) out.push("");
		return out;
	}

	private renderFooter(width: number): string {
		const hint = this.footerHint();
		const trimmed = truncateToWidth(hint, Math.max(1, width), "…", false);
		return this.muted(trimmed);
	}

	private footerHint(): string {
		if (this.previewMode === "fullscreen") {
			return "↑↓/PgUp PgDn scroll · p collapse · Esc exit";
		}
		if (!this.isQuestionTab()) {
			return "↑↓ navigate · Enter confirm · Esc cancel";
		}
		const q = this.params.questions[this.activeTab]!;
		const list = this.optionLists[this.activeTab]!;
		const inEditor = list.isInCustomEditor();
		if (inEditor) {
			return "Enter commit · Esc cancel editor";
		}
		const parts = ["Tab/← → switch", "↑↓ navigate", "Enter select"];
		if (q.multiSelect) parts.push("Space toggle");
		if (this.hasPreviewContent()) parts.push("p preview");
		parts.push("Esc cancel");
		return parts.join(" · ");
	}

	// ─── Termination ─────────────────────────────────────────────────────

	private commitAndDone(): void {
		if (this.cancelled) return;
		this.cancelled = true;
		const answers: QuestionAnswer[] = [];
		for (let i = 0; i < this.params.questions.length; i++) {
			const a = this.answers.get(i);
			if (a) answers.push(a);
		}
		this.done({ answers, cancelled: false });
	}

	private cancelAndDone(): void {
		if (this.cancelled) return;
		this.cancelled = true;
		this.done({ answers: [], cancelled: true });
	}

	// ─── Theme + terminal probes ─────────────────────────────────────────

	/** External cancel hook — wired by index.ts to ctx.signal so an agent
	 * abort during the dialog resolves the Promise from ctx.ui.custom. */
	cancel(): void {
		this.cancelAndDone();
	}

	private muted(text: string): string {
		return this.theme.fg("muted", text);
	}

	private bold(text: string): string {
		return this.theme.bold(text);
	}

	private readTerminalRows(): number {
		const term = this.tui?.terminal as unknown as { rows?: number } | undefined;
		const rows = term && typeof term.rows === "number" ? term.rows : 0;
		return rows > 0 ? rows : 24;
	}
}

// ─── Module-private utilities ────────────────────────────────────────────────

function padRight(line: string, width: number): string {
	const w = visibleWidth(line);
	if (w >= width) return truncateToWidth(line, width, "…", true);
	return line + " ".repeat(width - w);
}
