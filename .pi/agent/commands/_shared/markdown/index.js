// _shared/markdown — generic, pure markdown construction primitives. No review
// concepts here. Replaces the ad-hoc string building the SKILL.md prose did.

/** Escape a string for safe use inside a GFM table cell / inline context. */
export function escapeMd(s) {
	return String(s ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/\|/g, "\\|")
		.replace(/\r?\n/g, " ");
}

/** A GFM table from a header row + body rows (cells coerced + escaped). */
export function table(headers, rows) {
	const head = `| ${headers.map(escapeMd).join(" | ")} |`;
	const sep = `| ${headers.map(() => "---").join(" | ")} |`;
	const body = rows.map((r) => `| ${r.map(escapeMd).join(" | ")} |`).join("\n");
	return rows.length ? `${head}\n${sep}\n${body}` : `${head}\n${sep}`;
}

/** A `#`-level heading followed by body. */
export function section(title, body, level = 2) {
	const hashes = "#".repeat(Math.max(1, Math.min(6, level)));
	const text = body == null || body === "" ? "" : `\n\n${body}`;
	return `${hashes} ${title}${text}`;
}

/** A bulleted list (items coerced to strings, not escaped — may hold inline md). */
export function list(items) {
	return items.map((i) => `- ${i}`).join("\n");
}

/** A fenced code block. Language tag optional. */
export function codeFence(code, lang = "") {
	const body = String(code ?? "").replace(/\n$/, "");
	return `\`\`\`${lang}\n${body}\n\`\`\``;
}

/** A compact severity badge, e.g. `[BLOCKER]`. */
export function severityBadge(sev) {
	return `[${String(sev ?? "").toUpperCase()}]`;
}
