// simplify/synth — pure helpers for the single `general`-agent TL;DR synthesis
// (PORTING-SPEC §7/§9). Command-specific (NOT shared): the prompt asks only for
// { tldr } (no eli5/verdict). The command never hard-depends on the agent —
// parseSynth returns null on any malformed reply and the caller uses
// fallbackTldr. Mirrors review/synth's parse/fallback shape.

const IMPACT_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function byImpact(a, b) {
	return (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9);
}

/**
 * Prompt the `general` agent for a STRICT-JSON TL;DR. The agent sees only the
 * distilled proposals (not the source), so this stays cheap and bounded.
 */
export function synthPrompt(scopeLabel, proposals, focus = "(none)") {
	const ranked = proposals.slice().sort(byImpact);
	const lines = ranked.length
		? ranked
				.map((p, i) => {
					const models = Array.isArray(p.models) && p.models.length ? ` models=${p.models.join("+")}` : p.model ? ` model=${p.model}` : "";
					const consensus = p.consensus ? " consensus" : "";
					const noAuto = p.patchExcludedReason ? ` NO_AUTO_PATCH=${p.patchExcludedReason}` : "";
					return `${i + 1}. [${p.impact}] [${p.category}]${models}${consensus}${noAuto} ${p.title} — ${p.rationale}`;
				})
				.join("\n")
		: "(no simplifications proposed)";

	return `You are summarizing a set of behavior-preserving simplification proposals for "${scopeLabel}".

Focus area: ${focus}

Proposals (already distilled, impact order):
${lines}

Reply with ONE fenced \`\`\`json block and nothing else. Schema:
{ "tldr": string (2-4 sentences: the headline simplifications + the overall shape of the cleanup) }

Ground every sentence in the proposals above. Do not invent simplifications that are not listed. Do not write to disk.`;
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

/** Parse the synth agent's reply into { tldr }, or null on any failure. */
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
	return { tldr: obj.tldr.trim() };
}

/** Deterministic TL;DR built from the top proposals when synth fails. */
export function fallbackTldr(proposals) {
	const ranked = proposals.slice().sort(byImpact);
	if (ranked.length === 0) return "No behavior-preserving simplifications found — the code is already close to its simplest correct shape.";
	const top = ranked.slice(0, 3).map((p) => `${p.title} (${p.impact})`);
	const more = ranked.length > 3 ? ` Plus ${ranked.length - 3} more proposal(s).` : "";
	return `${ranked.length} simplification(s) proposed. Headline wins: ${top.join("; ")}.${more}`;
}
