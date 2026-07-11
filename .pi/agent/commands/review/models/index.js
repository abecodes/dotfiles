// review/models — cross-model review panel selection. Pure; no I/O.
//
// /review reviews a diff; it does NOT author code, so the author's model is a
// parameter (`--author`, default sonnet). The reviewer panel is drawn from a
// diverse pool with the author model removed, so no reviewer shares the
// author's blind spots (a model reviewing its own output misses its own
// mistakes). `--dual` is a targeted override for the implementation lens: run
// implementation-reviewer twice, on sonnet and codex, while preserving the
// existing model choices for all other lenses. Synth (TL;DR/ELI5) and cross-cut
// stay cheap on sonnet — they relate already-distilled findings, where model
// diversity adds cost without value.
//
// The alias map + resolveModel + SYNTH_MODEL were promoted to _shared/models
// (PORTING-SPEC §1a); they are re-exported here so existing review imports
// (index.js, this dir's tests) keep working unchanged.

import { MODEL, resolveModel, SYNTH_MODEL } from "../../_shared/models/index.js";

export { MODEL, resolveModel, SYNTH_MODEL };

// Reviewer pool in assignment order. After removing the author and assigning
// the remainder to [architecture, implementation, maintainability, security],
// this reproduces:
//   author=sonnet -> opus / codex / gpt
//   author=codex  -> opus / sonnet / gpt
export const REVIEWER_POOL = ["opus", "codex", "sonnet", "gpt"];

/**
 * Assign a concrete model to each reviewer agent, excluding the author's model
 * so the panel never shares its blind spots. Returns `[{ agent, alias, model }]`
 * aligned to `agents`. If there are more agents than distinct non-author models,
 * it wraps around the pool (strongest first).
 */
export function pickReviewerModels(author, agents) {
	const pool = REVIEWER_POOL.filter((m) => m !== author);
	const effective = pool.length ? pool : REVIEWER_POOL;
	return agents.map((agent, i) => {
		const alias = effective[i % effective.length];
		return { agent, alias, model: MODEL[alias] };
	});
}

function withOutputName(entry) {
	return { ...entry, outputName: entry.agent };
}

/**
 * Build the concrete reviewer run list. Non-dual is the existing diverse panel.
 * Dual mode preserves non-implementation assignments, but replaces the single
 * implementation slot with two explicit implementation runs: sonnet, then codex.
 */
export function pickReviewerPanel(author, agents, { dual = false } = {}) {
	const base = pickReviewerModels(author, agents).map(withOutputName);
	if (!dual) return base;

	const out = [];
	for (const entry of base) {
		if (entry.agent !== "implementation-reviewer") {
			out.push(entry);
			continue;
		}
		out.push(
			{ agent: entry.agent, alias: "sonnet", model: MODEL.sonnet, outputName: "implementation-reviewer-sonnet" },
			{ agent: entry.agent, alias: "codex", model: MODEL.codex, outputName: "implementation-reviewer-codex" },
		);
	}
	return out;
}
