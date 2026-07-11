/**
 * quiet-prompts
 *
 * Suppresses pi's streaming working indicator while a UI-prompting tool is
 * executing. Without this, the indicator's animation timer fires every ~120ms,
 * which causes pi to re-render, which in turn causes Kitty (and most other
 * terminals) to snap the scrollback view back to the bottom on every tick.
 * That makes it impossible to scroll up and read the model's prose preceding
 * the dialog.
 *
 * Add tool names to QUIET_TOOLS to extend coverage. The allow-list extension
 * still handles its own prompts inline via withQuietUI() (it predates this
 * helper); everything else opts in here.
 *
 * The lsp extension's path-based tools (`lsp_hover` etc.) can prompt when
 * they auto-trigger the install flow for a not-yet-registered file type, and
 * `lsp_install`/`lsp_scan` always prompt — so all nine LSP tools live in the
 * set even though most calls don't actually open a dialog. Suppressing the
 * working indicator for the (subsecond) silent calls is harmless.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const QUIET_TOOLS = new Set<string>([
	"ask_user_question",
	// LSP extension — see header comment.
	"lsp_hover",
	"lsp_references",
	"lsp_definition",
	"lsp_implementations",
	"lsp_workspace_symbols",
	"lsp_document_symbols",
	"lsp_diagnostics",
	"lsp_install",
	"lsp_scan",
]);

export default function (pi: ExtensionAPI) {
	let suppressedFor = 0; // re-entrancy / overlap guard

	pi.on("tool_execution_start", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (!QUIET_TOOLS.has(event.toolName)) return;
		suppressedFor++;
		ctx.ui.setWorkingVisible(false);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (!QUIET_TOOLS.has(event.toolName)) return;
		suppressedFor = Math.max(0, suppressedFor - 1);
		// Only restore once all overlapping tool calls have finished.
		if (suppressedFor === 0) {
			ctx.ui.setWorkingVisible(true);
		}
	});
}
