// simplify/patch — deterministic unified-diff assembler (PORTING-SPEC §8b). The
// novel module. Pure given file text: the caller passes `readFile(path) ->
// string|null`. For each eligible proposal it locates the `before` block in the
// REAL file bytes (verbatim, then whitespace-normalized via locateBlock), emits
// a hunk with 3 lines of real context, and groups hunks per file. Guarantee:
// every emitted hunk applies cleanly or is omitted (kept advisory upstream) —
// never half-applies fabricated code.

import { blockLineCount, locateBlock } from "../proposals/index.js";

/** Split into lines, dropping the single trailing "" produced by a final \n. */
function toLines(text) {
	const lines = String(text ?? "").split("\n");
	if (lines.length && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function afterLines(after) {
	const s = String(after ?? "");
	if (s === "") return [];
	return s.replace(/\n$/, "").split("\n");
}

/**
 * Build a single hunk for a located proposal, or null if it can't be located.
 * Uses the file's REAL bytes for context + removed lines (so normalized matches
 * still produce a clean patch).
 */
function buildHunk(fileLines, p) {
	const n = blockLineCount(p.before);
	const loc = locateBlock(fileLines.join("\n"), p.before, p.resolvedLine ?? p.line);
	if (loc.status === "not-found" || !Number.isFinite(loc.line)) return null;
	const start = loc.line; // 1-based start of the block
	if (start + n - 1 > fileLines.length) return null;

	const ctxStart = Math.max(1, start - 3);
	const ctxBefore = fileLines.slice(ctxStart - 1, start - 1);
	const removed = fileLines.slice(start - 1, start - 1 + n); // real bytes
	const ctxAfter = fileLines.slice(start - 1 + n, start - 1 + n + 3);
	const added = afterLines(p.after);

	const oldStart = ctxStart;
	const oldCount = ctxBefore.length + removed.length + ctxAfter.length;
	const newCount = ctxBefore.length + added.length + ctxAfter.length;

	const lines = [`@@ -${oldStart},${oldCount} +${oldStart},${newCount} @@`];
	for (const l of ctxBefore) lines.push(` ${l}`);
	for (const l of removed) lines.push(`-${l}`);
	for (const l of added) lines.push(`+${l}`);
	for (const l of ctxAfter) lines.push(` ${l}`);

	return { oldStart, oldEnd: oldStart + oldCount - 1, lines };
}

/**
 * Assemble a unified diff from ranked proposals.
 *   - eligible = interfaceImpact === "internal", has a path, non-empty before
 *   - caller-visible / not-located proposals are skipped (advisory upstream)
 *   - within a file, hunks are ordered by start and any overlapping later hunk
 *     is dropped (guarantees a clean `git apply`)
 *   - `max` caps the number of INCLUDED hunks (by the proposals' input order,
 *     which the orchestrator pre-ranks by impact)
 * Returns { text, included, omitted } — omitted is the list of proposals that
 * were eligible-by-interface but could not be located/placed.
 */
export function buildPatch(proposals, readFile, { max } = {}) {
	const cap = Number.isFinite(max) && max > 0 ? max : Infinity;
	const fileCache = new Map();
	const get = (path) => {
		if (!fileCache.has(path)) fileCache.set(path, toLines(readFile(path)));
		return fileCache.get(path);
	};

	const byFile = new Map(); // path -> hunk[]
	const omitted = [];
	let included = 0;

	for (const p of proposals) {
		if (included >= cap) break;
		if (p.patchable === false || p.patchExcludedReason) continue;
		if (!p.path || p.interfaceImpact !== "internal" || !String(p.before ?? "").trim()) continue;
		const fileLines = get(p.path);
		if (!fileLines || fileLines.length === 0) {
			omitted.push(p);
			continue;
		}
		const hunk = buildHunk(fileLines, p);
		if (!hunk) {
			omitted.push(p);
			continue;
		}
		const existing = byFile.get(p.path) || [];
		// drop a hunk that overlaps one already accepted for this file
		if (existing.some((h) => hunk.oldStart <= h.oldEnd && h.oldStart <= hunk.oldEnd)) {
			omitted.push(p);
			continue;
		}
		existing.push(hunk);
		byFile.set(p.path, existing);
		included++;
	}

	const blocks = [];
	for (const path of [...byFile.keys()].sort()) {
		const hunks = byFile.get(path).slice().sort((a, b) => a.oldStart - b.oldStart);
		const body = hunks.map((h) => h.lines.join("\n")).join("\n");
		blocks.push(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}`);
	}

	const text = blocks.length ? blocks.join("\n") + "\n" : "";
	return { text, included, omitted };
}
