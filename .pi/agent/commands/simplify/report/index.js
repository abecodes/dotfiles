// simplify/report — pure markdown renderer for report.md (PORTING-SPEC §8a).
// Uses _shared/markdown primitives. Proposals arrive already merged/ranked; the
// report keeps ALL of them and mirrors the deck's patchability truth with a
// consistent NO AUTO-PATCH label.

import { codeFence, section } from "../../_shared/markdown/index.js";

function locStr(p) {
	if (!p.path) return p.symbol ? `\`${p.symbol}\`` : "";
	const line = p.resolvedLine ?? p.line;
	return line != null ? `\`${p.path}:${line}\`` : `\`${p.path}\``;
}

function diffFence(before, after) {
	const minus = String(before ?? "")
		.replace(/\n$/, "")
		.split("\n")
		.map((l) => `-${l}`)
		.join("\n");
	const plus =
		String(after ?? "") === ""
			? ""
			: String(after)
					.replace(/\n$/, "")
					.split("\n")
					.map((l) => `+${l}`)
					.join("\n");
	return codeFence([minus, plus].filter(Boolean).join("\n"), "diff");
}

function isPatchable(p) {
	return p.patchable === true && !p.patchExcludedReason;
}

function modelsStr(p) {
	const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : [];
	if (models.length === 0) return "";
	return p.consensus ? `consensus: ${models.join(" + ")}` : `model: ${models.join(" + ")}`;
}

function reasonText(p) {
	const reason = p.patchExcludedReason || (p.patchable === false ? "not-patchable" : "");
	const map = {
		"caller-visible": "caller-visible change",
		"not-found": "target block was not found",
		"anchor-fallback": "only the anchor was found; full block was not located",
		"same-block-different-replacement": "model disagreement on the same code block",
		"overlap-conflict": "overlaps another proposal",
		unreadable: "target file could not be read",
	};
	return map[reason] || reason;
}

function noAutoLabel(p) {
	if (isPatchable(p)) return "";
	const reason = reasonText(p);
	return `**NO AUTO-PATCH${reason ? `: ${reason}` : ""}**`;
}

function conflictRefs(p) {
	return Array.isArray(p.conflictsWith) && p.conflictsWith.length ? `; conflicts with ${p.conflictsWith.map((id) => `\`#${id}\``).join(", ")}` : "";
}

function metaLine(p) {
	return [locStr(p), modelsStr(p), noAutoLabel(p) + conflictRefs(p)].filter(Boolean).join(" · ");
}

function proposalBlock(p) {
	const head = `**[${p.impact}] [${p.category}] ${p.title}**`;
	return `${head}\n${metaLine(p)}\n\n**Why simpler / behavior preserved:** ${p.rationale}\n\n${diffFence(p.before, p.after)}\n\n---`;
}

function proposalsBlock(proposals) {
	if (proposals.length === 0) return "_No simplifications proposed._";
	return proposals.map(proposalBlock).join("\n\n");
}

function callerVisibleBlock(proposals) {
	const cv = proposals.filter((p) => p.interfaceImpact !== "internal");
	if (cv.length === 0) return "_None — every proposal is an internal change._";
	return cv.map((p) => `- [${p.impact}] ${locStr(p)} — **${p.title}**: ${noAutoLabel(p)} — ${p.rationale}`).join("\n");
}

function notPatchableBlock(proposals) {
	const np = proposals.filter((p) => !isPatchable(p));
	if (np.length === 0) return "_None — every proposal is patchable._";
	return np.map((p) => `- [${p.impact}] ${locStr(p)} — **${p.title}**: ${noAutoLabel(p)}${conflictRefs(p)}`).join("\n");
}

function sameBlockGroups(proposals) {
	const groups = new Map();
	for (const p of proposals.filter((x) => x.conflictKind === "same-block-different-replacement")) {
		const key = p.conflictGroupId || `${p.path}:${p.resolvedLine}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(p);
	}
	return [...groups.entries()].map(([id, items]) => ({ id, items }));
}

function conflictsBlock(proposals) {
	const same = sameBlockGroups(proposals);
	const overlaps = proposals.filter((p) => p.conflictKind === "overlap");
	if (same.length === 0 && overlaps.length === 0) return "_None._";
	const parts = [];
	for (const group of same) {
		const first = group.items[0];
		parts.push(`### ${locStr(first)} — same block, different replacement (${group.id})\n\n${group.items.map((p) => `- ${modelsStr(p)} — **${p.title}**: ${p.rationale}`).join("\n")}`);
	}
	if (overlaps.length) {
		parts.push(
			`### Overlapping ranges\n\n${overlaps.map((p) => `- ${locStr(p)} — **${p.title}** (${modelsStr(p)}): ${noAutoLabel(p)}${conflictRefs(p)}`).join("\n")}`,
		);
	}
	return parts.join("\n\n");
}

function noAutoBreakdown(proposals) {
	const counts = new Map();
	for (const p of proposals.filter((x) => !isPatchable(x))) {
		const key = reasonText(p) || "not patchable";
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	if (counts.size === 0) return "";
	return `\n\nNo auto-patch breakdown:\n${[...counts.entries()].map(([k, v]) => `- ${v} ${k}`).join("\n")}`;
}

/**
 * Render report.md. `meta` = { scopeLabel, scopeDesc, generatedAt, focus,
 * patchRel, patchCount, models }. `proposals` are merged/resolved. `synth` =
 * { tldr } or null.
 */
export function renderReportMd(meta, proposals, synth) {
	const generated = meta.generatedAt || new Date().toISOString().replace(/\.\d+Z$/, "Z");
	const patchCount = Number.isFinite(meta.patchCount) ? meta.patchCount : proposals.filter(isPatchable).length;
	const models = Array.isArray(meta.models) && meta.models.length ? `\n- Models: ${meta.models.join(" + ")}` : "";

	const applyLine = meta.patchRel
		? patchCount > 0
			? `\`git apply ${meta.patchRel}\` applies the ${patchCount} patchable proposal(s).${noAutoBreakdown(proposals)}`
			: `_No patchable proposals — nothing to apply._${noAutoBreakdown(proposals)}`
		: `_Patch generation skipped (--no-patch)._${noAutoBreakdown(proposals)}`;

	const parts = [
		`# Simplify — ${meta.scopeLabel}`,
		[`- Scope: ${meta.scopeDesc}`, `- Generated: ${generated}`, `- Focus: ${meta.focus || "(none)"}${models}`].join("\n"),
		section("TL;DR", (synth && synth.tldr) || "_No synthesis available._"),
		section("Proposals (HIGH → MEDIUM → LOW)", proposalsBlock(proposals)),
		section("Model disagreements / conflicts", conflictsBlock(proposals)),
		section("Caller-visible (review before applying)", callerVisibleBlock(proposals)),
		section("Not auto-patchable", notPatchableBlock(proposals)),
		section("Apply", applyLine),
	];
	return parts.join("\n\n") + "\n";
}
