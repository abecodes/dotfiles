// review/synth — pure helpers for the single `general`-agent synthesis call
// (TL;DR + ELI5). The command never hard-depends on the agent succeeding:
// parseSynth returns null on any malformed reply and the caller uses
// fallbackTldr.

const SEV_ORDER = { BLOCKER: 0, CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };

function bySeverity(a, b) {
	return (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);
}

/** Real (non-style) findings, severity-sorted. */
export function rankedFindings(findings) {
	return findings.filter((f) => !f.style).slice().sort(bySeverity);
}

/**
 * Prompt the `general` agent for a STRICT-JSON synthesis. The agent sees only
 * the distilled findings (not the raw diff), so this stays cheap and bounded.
 */
export function synthPrompt(target, findings, { eli5 = true } = {}) {
	const ranked = rankedFindings(findings);
	const lines = ranked.length
		? ranked
				.map((f, i) => `${i + 1}. [${f.severity}] [${f.category}] ${f.title} — ${f.problem}`)
				.join("\n")
		: "(no substantive findings)";

	const eli5Clause = eli5
		? `, "eli5": [{ "title": string, "whatsWrong": string (1-2 plain sentences), "whyItMatters": string (one concrete failure mode), "howToFix": string (plain-English sketch) }]`
		: "";
	const eli5Note = eli5
		? `Produce one eli5 entry per finding above, in the same order, junior-engineer friendly.`
		: `Omit the eli5 field (or set it to []).`;

	return `You are synthesizing a code-review digest for "${target.name}".

Change under review: ${target.repo} — base ${target.base_ref} @ ${target.base_sha}, head ${target.head_ref} @ ${target.head_sha}${target.dirty ? " + uncommitted" : ""}.

Findings (already distilled by the reviewers, severity order):
${lines}

Reply with ONE fenced \`\`\`json block and nothing else. Schema:
{ "tldr": string (2-4 sentences: what the change does + the headline concerns)${eli5Clause} }

${eli5Note}
Ground every sentence in the findings above. Do not invent issues that are not listed.`;
}

function extractJson(text) {
	const raw = String(text ?? "");
	const fence = /```json[^\n]*\n([\s\S]*?)\n```/i.exec(raw);
	if (fence) return fence[1];
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start !== -1 && end > start) return raw.slice(start, end + 1);
	return null;
}

/** Parse the synth agent's reply, or null on any failure. */
export function parseSynth(text) {
	const json = extractJson(text);
	if (!json) return null;
	let obj;
	try {
		obj = JSON.parse(json);
	} catch {
		return null;
	}
	if (!obj || typeof obj !== "object" || typeof obj.tldr !== "string") return null;
	const eli5 = Array.isArray(obj.eli5)
		? obj.eli5.map((e) => ({
				title: String(e.title ?? ""),
				whatsWrong: String(e.whatsWrong ?? ""),
				whyItMatters: String(e.whyItMatters ?? ""),
				howToFix: String(e.howToFix ?? ""),
			}))
		: [];
	return { tldr: obj.tldr.trim(), eli5 };
}

/** Deterministic TL;DR built from the top finding titles when synth fails. */
export function fallbackTldr(findings) {
	const ranked = rankedFindings(findings);
	if (ranked.length === 0) return "No substantive findings — the reviewers raised no blocking or major concerns.";
	const top = ranked.slice(0, 3).map((f) => `${f.title} (${f.severity})`);
	const more = ranked.length > 3 ? ` Plus ${ranked.length - 3} more finding(s).` : "";
	return `${ranked.length} finding(s) across the change. Headline concerns: ${top.join("; ")}.${more}`;
}
