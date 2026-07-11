/**
 * preview.ts — option preview pane.
 *
 * Two render modes, both driven by `dialog.ts`:
 *   - "compact"    side-by-side with the option list; truncates long content
 *                  and shows a "… N lines hidden (p to expand)" footer.
 *   - "fullscreen" replaces the option list, scrollable; shows arrow
 *                  indicators on edges when more content is off-screen.
 *
 * Pure renderer: no key handling, no borders, no internal module imports.
 * The dialog mutates state via setters and routes keys (p / ↑ / ↓ / PgUp /
 * PgDn) to setMode/setScroll, then asks for a fresh render.
 */

import type { Component } from "@earendil-works/pi-tui";
import { Markdown, type MarkdownTheme, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";

export type PreviewMode = "compact" | "fullscreen";

const PLACEHOLDER_TEXT = "No preview";
const FULLSCREEN_HINT = "(p to exit)";

export class PreviewPane implements Component {
	private readonly theme: Theme;
	private readonly markdown: Markdown;
	private readonly mdTheme: MarkdownTheme;
	private content: string | undefined;
	private lastRenderedText: string | undefined;
	private mode: PreviewMode = "compact";
	private scroll = 0;
	private viewportHeight = 0;

	constructor(theme: Theme) {
		this.theme = theme;
		this.mdTheme = getMarkdownTheme();
		// Zero padding — the dialog controls outer chrome and spacing.
		this.markdown = new Markdown("", 0, 0, this.mdTheme);
	}

	/** Set the markdown text for the focused option (or undefined when none). */
	setContent(text: string | undefined): void {
		this.content = text;
		// Only re-seed the Markdown component when the source string changes
		// by reference — it does its own width-keyed line caching internally.
		if (text !== this.lastRenderedText) {
			this.markdown.setText(text ?? "");
			this.lastRenderedText = text;
		}
	}

	/** Switch between compact (side-by-side) and fullscreen layouts. */
	setMode(mode: PreviewMode): void {
		this.mode = mode;
	}

	/** Set the scroll offset (fullscreen mode); clamped at render time. */
	setScroll(offset: number): void {
		this.scroll = Math.max(0, Math.floor(offset));
	}

	/** Track the viewport row count so callers can query bounds without a width. */
	setViewportHeight(rows: number): void {
		this.viewportHeight = Math.max(0, Math.floor(rows));
	}

	/** Current scroll offset (last value passed to setScroll, unclamped). */
	getScroll(): number {
		return this.scroll;
	}

	/** Current render mode. */
	getMode(): PreviewMode {
		return this.mode;
	}

	/** Current preview source text (undefined when no preview is available). */
	getContent(): string | undefined {
		return this.content;
	}

	/** Total wrapped-line count for the current content at the given width. */
	getTotalLines(width: number): number {
		if (this.content === undefined) return 0;
		return this.markdown.render(Math.max(1, width)).length;
	}

	/** Maximum legal scroll offset for the given width and viewport. */
	getMaxScroll(width: number, viewportHeight: number): number {
		return Math.max(0, this.getTotalLines(width) - Math.max(0, viewportHeight));
	}

	/** Forward to the underlying Markdown so cached lines are recomputed. */
	invalidate(): void {
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const h = Math.max(0, this.viewportHeight);
		if (this.content === undefined) {
			return this.renderPlaceholder(w, h);
		}
		const lines = this.markdown.render(w);
		if (this.mode === "fullscreen") {
			return this.renderFullscreen(lines, w, h);
		}
		return this.renderCompact(lines, w, h);
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private muted(text: string): string {
		return this.theme.fg("muted", text);
	}

	private renderPlaceholder(width: number, height: number): string[] {
		const out: string[] = [];
		const middle = Math.floor(height / 2);
		const styled = this.muted(PLACEHOLDER_TEXT);
		const styledWidth = visibleWidth(styled);
		const pad = Math.max(0, Math.floor((width - styledWidth) / 2));
		const centered = " ".repeat(pad) + styled;
		const filler = truncateToWidth(centered, width, "…", true);
		for (let i = 0; i < height; i++) {
			out.push(i === middle ? filler : " ".repeat(width));
		}
		return out;
	}

	private renderCompact(lines: string[], width: number, height: number): string[] {
		if (height <= 0) return [];
		if (lines.length <= height) return padLines(lines, width, height);
		const shown = Math.max(0, height - 1);
		const hidden = lines.length - shown;
		const visible = padLines(lines.slice(0, shown), width, shown);
		const footer = `… ${hidden} lines hidden (p to expand)`;
		visible.push(this.muted(truncateToWidth(footer, width, "…", true)));
		return visible;
	}

	private renderFullscreen(lines: string[], width: number, height: number): string[] {
		if (height <= 0) return [];
		const maxScroll = Math.max(0, lines.length - height);
		const scroll = Math.min(Math.max(0, this.scroll), maxScroll);
		const slice = lines.slice(scroll, scroll + height);
		const padded = padLines(slice, width, height);
		const above = scroll;
		const below = Math.max(0, lines.length - (scroll + height));
		if (above > 0 && padded.length > 0) {
			const indicator = `↑ ${above} more above ${FULLSCREEN_HINT}`;
			padded[0] = this.muted(truncateToWidth(indicator, width, "…", true));
		}
		if (below > 0 && padded.length > 0) {
			const indicator = `↓ ${below} more below ${FULLSCREEN_HINT}`;
			padded[padded.length - 1] = this.muted(truncateToWidth(indicator, width, "…", true));
		}
		return padded;
	}
}

// ─── Module-private utilities ────────────────────────────────────────────────

/**
 * Right-pad each line to `width` and grow the array to `height` rows with
 * blank lines. `truncateToWidth(_, width, "…", true)` handles the per-line
 * width math in an ANSI-safe way.
 */
function padLines(lines: string[], width: number, height: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < height; i++) {
		const line = i < lines.length ? lines[i]! : "";
		out.push(truncateToWidth(line, width, "…", true));
	}
	return out;
}
