/**
 * footer-layout
 *
 * Replaces pi's built-in footer so the extension status area can span
 * multiple lines. pi's native footer crams *every* ctx.ui.setStatus() entry
 * onto a single truncated line AND strips \n/\t from status text
 * (sanitizeStatusText), so line breaks are impossible without owning the
 * footer outright. ctx.ui.setFooter() is the only hook, and it replaces the
 * whole footer — hence we re-render the cwd + token-stats lines here too.
 *
 * Resulting layout:
 *   ~/Repos/project (branch)                         <- line 1: cwd
 *   ↑.. ↓.. R.. W.. CH..% $.. (sub) ..%/..  model    <- line 2: stats
 *   lean-ctx: …                                      <- line 3: lean-ctx alone
 *   agents: $.. (N runs | ↑.. ↓.. R.. W.. CH..%)  ⚠ … tokens  <- line 4: agents | warning
 *
 * Line 4 right-aligns the token-warning to the terminal edge ("tab-stop"
 * divider). Any extension status whose key we don't special-case is appended
 * on its own line so no information is silently dropped.
 *
 * Fidelity notes vs the native footer (both cosmetic, both unavoidable from an
 * extension): the experimental "xp" chip is dropped (the experimental-flag
 * check is core-internal), and the context "(auto)" suffix is assumed on (the
 * auto-compact flag is not exposed to extensions; "on" is the default and what
 * the native footer shows in the common case).
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";

// Status keys we lay out explicitly. Everything else falls through to extra lines.
const KEY_LEANCTX = "lean-ctx-saved";
const KEY_AGENTS = "subagent-cost";
const KEY_WARNING = "token-warning";

/** Strip control chars from status text (matches pi's sanitizeStatusText). */
function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

/** Compact token formatting, identical to pi's footer formatTokens. */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Replace home dir with ~, identical to pi's formatCwdForFooter. */
function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

/** Build the cwd line (line 1). */
function renderPwdLine(ctx: ExtensionContext, theme: Theme, branch: string | null, width: number): string {
	let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;
	return truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
}

/** Build the token-stats + model line (line 2), mirroring pi's native footer. */
function renderStatsLine(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	theme: Theme,
	providerCount: number,
	width: number,
): string {
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	let latestCacheHitRate: number | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const u = (entry.message as AssistantMessage).usage;
			totalInput += u.input;
			totalOutput += u.output;
			totalCacheRead += u.cacheRead;
			totalCacheWrite += u.cacheWrite;
			totalCost += u.cost.total;
			const promptTokens = u.input + u.cacheRead + u.cacheWrite;
			latestCacheHitRate = promptTokens > 0 ? (u.cacheRead / promptTokens) * 100 : undefined;
		}
	}

	const ctxUsage = ctx.getContextUsage();
	const contextWindow = ctxUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercentValue = ctxUsage?.percent ?? 0;
	const contextPercent = ctxUsage?.percent != null ? contextPercentValue.toFixed(1) : "?";

	const statsParts: string[] = [];
	if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
	if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
	if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
	if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
	if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
		statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
	}

	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
	if (totalCost || usingSubscription) {
		statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}

	// "(auto)" assumed on: the auto-compact flag is not exposed to extensions.
	const autoIndicator = " (auto)";
	const contextPercentDisplay =
		contextPercent === "?"
			? `?/${formatTokens(contextWindow)}${autoIndicator}`
			: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
	let contextPercentStr: string;
	if (contextPercentValue > 90) contextPercentStr = theme.fg("error", contextPercentDisplay);
	else if (contextPercentValue > 70) contextPercentStr = theme.fg("warning", contextPercentDisplay);
	else contextPercentStr = contextPercentDisplay;
	statsParts.push(contextPercentStr);

	let statsLeft = statsParts.join(" ");
	let statsLeftWidth = visibleWidth(statsLeft);
	if (statsLeftWidth > width) {
		statsLeft = truncateToWidth(statsLeft, width, "...");
		statsLeftWidth = visibleWidth(statsLeft);
	}

	const minPadding = 2;
	const modelName = ctx.model?.id || "no-model";
	let rightSideWithoutProvider = modelName;
	if (ctx.model?.reasoning) {
		const thinkingLevel = pi.getThinkingLevel() || "off";
		rightSideWithoutProvider =
			thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
	}

	let rightSide = rightSideWithoutProvider;
	if (providerCount > 1 && ctx.model) {
		rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
		if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
			rightSide = rightSideWithoutProvider;
		}
	}

	const rightSideWidth = visibleWidth(rightSide);
	const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
	let statsLine: string;
	if (totalNeeded <= width) {
		statsLine = statsLeft + " ".repeat(width - statsLeftWidth - rightSideWidth) + rightSide;
	} else {
		const availableForRight = width - statsLeftWidth - minPadding;
		if (availableForRight > 0) {
			const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
			const truncatedRightWidth = visibleWidth(truncatedRight);
			statsLine = statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth)) + truncatedRight;
		} else {
			statsLine = statsLeft;
		}
	}

	// statsLeft holds the colorized context% (which ends in a reset), so dim the
	// left and the remainder separately — same trick pi's footer uses.
	const dimStatsLeft = theme.fg("dim", statsLeft);
	const dimRemainder = theme.fg("dim", statsLine.slice(statsLeft.length));
	return dimStatsLeft + dimRemainder;
}

/**
 * Build line 4: agents on the left, the token-warning right-aligned to the
 * edge. When only one of the two is present it is left-aligned on its own.
 */
function renderAgentsWarningLine(agents: string | undefined, warning: string | undefined, theme: Theme, width: number): string {
	const left = agents ? sanitizeStatusText(agents) : "";
	const right = warning ? sanitizeStatusText(warning) : "";
	if (left && right) {
		const gap = width - visibleWidth(left) - visibleWidth(right);
		if (gap >= 2) return left + " ".repeat(gap) + right;
		// Not enough room to right-align: fall back to a single-space join.
		return truncateToWidth(`${left} ${right}`, width, theme.fg("dim", "..."));
	}
	return truncateToWidth(left || right, width, theme.fg("dim", "..."));
}

function buildFooterLines(ctx: ExtensionContext, pi: ExtensionAPI, theme: Theme, footerData: {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
}, width: number): string[] {
	const lines: string[] = [
		renderPwdLine(ctx, theme, footerData.getGitBranch(), width),
		renderStatsLine(ctx, pi, theme, footerData.getAvailableProviderCount(), width),
	];

	const statuses = footerData.getExtensionStatuses();
	const leanCtx = statuses.get(KEY_LEANCTX);
	const agents = statuses.get(KEY_AGENTS);
	const warning = statuses.get(KEY_WARNING);

	if (leanCtx) lines.push(truncateToWidth(sanitizeStatusText(leanCtx), width, theme.fg("dim", "...")));
	if (agents || warning) lines.push(renderAgentsWarningLine(agents, warning, theme, width));

	// Anything we don't special-case still gets shown, each on its own line.
	const known = new Set([KEY_LEANCTX, KEY_AGENTS, KEY_WARNING]);
	for (const [key, text] of Array.from(statuses.entries()).sort(([a], [b]) => a.localeCompare(b))) {
		if (known.has(key)) continue;
		lines.push(truncateToWidth(sanitizeStatusText(text), width, theme.fg("dim", "...")));
	}

	return lines;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		// Footer customization is a TUI-only concern.
		if (ctx.mode !== "tui") return;
		// Re-bind on every session_start (new/resume/fork/reload) so the closure
		// always reads the live session's data.
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					return buildFooterLines(ctx, pi, theme as unknown as Theme, footerData, width);
				},
			};
		});
	});
}
