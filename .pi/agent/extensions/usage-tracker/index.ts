/**
 * usage-tracker — records one row per LLM call (in every process, top-level and
 * subagents at any depth) into a shared SQLite DB, and exposes an interactive
 * `/stats` dashboard.
 *
 * Loads in every pi process. In subagents it records their own calls with
 * depth/agent taken from env (see _shared/usage-store.ts attribution()).
 * Recording via `message_end` is mode-independent (fires under json/rpc too);
 * only the `/stats` dashboard is TUI-gated.
 *
 * See DESIGN.md for the full rationale.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { attribution, dbSizeBytes, pruneOlderThan, recordLlmUsage, resolveProject } from "../_shared/usage-store.ts";
import { StatsView } from "./stats-view.ts";
// TEMP: /stats-demo preview — uncomment with the registerCommand block below.
// import { demoData } from "./stats-demo.ts";

// Retention: prune rows older than 2 years (DESIGN §3 / §10.5).
const RETENTION_DAYS = 730;

function formatBytes(n: number): string {
	if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${n} B`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		const depth = attribution().depth;
		if (depth !== 0) return; // subagents neither set root_session, prune, nor notify

		// root_session groups this whole run (+ its subagent tree). getSessionId()
		// always returns a string, even under --no-session. Re-deriving on every
		// depth-0 session_start handles /new, /resume, /reload. Children inherit
		// the value via ...process.env at spawn.
		try {
			const sid = ctx.sessionManager.getSessionId();
			if (sid) process.env.PI_USAGE_ROOT_SESSION = sid;
		} catch {
			/* best-effort */
		}

		// Prune old rows once per process (cheap via the ts index).
		try {
			pruneOlderThan(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
		} catch {
			/* best-effort */
		}

		// One-time DB-size notice.
		try {
			const size = dbSizeBytes();
			if (size > 0) ctx.ui.notify(`usage.db: ${formatBytes(size)}`, "info");
		} catch {
			/* best-effort */
		}
	});

	pi.on("message_end", (event, ctx: ExtensionContext) => {
		const m = event.message;
		if (m.role !== "assistant" || !m.usage) return;
		recordLlmUsage({
			cwd: ctx.cwd,
			provider: m.provider ?? null,
			model: m.model ?? null,
			input: m.usage.input ?? 0,
			output: m.usage.output ?? 0,
			cacheRead: m.usage.cacheRead ?? 0,
			cacheWrite: m.usage.cacheWrite ?? 0,
			totalTokens: m.usage.totalTokens ?? 0,
			cost: m.usage.cost?.total ?? 0,
			stopReason: m.stopReason ?? null,
		});
	});

	// TEMP: live preview of the dashboard with fabricated data. To re-enable,
	// uncomment this block + the demoData import above (stats-demo.ts is kept).
	// pi.registerCommand("stats-demo", {
	// 	description: "Preview the /stats dashboard with fabricated demo data",
	// 	handler: async (_args, ctx) => {
	// 		if (ctx.mode !== "tui") {
	// 			ctx.ui.notify("/stats-demo is interactive-only (TUI mode)", "info");
	// 			return;
	// 		}
	// 		await ctx.ui.custom<void>((tui, theme, _kb, done) =>
	// 			new StatsView({
	// 				tui,
	// 				theme,
	// 				currentProject: ctx.cwd,
	// 				done: () => done(undefined),
	// 				dataProvider: demoData,
	// 			}),
	// 		);
	// 	},
	// });

	pi.registerCommand("stats", {
		description: "Show usage statistics: cost/tokens by timeframe, provider, model, agent",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/stats is interactive-only (TUI mode)", "info");
				return;
			}
			const currentProject = resolveProject(ctx.cwd);
			await ctx.ui.custom<void>((tui, theme, _kb, done) =>
				new StatsView({ tui, theme, currentProject, done: () => done(undefined) }),
			);
		},
	});
}
