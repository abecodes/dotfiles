/**
 * option-list.ts — renders one question tab body.
 *
 * Owns: row navigation (↑/↓), single/multi selection state, inline "Other"
 * editor lifecycle, per-row prefix glyph/checkbox styling, description
 * rendering on the focused row.
 *
 * Does NOT own: tab switching, preview toggle, dialog-level Esc. The dialog
 * routes those before us; we receive the rest via handleInput.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { buildSentinelRows, type QuestionData, SENTINEL_LABELS } from "./tool.js";

// Theme color names we read are referenced as strings to dodge ThemeColor
// import (string-typed at the call site is the agreed escape hatch).
type Colorer = (text: string) => string;

export type Row =
	| {
			kind: "option";
			index: number;
			label: string;
			description: string;
			preview?: string;
	  }
	| { kind: "other"; label: string }
	| { kind: "chat"; label: string }
	| { kind: "next"; label: string };

export interface OptionListOptions {
	tui: TUI;
	theme: Theme;
	question: QuestionData;
	multiSelect: boolean;
}

export class OptionList implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly question: QuestionData;
	private readonly multiSelect: boolean;
	private readonly rows: Row[];

	private cursor = 0;
	private selectedSingle: number | null = null;
	private readonly selectedSet = new Set<number>();

	private editor: Editor | null = null;
	private inEditor = false;
	private customText: string | null = null;
	private focused = false;

	onSelect?: (row: Row) => void;
	onCustomCommit?: (text: string) => void;
	onCustomCancel?: () => void;
	/** Fired after the cursor index changes (arrow keys or setCursor). */
	onCursorChange?: () => void;

	constructor(opts: OptionListOptions) {
		this.tui = opts.tui;
		this.theme = opts.theme;
		this.question = opts.question;
		this.multiSelect = opts.multiSelect;
		this.rows = this.buildRows();
	}

	private buildRows(): Row[] {
		const rows: Row[] = this.question.options.map((o, i) => ({
			kind: "option" as const,
			index: i,
			label: o.label,
			description: o.description,
			preview: o.preview,
		}));
		// Sentinel rows (commit/free-text/chat) are planned by a pure helper in
		// tool.ts so the render order stays in one place and is unit-testable.
		// `optionsOnly` questions get none — authored options + Esc only.
		for (const kind of buildSentinelRows(this.question, this.multiSelect)) {
			rows.push({ kind, label: SENTINEL_LABELS[kind] } as Row);
		}
		return rows;
	}

	// ─── Public introspection / mutation ─────────────────────────────────

	getRows(): readonly Row[] {
		return this.rows;
	}

	getCursor(): number {
		return this.cursor;
	}

	setCursor(i: number): void {
		const next = Math.max(0, Math.min(this.rows.length - 1, i));
		if (next !== this.cursor) {
			this.cursor = next;
			this.onCursorChange?.();
		} else {
			this.cursor = next;
		}
	}

	getFocusedRow(): Row {
		return this.rows[this.cursor]!;
	}

	getSelected(): number | null {
		return this.selectedSingle;
	}

	setSelected(i: number | null): void {
		this.selectedSingle = i;
	}

	getSelectedSet(): ReadonlySet<number> {
		return this.selectedSet;
	}

	toggleSelected(i: number): void {
		if (this.selectedSet.has(i)) this.selectedSet.delete(i);
		else this.selectedSet.add(i);
	}

	isInCustomEditor(): boolean {
		return this.inEditor;
	}

	getCustomText(): string | null {
		return this.customText;
	}

	enterCustomEditor(): void {
		if (!this.editor) {
			this.editor = new Editor(this.tui, this.buildEditorTheme());
			this.editor.onSubmit = (text: string) => {
				const trimmed = text.trim();
				if (trimmed.length === 0) return;
				this.customText = text;
				this.inEditor = false;
				if (this.editor) this.editor.focused = false;
				this.onCustomCommit?.(text);
			};
		}
		if (this.customText !== null) this.editor.setText(this.customText);
		this.inEditor = true;
		this.editor.focused = true;
	}

	/**
	 * Exit the inline editor without committing. Buffer is preserved so the user
	 * can re-enter and continue editing. The committing path runs through
	 * `editor.onSubmit` (wired in `enterCustomEditor`) — there is intentionally
	 * no public commit-from-outside method.
	 */
	exitCustomEditor(): void {
		if (!this.editor) {
			this.inEditor = false;
			return;
		}
		this.customText = this.editor.getText();
		this.inEditor = false;
		this.editor.focused = false;
	}

	setFocused(focused: boolean): void {
		this.focused = focused;
		if (this.editor) this.editor.focused = focused && this.inEditor;
	}

	// ─── Component impl ──────────────────────────────────────────────────

	render(width: number): string[] {
		const lines: string[] = [];
		for (let i = 0; i < this.rows.length; i++) {
			lines.push(...this.renderRow(this.rows[i]!, i === this.cursor, width));
		}
		return lines;
	}

	private renderRow(row: Row, isCursor: boolean, width: number): string[] {
		// Cursor prefix is the leftmost glyph; for single-select the selected
		// non-cursor row replaces it with a filled bullet.
		let prefix = isCursor ? "> " : "  ";
		if (
			!this.multiSelect &&
			row.kind === "option" &&
			!isCursor &&
			this.selectedSingle === row.index
		) {
			prefix = "● ";
		}

		// "Other" row + editor open + cursor on it → render editor in place.
		if (row.kind === "other" && isCursor && this.inEditor && this.editor) {
			const editorWidth = Math.max(1, width - visibleWidth(prefix));
			const editorLines = this.editor.render(editorWidth);
			return editorLines.map((l, idx) => (idx === 0 ? prefix : "  ") + l);
		}

		// Body text — for multi-select option rows include a checkbox.
		let body: string;
		if (this.multiSelect && row.kind === "option") {
			const checked = this.selectedSet.has(row.index) ? "[x] " : "[ ] ";
			body = checked + row.label;
		} else {
			body = row.label;
		}

		// Coloring rules:
		// - cursor row → accent
		// - single-select selected non-cursor option → accent
		// - sentinel rows (other/chat/next) → muted
		let displayed: string;
		if (isCursor) {
			displayed = this.fg("accent", body);
		} else if (
			!this.multiSelect &&
			row.kind === "option" &&
			this.selectedSingle === row.index
		) {
			displayed = this.fg("accent", body);
		} else if (row.kind !== "option") {
			displayed = this.fg("muted", body);
		} else {
			displayed = body;
		}

		const innerWidth = Math.max(1, width - visibleWidth(prefix));
		const wrapped = wrapTextWithAnsi(displayed, innerWidth);
		const out: string[] = [];
		for (let j = 0; j < wrapped.length; j++) {
			out.push((j === 0 ? prefix : "  ") + wrapped[j]);
		}

		// Description shown only on the focused option row (compact list).
		if (isCursor && row.kind === "option" && row.description.length > 0) {
			const indent = "    ";
			const descWidth = Math.max(1, width - indent.length);
			const wrappedDesc = wrapTextWithAnsi(
				this.fg("muted", row.description),
				descWidth,
			);
			for (const l of wrappedDesc) out.push(indent + l);
		}

		return out;
	}

	handleInput(data: string): void {
		// Editor mode: Esc exits us, everything else goes to the editor.
		if (this.inEditor && this.editor) {
			if (matchesKey(data, Key.escape)) {
				this.exitCustomEditor();
				this.onCustomCancel?.();
				return;
			}
			this.editor.handleInput(data);
			return;
		}

		if (matchesKey(data, Key.up)) {
			const next = Math.max(0, this.cursor - 1);
			if (next !== this.cursor) {
				this.cursor = next;
				this.onCursorChange?.();
			}
			return;
		}
		if (matchesKey(data, Key.down)) {
			const next = Math.min(this.rows.length - 1, this.cursor + 1);
			if (next !== this.cursor) {
				this.cursor = next;
				this.onCursorChange?.();
			}
			return;
		}
		if (matchesKey(data, Key.space)) {
			if (this.multiSelect) {
				const row = this.rows[this.cursor]!;
				if (row.kind === "option") this.toggleSelected(row.index);
			}
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const row = this.rows[this.cursor]!;
			switch (row.kind) {
				case "option":
					if (this.multiSelect) {
						this.toggleSelected(row.index);
					} else {
						this.selectedSingle = row.index;
						this.onSelect?.(row);
					}
					return;
				case "other":
					this.enterCustomEditor();
					return;
				case "chat":
				case "next":
					this.onSelect?.(row);
					return;
			}
		}
	}

	invalidate(): void {
		this.editor?.invalidate();
	}

	// ─── Helpers ─────────────────────────────────────────────────────────

	// Direct passthrough to Theme.fg — typed via `as` because pi-coding-agent's
	// ThemeColor union is internal to that package; we trust the caller passes a real Theme.
	private fg(color: string, text: string): string {
		return this.theme.fg(color as never, text);
	}

	private buildEditorTheme(): EditorTheme {
		const fg = (color: string, text: string) => this.fg(color, text);
		return {
			borderColor: (s: string) => fg("border", s),
			selectList: {
				selectedPrefix: (s: string) => fg("accent", s),
				selectedText: (s: string) => fg("accent", s),
				description: (s: string) => fg("muted", s),
				scrollInfo: (s: string) => fg("muted", s),
				noMatch: (s: string) => fg("muted", s),
			},
		};
	}
}
