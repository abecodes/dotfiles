// simplify/deck — simplify-specific population of the generic _shared/deck
// shell (PORTING-SPEC §8c). Pure string building; the verbatim `before` slices
// are carried on each proposal (read in index.js), so nothing here touches the
// filesystem. Dual mode renders same-block model disagreements as comparison
// slides: current/problem on the left, model suggestions stacked on the right.

import { badge, card, chip, escapeHtml, htmlDoc, langFor, mdFence, SEVERITY_PALETTE, slide, splitColumns, stackedPanels } from "../../_shared/deck/index.js";

const IMPACT_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const IMPACTS = ["HIGH", "MEDIUM", "LOW"];
const MAX_CODE_LINES = 50;

function ranked(proposals) {
	return proposals
		.slice()
		.sort(
			(a, b) =>
				(IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) ||
				Number(Boolean(b.consensus)) - Number(Boolean(a.consensus)) ||
				Number(b.patchable === true) - Number(a.patchable === true) ||
				String(a.path ?? "").localeCompare(String(b.path ?? "")) ||
				(a.resolvedLine ?? a.line ?? 0) - (b.resolvedLine ?? b.line ?? 0),
		);
}

function loc(p) {
	if (!p.path) return p.symbol || "";
	const line = p.resolvedLine ?? p.line;
	return line != null ? `${p.path}:${line}` : p.path;
}

function codeHtml(text) {
	const s = String(text ?? "");
	if (!s.trim()) return '<p class="muted">(empty)</p>';
	const lines = s.replace(/\n$/, "").split("\n");
	const shown = lines.length > MAX_CODE_LINES ? lines.slice(0, MAX_CODE_LINES).join("\n") + "\n… (truncated, see report.md)" : lines.join("\n");
	return `<pre>${escapeHtml(shown)}</pre>`;
}

function counts(proposals) {
	const c = { HIGH: 0, MEDIUM: 0, LOW: 0 };
	for (const p of proposals) c[p.impact] = (c[p.impact] ?? 0) + 1;
	return c;
}

function badgeRow(proposals) {
	const c = counts(proposals);
	const row = IMPACTS.filter((s) => c[s] > 0)
		.map((s) => `${badge(s)} <span class="mono">${c[s]}</span>`)
		.join(" &nbsp; ");
	return row || '<span class="muted">no proposals</span>';
}

function modelList(p) {
	return Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : [];
}

function modelChips(p) {
	const models = modelList(p);
	if (p.consensus) return chip("CONSENSUS", { tone: "good" }) + models.map((m) => chip(m, { tone: "info" })).join("");
	return models.map((m) => chip(m, { tone: "info" })).join("");
}

function reasonText(p) {
	const reason = p.patchExcludedReason || (p.patchable === false ? "not-patchable" : "");
	const map = {
		"caller-visible": "caller-visible",
		"not-found": "target not found",
		"anchor-fallback": "anchor fallback only",
		"same-block-different-replacement": "same block disagreement",
		"overlap-conflict": "overlap conflict",
		unreadable: "unreadable target",
	};
	return map[reason] || reason;
}

function noAutoChip(p) {
	if (p.patchable === true && !p.patchExcludedReason) return "";
	return chip("NO AUTO-PATCH", { tone: "warn", title: reasonText(p) });
}

function conflictChip(p) {
	return p.conflictKind ? chip("CONFLICT", { tone: "danger", title: reasonText(p) }) : "";
}

function chipRow(p) {
	return `<span class="chips">${modelChips(p)}${noAutoChip(p)}${conflictChip(p)}</span>`;
}

function conflictLinks(p) {
	if (!Array.isArray(p.conflictsWith) || p.conflictsWith.length === 0) return "";
	return `<p class="muted">Conflicts with ${p.conflictsWith.map((id) => chip(`#${id}`, { tone: "danger", jump: id })).join(" ")}</p>`;
}

function slideTitle(meta, proposals) {
	const patchable = proposals.filter((p) => p.patchable === true && !p.patchExcludedReason).length;
	const noAuto = proposals.filter((p) => p.patchable === false || p.patchExcludedReason).length;
	const consensus = proposals.filter((p) => p.consensus).length;
	const models = Array.isArray(meta.models) && meta.models.length ? `<p class="muted">Models: ${escapeHtml(meta.models.join(" + "))}</p>` : "";
	const body = `
<h1>${escapeHtml(meta.scopeLabel)}</h1>
<p class="muted">${escapeHtml(meta.scopeDesc || "")} · ${escapeHtml(meta.generatedAt || "")}</p>
<p class="muted">Focus: ${escapeHtml(meta.focus || "(none)")}</p>
${models}
<div class="histo">${badgeRow(proposals)} ${chip(`${patchable} PATCHABLE`, { tone: "good" })} ${noAuto ? chip(`${noAuto} NO AUTO-PATCH`, { tone: "warn" }) : ""} ${consensus ? chip(`${consensus} CONSENSUS`, { tone: "good" }) : ""}</div>`;
	return slide({ id: "title", header: "Simplify", body });
}

function slideTldr(synth) {
	const tldr = (synth && synth.tldr) || "No synthesis available.";
	return slide({ id: "tldr", header: "TL;DR", body: `<p>${escapeHtml(tldr)}</p>` });
}

function slideOverview(proposals) {
	if (proposals.length === 0) return "";
	const cards = proposals
		.map((p) =>
			card({
				badge: badge(p.impact),
				meta: `${escapeHtml(p.category)} ${chipRow(p)}`,
				title: escapeHtml(p.title),
				body: `<span class="mono">${escapeHtml(loc(p))}</span> · ${escapeHtml(p.source || "")}${p.patchExcludedReason ? `<br>${escapeHtml(reasonText(p))}` : ""}`,
				accent: p.patchExcludedReason ? SEVERITY_PALETTE.HIGH : SEVERITY_PALETTE[p.impact],
				jump: p.deckId || "",
			}),
		)
		.join("");
	return slide({ id: "overview", header: "Proposals overview", body: `<div class="cards">${cards}</div>` });
}

/** Clean Markdown for one proposal: header + Current/Simpler fences + rationale. */
function proposalMarkdown(p) {
	const l = loc(p);
	const models = modelList(p).join(", ");
	const parts = [`# ${p.title}`, "", `**${p.impact} · ${p.category}**${l ? ` · \`${l}\`` : ""}${models ? ` · ${models}` : ""}`, ""];
	const lang = langFor(p.path);
	parts.push("## Current", "", mdFence(p.before, lang) || "_(empty)_", "");
	parts.push("## Simpler", "", mdFence(p.after, lang) || "_(empty)_", "");
	parts.push("## Why simpler / behavior preserved", "", String(p.rationale ?? "").trim());
	if (p.patchExcludedReason) parts.push("", `> NO AUTO-PATCH — ${reasonText(p)}. Not included in simplify.patch.`);
	return `${parts.join("\n").replace(/\n+$/, "")}\n`;
}

function slideProposal(p) {
	const header = `${badge(p.impact)} <span class="mono">${escapeHtml(p.category)}</span> · ${escapeHtml(p.title)} · <span class="mono">${escapeHtml(loc(p))}</span> ${chipRow(p)}`;
	const body = `
${splitColumns({ leftTitle: "Current", left: codeHtml(p.before), rightTitle: "Simpler", right: codeHtml(p.after) })}
<div class="rowfull"><h3>Why simpler / behavior preserved</h3><p>${escapeHtml(p.rationale)}</p>${p.patchExcludedReason ? `<p>${noAutoChip(p)} ${escapeHtml(reasonText(p))}. Not included in simplify.patch.</p>` : ""}${conflictLinks(p)}</div>`;
	return slide({ id: p.deckId, header, body, copy: proposalMarkdown(p) });
}

function sameBlockGroups(proposals) {
	const groups = new Map();
	for (const p of proposals.filter((x) => x.conflictKind === "same-block-different-replacement")) {
		const key = p.conflictGroupId || p.deckId || `${p.path}:${p.resolvedLine}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(p);
	}
	return [...groups.entries()].map(([id, items]) => ({ id, items }));
}

/** Clean Markdown for a same-block conflict: shared current + each model's variant. */
function conflictMarkdown(group) {
	const first = group.items[0];
	const l = loc(first);
	const models = [...new Set(group.items.flatMap(modelList))].join(" vs ");
	const parts = [
		"# Same block, different replacement",
		"",
		`**CONFLICT · NO AUTO-PATCH**${l ? ` · \`${l}\`` : ""}${models ? ` · ${models}` : ""}`,
		"",
		"Both models target the same code block but propose different replacements. Choose one manually.",
		"",
		"## Current",
		"",
		mdFence(first.before, langFor(first.path)) || "_(empty)_",
		"",
	];
	for (const p of group.items) {
		parts.push(`## ${modelList(p).join(", ") || p.title}`, "", mdFence(p.after, langFor(p.path)) || "_(empty)_", "");
		if (String(p.rationale ?? "").trim()) parts.push(String(p.rationale).trim(), "");
	}
	return `${parts.join("\n").replace(/\n+$/, "")}\n`;
}

function slideSameBlockConflict(group) {
	const first = group.items[0];
	const left = `
<p>${chip("NO AUTO-PATCH", { tone: "warn" })} ${chip("CONFLICT", { tone: "danger" })}</p>
<p>Both models target the same code block but propose different replacements. Choose one manually; this group is excluded from simplify.patch.</p>
${codeHtml(first.before)}`;
	const right = stackedPanels(
		group.items.map((p) => ({
			chip: modelChips(p),
			title: p.title,
			body: `${codeHtml(p.after)}<p>${escapeHtml(p.rationale)}</p>`,
		})),
	);
	const body = `
${splitColumns({ leftTitle: "Problem / current code", left, rightTitle: "Suggestions", right })}
<div class="rowfull"><h3>Conflict references</h3>${group.items.map((p) => `<p><span class="mono">${escapeHtml(loc(p))}</span> ${chipRow(p)} ${escapeHtml(reasonText(p))}</p>`).join("")}</div>`;
	const models = [...new Set(group.items.flatMap(modelList))].join(" vs ");
	const header = `${chip("NO AUTO-PATCH", { tone: "warn" })} ${chip("CONFLICT", { tone: "danger" })} Same block, different replacement · <span class="mono">${escapeHtml(loc(first))}</span> · ${escapeHtml(models)}`;
	return slide({ id: group.id, header, body, copy: conflictMarkdown(group) });
}

function slideCallerVisible(proposals) {
	const cv = proposals.filter((p) => p.interfaceImpact !== "internal");
	if (cv.length === 0) return "";
	const items = cv.map((p) => `<li>${badge(p.impact)} ${noAutoChip(p)} <span class="mono">${escapeHtml(loc(p))}</span> — ${escapeHtml(p.title)}: ${escapeHtml(p.rationale)}</li>`).join("");
	return slide({ id: "caller-visible", header: "Caller-visible (review before applying)", body: `<ul>${items}</ul>` });
}

function noAutoBreakdown(proposals) {
	const counts = new Map();
	for (const p of proposals.filter((x) => x.patchable === false || x.patchExcludedReason)) {
		const key = reasonText(p) || "not patchable";
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	if (counts.size === 0) return '<p class="muted">No no-auto-patch proposals.</p>';
	return `<ul>${[...counts.entries()].map(([k, v]) => `<li>${chip("NO AUTO-PATCH", { tone: "warn" })} ${v} — ${escapeHtml(k)}</li>`).join("")}</ul>`;
}

function slideApply(meta, proposals) {
	const patchCount = Number.isFinite(meta.patchCount) ? meta.patchCount : proposals.filter((p) => p.patchable === true && !p.patchExcludedReason).length;
	const cmd = meta.patchRel ? `git apply ${meta.patchRel}` : "(patch skipped)";
	const body = `
<p class="big" style="font-size:28px">${patchCount} patchable proposal(s)</p>
<pre>${escapeHtml(cmd)}</pre>
<p class="muted">${meta.patchRel ? "Applies only internal, located, non-conflicting proposals. NO AUTO-PATCH proposals are advisory (see report.md)." : "Patch generation was skipped (--no-patch)."}</p>
${noAutoBreakdown(proposals)}`;
	return slide({ id: "apply", header: "Apply", body });
}

/**
 * Full self-contained HTML deck. `meta` = { scopeLabel, scopeDesc, focus,
 * generatedAt, patchRel, patchCount, models }. `proposals` are merged/resolved.
 */
export function renderSimplifyDeck(meta, proposals, synth) {
	const order = ranked(proposals);
	const sameBlock = sameBlockGroups(order);
	const regular = order.filter((p) => p.conflictKind !== "same-block-different-replacement");
	const slides = [
		slideTitle(meta, order),
		slideTldr(synth),
		slideOverview(order),
		...regular.map((p) => slideProposal(p)),
		...sameBlock.map((g) => slideSameBlockConflict(g)),
		slideCallerVisible(order),
		slideApply(meta, order),
	].filter(Boolean);
	return htmlDoc({ title: `Simplify — ${meta.scopeLabel}`, slides });
}
