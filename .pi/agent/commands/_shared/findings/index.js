// _shared/findings — generic, pure finding line-resolution shared across
// commands. `resolveAnchorLine` was promoted out of review/findings (PORTING-SPEC
// §1a); review/findings keeps the review-specific parseAgentReply/worstVerdict
// and re-imports this. No I/O — callers read files and feed text in.

/**
 * Resolve a finding's true source line from its verbatim anchor (literal
 * substring match, 1-based). Ports anchor-line.sh.
 *   0 matches  -> { line: hintLine, status: "not_found" }
 *   1 match    -> { line, status: "unique" }
 *   >1 matches -> nearest to hintLine (or first), status "ambiguous"
 */
export function resolveAnchorLine(fileText, anchor, hintLine) {
	const hint = Number.isFinite(hintLine) ? hintLine : null;
	if (anchor == null || anchor === "") return { line: hint, status: "no_anchor" };
	const lines = String(fileText ?? "").split("\n");
	const matches = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(anchor)) matches.push(i + 1);
	}
	if (matches.length === 0) return { line: hint, status: "not_found" };
	if (matches.length === 1) return { line: matches[0], status: "unique" };
	if (hint == null) return { line: matches[0], status: "ambiguous" };
	let best = matches[0];
	let bestD = Math.abs(best - hint);
	for (const n of matches) {
		const d = Math.abs(n - hint);
		if (d < bestD) {
			bestD = d;
			best = n;
		}
	}
	return { line: best, status: "ambiguous" };
}
