/**
 * ask-user-question — pi extension entry point.
 *
 * Registers the `ask_user_question` tool. Because pi enumerates
 * `~/.pi/agent/extensions/` ahead of npm-package extensions configured in
 * `~/.pi/agent/settings.json` (FIRST-WINS aggregation), this local extension
 * shadows the upstream `@juicesharp/rpiv-ask-user-question` without any
 * settings edits — the tool name is identical and the response envelope is
 * byte-compatible with the upstream contract.
 *
 * Companion: `~/.pi/agent/extensions/quiet-prompts.ts` matches on
 * `event.toolName === "ask_user_question"` for the scrollback-while-prompting
 * fix; keeping the same registered name preserves that wiring.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Dialog } from "./dialog.js";
import {
	buildEnvelope,
	buildToolResult,
	DEFAULT_PROMPT_GUIDELINES,
	DEFAULT_PROMPT_SNIPPET,
	ERROR_NO_UI,
	type QuestionnaireResult,
	type QuestionParams,
	QuestionParamsSchema,
	TOOL_DESCRIPTION,
	validateQuestionnaire,
} from "./tool.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description: TOOL_DESCRIPTION,
		promptSnippet: DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: DEFAULT_PROMPT_GUIDELINES,
		parameters: QuestionParamsSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const typed = params as QuestionParams;
			if (!ctx.hasUI) {
				return buildToolResult(ERROR_NO_UI, {
					answers: [],
					cancelled: true,
					error: "no_ui",
				});
			}
			const v = validateQuestionnaire(typed);
			if (!v.ok) {
				return buildToolResult(v.message, {
					answers: [],
					cancelled: true,
					error: v.error,
				});
			}
			// Hold a reference so the signal listener can cancel the dialog.
			// The factory captures `dialog` by closure; ctx.ui.custom wires the
			// returned Component into the TUI overlay layer.
			let dialog: Dialog | undefined;
			const onAbort = () => dialog?.cancel();
			signal?.addEventListener("abort", onAbort, { once: true });
			try {
				const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
					dialog = new Dialog({ tui, theme, params: typed, done });
					return dialog;
				});
				return buildEnvelope(result, typed);
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
	});
}
