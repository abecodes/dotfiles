// review/findings — pure parsing + line-resolution. Replaces anchor-line.sh,
// resolve-lines.sh, and the Step 7/8 JSON-handling + verdict math. No I/O here;
// index.js reads files and feeds text in.
//
// resolveAnchorLine was promoted to _shared/findings (PORTING-SPEC §1a); it is
// re-exported here so existing review imports (index.js, this dir's tests) keep
// working unchanged.

import { resolveAnchorLine } from "../../_shared/findings/index.js";

export { resolveAnchorLine };

const VERDICTS = ["APPROVED", "NEEDS-CHANGES", "BLOCKED"];
const VERDICT_RANK = { APPROVED: 1, "NEEDS-CHANGES": 2, BLOCKED: 3 };

/** Locate the LAST ```json fence; return {proseEnd, json} or null. */
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

function normalizeVerdict(v) {
	const up = String(v ?? "").trim().toUpperCase();
	return VERDICTS.includes(up) ? up : "NEEDS-CHANGES";
}

/**
 * Parse an agent reply into { agent, prose, findings, verdict, test_results?,
 * merge_order? }. Prose is everything before the last ```json fence. On any
 * parse/shape failure the whole text is kept as prose, findings is [], and the
 * verdict degrades to NEEDS-CHANGES (never silently APPROVED).
 */
export function parseAgentReply(text, agent = "") {
	const raw = String(text ?? "");
	const fail = (prose) => ({ agent, prose, findings: [], verdict: "NEEDS-CHANGES", parseError: true });

	const block = extractJsonBlock(raw);
	if (!block) return fail(raw.trim());

	let obj;
	try {
		obj = JSON.parse(block.json);
	} catch {
		return fail(raw.trim());
	}
	if (!obj || typeof obj !== "object" || !Array.isArray(obj.findings)) {
		return fail(raw.trim());
	}

	const findings = obj.findings.map((f) => ({
		agent,
		severity: String(f.severity ?? "LOW").toUpperCase(),
		category: String(f.category ?? ""),
		title: String(f.title ?? ""),
		problem: String(f.problem ?? ""),
		fix: String(f.fix ?? ""),
		anchor: f.anchor != null ? String(f.anchor) : null,
		path: f.path != null ? String(f.path) : null,
		line: Number.isFinite(f.line) ? f.line : null,
		endLine: Number.isFinite(f.endLine) ? f.endLine : null,
		style: f.style === true,
		// cross-cut extras (absent on per-target findings)
		involves: Array.isArray(f.involves) ? f.involves.map(String) : undefined,
		evidence: Array.isArray(f.evidence) ? f.evidence : undefined,
	}));

	const reply = {
		agent,
		prose: raw.slice(0, block.proseEnd).trim(),
		findings,
		verdict: normalizeVerdict(obj.verdict),
	};
	if (obj.test_results && typeof obj.test_results === "object") reply.test_results = obj.test_results;
	if (Array.isArray(obj.merge_order)) reply.merge_order = obj.merge_order.map(String);
	return reply;
}

/** Map a position inside a unified diff to its source path:line. Ports
 * resolve-lines.sh; legacy fallback for anchorless findings. */
export function resolvePatchOffset(patchText, patchLine) {
	const want = Number(patchLine);
	if (!Number.isFinite(want)) return null;
	const lines = String(patchText ?? "").split("\n");
	let path = "";
	let newno = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const idx = i + 1;
		if (line.startsWith("+++ b/")) {
			path = line.slice("+++ b/".length);
			continue;
		}
		if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
		if (line.startsWith("@@")) {
			const m = /\+(\d+)/.exec(line);
			if (m) newno = Number(m[1]) - 1;
			continue;
		}
		if (/^(diff |index |new file|deleted file|similarity |rename |Binary )/.test(line)) continue;
		if (line.startsWith("-")) {
			if (idx === want) return { path, line: null, removed: true };
			continue;
		}
		// context, addition, or other body line advances the new-file counter
		newno++;
		if (idx === want) return { path, line: newno, removed: false };
	}
	return null;
}

/** Strongest verdict across a list: BLOCKED > NEEDS-CHANGES > APPROVED. */
export function worstVerdict(list) {
	let worst = "APPROVED";
	for (const v of list) {
		const n = normalizeVerdict(v);
		if (VERDICT_RANK[n] > VERDICT_RANK[worst]) worst = n;
	}
	return worst;
}
