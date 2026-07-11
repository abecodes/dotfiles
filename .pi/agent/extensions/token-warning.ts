/**
 * token-warning
 *
 * Adds a footer status entry warning when the active model's context usage
 * crosses a threshold (default 200k tokens). Updates reactively on every
 * assistant message and on session start / model change. Clears itself
 * (e.g. after /compact drops the context back below the threshold).
 *
 * Mechanism: ctx.ui.setStatus("token-warning", ...) — appends to the
 * existing footer; does not replace it.
 *
 * Tweak THRESHOLD below to change the trigger point.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const THRESHOLD = 200_000;
const STATUS_KEY = "token-warning";

function refresh(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const usage = ctx.getContextUsage();
	if (usage && usage.tokens > THRESHOLD) {
		const k = Math.round(usage.tokens / 1000);
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg("warning", `⚠ ${k}k tokens in context`),
		);
	} else {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		refresh(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		refresh(ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		refresh(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		refresh(ctx);
	});
}
