/**
 * submit-tab.ts — review of all answers + Submit/Cancel picker.
 *
 * The dialog feeds a snapshot per question (set via setSnapshots). We render
 * a one-line summary per question and a two-row picker. canSubmit() is the
 * authoritative gate — the dialog must consult it (or rely on Enter on the
 * Submit row no-opping when not satisfiable).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { QuestionData } from "./tool.js";

export type AnswerSnapshot =
	| { kind: "unanswered" }
	| { kind: "option"; label: string }
	| { kind: "multi"; labels: string[] }
	| { kind: "custom"; text: string }
	| { kind: "chat" };

export interface SubmitTabOptions {
	theme: Theme;
	questions: readonly QuestionData[];
}

export class SubmitTab implements Component {
	private readonly theme: Theme;
	private readonly questions: readonly QuestionData[];
	private snapshots: readonly AnswerSnapshot[];
	private cursor: "submit" | "cancel" = "submit";

	onSubmit?: () => void;
	onCancel?: () => void;

	constructor(opts: SubmitTabOptions) {
		this.theme = opts.theme;
		this.questions = opts.questions;
		this.snapshots = this.questions.map(() => ({ kind: "unanswered" }));
	}

	setSnapshots(snapshots: readonly AnswerSnapshot[]): void {
		this.snapshots = snapshots;
	}

	getChoice(): "submit" | "cancel" {
		return this.cursor;
	}

	canSubmit(): boolean {
		return this.snapshots.every((s) => {
			if (s.kind === "unanswered") return false;
			if (s.kind === "multi" && s.labels.length === 0) return false;
			return true;
		});
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(this.bold("Review your answers"));
		const summaryWidth = Math.max(10, width - 6);
		for (let i = 0; i < this.questions.length; i++) {
			const s = this.snapshots[i] ?? { kind: "unanswered" };
			lines.push(`  Q${i + 1}: ${this.summarize(s, summaryWidth)}`);
		}
		lines.push("");

		const canSubmit = this.canSubmit();
		const submitMark = this.cursor === "submit" ? "[▶]" : "[ ]";
		const cancelMark = this.cursor === "cancel" ? "[▶]" : "[ ]";
		let submitLine = `${submitMark} Submit`;
		let cancelLine = `${cancelMark} Cancel`;
		if (!canSubmit) {
			submitLine = this.fg("muted", submitLine);
		} else if (this.cursor === "submit") {
			submitLine = this.fg("accent", submitLine);
		}
		if (this.cursor === "cancel") {
			cancelLine = this.fg("accent", cancelLine);
		}
		lines.push(submitLine);
		lines.push(cancelLine);
		return lines;
	}

	private summarize(s: AnswerSnapshot, maxW: number): string {
		switch (s.kind) {
			case "unanswered":
				return this.fg(
					"muted",
					"⚠ Answer remaining questions before submitting",
				);
			case "option":
				return truncateToWidth(s.label, maxW);
			case "multi":
				if (s.labels.length === 0) {
					return this.fg("muted", "⚠ Pick at least one option");
				}
				return truncateToWidth(
					`${s.labels.join(", ")} (${s.labels.length} selected)`,
					maxW,
				);
			case "custom":
				return truncateToWidth(s.text, maxW);
			case "chat":
				return "User wants to chat about this";
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
			this.cursor = this.cursor === "submit" ? "cancel" : "submit";
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (this.cursor === "submit") {
				if (this.canSubmit()) this.onSubmit?.();
			} else {
				this.onCancel?.();
			}
		}
	}

	invalidate(): void {}

	private fg(color: string, text: string): string {
		return this.theme.fg(color as never, text);
	}

	private bold(text: string): string {
		return this.theme.bold(text);
	}
}
