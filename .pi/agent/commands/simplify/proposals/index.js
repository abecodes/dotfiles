// simplify/proposals — pure parsing + block location + ranking for the
// simplifier agent's output (PORTING-SPEC §4/§7). No I/O: index.js reads files
// and feeds text in. The agent emits prose then a single fenced ```json block
// of { proposals: [...] }; before/after are VERBATIM so the patch can match.
//
// Dual-model mode adds a conservative merge stage: exact same replacements are
// merged into consensus proposals, same-block/different-replacement proposals
// are grouped as model disagreements, and overlapping ranges are marked
// NO AUTO-PATCH so the patch builder never silently chooses one model.

const IMPACT_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const IMPACTS = ["HIGH", "MEDIUM", "LOW"];
const MODEL_ORDER = { sonnet: 0, codex: 1, opus: 2, gpt: 3, haiku: 4 };

/** Locate the LAST ```json fence; return { proseEnd, json } or null. */
function extractJsonBlock(text) {
	const fenceRe = /```json[^\n]*\n/gi;
	let m;
	let last = null;
	while ((m = fenceRe.exec(text)) !== null) last = m;
	if (!last) return null;
	const bodyStart = last.index + last[0].length;
	const closeRe = /\n```/g;
	closeRe.lastIndex = bodyStart;
	const cm = closeRe.exec(text);
	const bodyEnd = cm ? cm.index : text.length;
	return { proseEnd: last.index, json: text.slice(bodyStart, bodyEnd) };
}

function normalizeProposal(p, source) {
	const impact = String(p.impact ?? "LOW").toUpperCase();
	const iface = String(p.interfaceImpact ?? "internal") === "caller-visible" ? "caller-visible" : "internal";
	return {
		path: p.path != null ? String(p.path) : null,
		anchor: p.anchor != null ? String(p.anchor) : null,
		before: p.before != null ? String(p.before) : "",
		after: p.after != null ? String(p.after) : "",
		line: Number.isFinite(p.line) ? p.line : null,
		endLine: Number.isFinite(p.endLine) ? p.endLine : null,
		title: String(p.title ?? ""),
		category: String(p.category ?? ""),
		impact: IMPACTS.includes(impact) ? impact : "LOW",
		interfaceImpact: iface,
		rationale: String(p.rationale ?? ""),
		source,
		model: null,
		models: [],
		modelVariants: [],
		consensus: false,
		// resolved by the command (collate) + mergeProposals:
		patchable: false,
		resolvedLine: null,
		resolvedEnd: null,
		status: "not-found",
		patchExcludedReason: null,
		patchStatusLabel: null,
		conflictKind: null,
		conflictGroupId: null,
		conflictsWith: [],
		deckId: null,
	};
}

/**
 * Parse an agent reply into { source, prose, proposals }. Prose is everything
 * before the last ```json fence. On any parse/shape failure the whole text is
 * kept as prose and proposals is [].
 */
export function parseProposals(text, source = "") {
	const raw = String(text ?? "");
	const fail = (prose) => ({ source, prose, proposals: [], parseError: true });
	const block = extractJsonBlock(raw);
	if (!block) return fail(raw.trim());
	let obj;
	try {
		obj = JSON.parse(block.json);
	} catch {
		return fail(raw.trim());
	}
	if (!obj || typeof obj !== "object" || !Array.isArray(obj.proposals)) return fail(raw.trim());
	return { source, prose: raw.slice(0, block.proseEnd).trim(), proposals: obj.proposals.map((p) => normalizeProposal(p, source)) };
}

function nearest(hits, hint) {
	if (!Number.isFinite(hint)) return hits[0];
	let best = hits[0];
	let bestD = Math.abs(best - hint);
	for (const n of hits) {
		const d = Math.abs(n - hint);
		if (d < bestD) {
			bestD = d;
			best = n;
		}
	}
	return best;
}

/**
 * Locate a (possibly multi-line) `before` block in the file (decision ②).
 *   verbatim   -> exact line-window match (1+ hits; nearest hint wins)
 *   normalized -> whitespace-normalized retry, requires a UNIQUE match
 *   not-found  -> neither
 * Returns { line, status } with line = 1-based start line (or null).
 */
export function locateBlock(fileText, before, hintLine) {
	const block = String(before ?? "");
	if (!block.trim()) return { line: null, status: "not-found" };
	const fileLines = String(fileText ?? "").split("\n");
	const blockLines = block.replace(/\n$/, "").split("\n");
	const n = blockLines.length;
	if (n === 0 || n > fileLines.length) return { line: null, status: "not-found" };

	const verbatim = [];
	for (let i = 0; i + n <= fileLines.length; i++) {
		let ok = true;
		for (let j = 0; j < n; j++) {
			if (fileLines[i + j] !== blockLines[j]) {
				ok = false;
				break;
			}
		}
		if (ok) verbatim.push(i + 1);
	}
	if (verbatim.length === 1) return { line: verbatim[0], status: "verbatim" };
	if (verbatim.length > 1) return { line: nearest(verbatim, hintLine), status: "verbatim" };

	const norm = (s) => s.trim().replace(/\s+/g, " ");
	const nb = blockLines.map(norm);
	const normHits = [];
	for (let i = 0; i + n <= fileLines.length; i++) {
		let ok = true;
		for (let j = 0; j < n; j++) {
			if (norm(fileLines[i + j]) !== nb[j]) {
				ok = false;
				break;
			}
		}
		if (ok) normHits.push(i + 1);
	}
	if (normHits.length === 1) return { line: normHits[0], status: "normalized" };

	return { line: null, status: "not-found" };
}

/** Number of lines a `before` block spans (>=1). */
export function blockLineCount(before) {
	const s = String(before ?? "");
	if (!s.trim()) return 1;
	return s.replace(/\n$/, "").split("\n").length;
}

export function spanOf(p) {
	const start = p.resolvedLine ?? p.line;
	if (!Number.isFinite(start)) return null;
	const explicitEnd = p.resolvedEnd ?? p.endLine;
	const end = Number.isFinite(explicitEnd) && explicitEnd >= start ? explicitEnd : start + blockLineCount(p.before) - 1;
	return [start, end];
}

function overlaps(a, b) {
	if (!a || !b) return false;
	return a[0] <= b[1] && b[0] <= a[1];
}

function uniqModels(models) {
	return [...new Set(models.filter(Boolean).map(String))].sort((a, b) => (MODEL_ORDER[a] ?? 99) - (MODEL_ORDER[b] ?? 99) || a.localeCompare(b));
}

function variantOf(p) {
	return {
		model: p.model || (Array.isArray(p.models) ? p.models[0] : null) || "unknown",
		title: p.title,
		category: p.category,
		impact: p.impact,
		after: p.after,
		rationale: p.rationale,
		source: p.source,
	};
}

function cloneProposal(p) {
	const models = uniqModels([...(Array.isArray(p.models) ? p.models : []), p.model]);
	return {
		...p,
		models,
		model: models.length === 1 ? models[0] : p.model,
		modelVariants: p.modelVariants?.length ? p.modelVariants.map((v) => ({ ...v })) : [variantOf({ ...p, model: models[0] || p.model })],
		conflictsWith: [],
	};
}

function mergeExact(items) {
	const ranked = rankByImpact(items);
	const base = cloneProposal(ranked[0]);
	const variants = [];
	const models = [];
	for (const item of ranked) {
		const copy = cloneProposal(item);
		models.push(...copy.models);
		for (const v of copy.modelVariants) {
			const key = `${v.model}\u0000${v.after}\u0000${v.rationale}`;
			if (!variants.some((existing) => `${existing.model}\u0000${existing.after}\u0000${existing.rationale}` === key)) variants.push({ ...v });
		}
	}
	base.models = uniqModels(models);
	base.model = base.models.length === 1 ? base.models[0] : null;
	base.consensus = base.models.length > 1;
	base.modelVariants = variants.sort((a, b) => (MODEL_ORDER[a.model] ?? 99) - (MODEL_ORDER[b.model] ?? 99) || String(a.model).localeCompare(String(b.model)));
	return base;
}

function blockKey(p) {
	const span = spanOf(p);
	if (!p.path || !span) return null;
	return `${p.path}\u0000${span[0]}\u0000${span[1]}\u0000${p.before}`;
}

function afterKey(p) {
	return String(p.after ?? "");
}

function addRef(a, b) {
	if (!a._conflictRefs) a._conflictRefs = new Set();
	a._conflictRefs.add(b);
}

function markNoAutoPatch(p, reason, kind = null) {
	p.patchExcludedReason = p.patchExcludedReason || reason;
	p.patchStatusLabel = "NO AUTO-PATCH";
	p.patchable = false;
	if (kind && !p.conflictKind) p.conflictKind = kind;
}

function patchReason(p) {
	if (p.conflictKind === "same-block-different-replacement") return "same-block-different-replacement";
	if (p.conflictKind === "overlap") return "overlap-conflict";
	if (p.interfaceImpact !== "internal") return "caller-visible";
	if (p.status !== "located") return p.status || "not-found";
	return null;
}

function assignPatchability(proposals) {
	for (const p of proposals) {
		const reason = patchReason(p);
		if (reason) markNoAutoPatch(p, reason, p.conflictKind);
		else {
			p.patchExcludedReason = null;
			p.patchStatusLabel = null;
			p.patchable = true;
		}
	}
}

function assignDeckIds(proposals) {
	let conflictN = 0;
	const sameBlockGroups = new Map();
	for (const p of proposals) {
		if (p.conflictKind !== "same-block-different-replacement") continue;
		if (!p.conflictGroupId) p.conflictGroupId = `conflict-${++conflictN}`;
		if (!sameBlockGroups.has(p.conflictGroupId)) sameBlockGroups.set(p.conflictGroupId, []);
		sameBlockGroups.get(p.conflictGroupId).push(p);
	}
	let propN = 0;
	for (const p of proposals) {
		p.deckId = p.conflictKind === "same-block-different-replacement" ? p.conflictGroupId : `prop-${propN++}`;
	}
	for (const p of proposals) {
		p.conflictsWith = p._conflictRefs ? [...new Set([...p._conflictRefs].map((q) => q.deckId).filter((id) => id && id !== p.deckId))] : [];
		delete p._conflictRefs;
	}
}

/** Sort proposals by impact, consensus, patchability, then path/start line. */
export function rankByImpact(proposals) {
	return proposals.slice().sort(
		(a, b) =>
			(IMPACT_ORDER[a.impact] ?? 3) - (IMPACT_ORDER[b.impact] ?? 3) ||
			Number(Boolean(b.consensus)) - Number(Boolean(a.consensus)) ||
			Number(b.patchable === true) - Number(a.patchable === true) ||
			String(a.path ?? "").localeCompare(String(b.path ?? "")) ||
			(a.resolvedLine ?? a.line ?? 0) - (b.resolvedLine ?? b.line ?? 0) ||
			String(a.title ?? "").localeCompare(String(b.title ?? "")),
	);
}

/**
 * Merge and mark proposals for presentation/patching.
 * - exact same block + exact same replacement => one consensus proposal
 * - same block + different replacement => grouped conflict, no auto-patch
 * - overlapping ranges => no auto-patch with cross-links
 */
export function mergeProposals(proposals) {
	const byBlock = new Map();
	const loose = [];
	for (const p of proposals.map(cloneProposal)) {
		const key = blockKey(p);
		if (!key) {
			loose.push(p);
			continue;
		}
		if (!byBlock.has(key)) byBlock.set(key, []);
		byBlock.get(key).push(p);
	}

	const merged = [...loose];
	let conflictN = 0;
	for (const group of byBlock.values()) {
		const byAfter = new Map();
		for (const p of group) {
			const key = afterKey(p);
			if (!byAfter.has(key)) byAfter.set(key, []);
			byAfter.get(key).push(p);
		}
		const replacements = [...byAfter.values()].map(mergeExact);
		if (replacements.length === 1) {
			merged.push(replacements[0]);
			continue;
		}
		const gid = `conflict-${++conflictN}`;
		for (const p of replacements) {
			p.conflictKind = "same-block-different-replacement";
			p.conflictGroupId = gid;
			markNoAutoPatch(p, "same-block-different-replacement", "same-block-different-replacement");
			for (const q of replacements) if (q !== p) addRef(p, q);
			merged.push(p);
		}
	}

	for (let i = 0; i < merged.length; i++) {
		for (let j = i + 1; j < merged.length; j++) {
			const a = merged[i];
			const b = merged[j];
			if (!a.path || a.path !== b.path) continue;
			if (a.conflictGroupId && a.conflictGroupId === b.conflictGroupId) continue;
			if (!overlaps(spanOf(a), spanOf(b))) continue;
			addRef(a, b);
			addRef(b, a);
			if (!a.conflictKind) markNoAutoPatch(a, "overlap-conflict", "overlap");
			if (!b.conflictKind) markNoAutoPatch(b, "overlap-conflict", "overlap");
		}
	}

	assignPatchability(merged);
	const ranked = rankByImpact(merged);
	assignDeckIds(ranked);
	return ranked;
}

/** Backwards-compatible name used by older call sites/tests. */
export function dedupe(proposals) {
	return mergeProposals(proposals);
}
