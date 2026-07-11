// review/report — pure markdown renderers for per-target review.md (SKILL.md §8)
// and group summary.md (§9). Uses _shared/markdown primitives. No I/O.

import { section, table } from "../../_shared/markdown/index.js";

const SEV_ORDER = { BLOCKER: 0, CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
const VERDICT_WORD = { BLOCKED: "DO NOT MERGE", "NEEDS-CHANGES": "NEEDS-CHANGES", APPROVED: "APPROVED" };

function bySeverity(a, b) {
	return (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);
}

function realFindings(findings) {
	return findings.filter((f) => !f.style).slice().sort(bySeverity);
}

function locStr(f) {
	if (!f.path) return "";
	if (f.line == null) return `\`${f.path}\``;
	const range = f.endLine && f.endLine !== f.line ? `-${f.endLine}` : "";
	return `\`${f.path}:${f.line}${range}\``;
}

function agentModel(f) {
	if (!f.agent) return "";
	const a = String(f.agent).replace(/-reviewer$/, "");
	return f.model ? `${a} · ${f.model}` : a;
}

function rationale(verdict, findings) {
	const real = realFindings(findings);
	if (verdict === "APPROVED" || real.length === 0) return "no blocking findings";
	return `strongest concern: ${real[0].title}`;
}

function findingsBlock(findings) {
	const real = realFindings(findings);
	if (real.length === 0) return "_No substantive findings._";
	return real
		.map((f) => {
			const loc = locStr(f);
			const by = agentModel(f);
			const head = `**[${f.severity}] [${f.category}] ${f.title}**`;
			const meta = [loc, by ? `_${by}_` : ""].filter(Boolean).join(" · ");
			const metaLine = meta ? `\n${meta}` : "";
			return `${head}${metaLine}\n\n**Problem:** ${f.problem}\n\n**Suggested fix:** ${f.fix}\n\n---`;
		})
		.join("\n\n");
}

function eli5Block(findings, synth) {
	const real = realFindings(findings);
	if (real.length === 0) return "_Nothing to explain._";
	const byTitle = new Map((synth?.eli5 ?? []).map((e) => [e.title, e]));
	return real
		.map((f, i) => {
			const e = byTitle.get(f.title) ?? synth?.eli5?.[i] ?? null;
			const whatsWrong = e?.whatsWrong || f.problem;
			const whyItMatters = e?.whyItMatters || "Left unaddressed this can surface as a defect in the affected path.";
			const howToFix = e?.howToFix || f.fix;
			return `### ${f.title}\n- **What's wrong:** ${whatsWrong}\n- **Why it matters:** ${whyItMatters}\n- **How to fix:** ${howToFix}`;
		})
		.join("\n\n");
}

function styleBlock(findings) {
	const style = findings.filter((f) => f.style);
	if (style.length === 0) return "_None._";
	return style
		.map((f) => {
			const by = agentModel(f);
			return `- ${locStr(f)} — ${f.title}: ${f.problem}${by ? ` _(${by})_` : ""}`;
		})
		.join("\n");
}

function rawOutputs(flags) {
	const implementation = flags.dual
		? [
				"- Implementation (sonnet): `.review/raw/implementation-reviewer-sonnet.md`",
				"- Implementation (codex): `.review/raw/implementation-reviewer-codex.md`",
			]
		: ["- Implementation: `.review/raw/implementation-reviewer.md`"];
	const lines = [
		"- Architecture: `.review/raw/architecture-reviewer.md`",
		...implementation,
		flags.maintainability
			? "- Maintainability: `.review/raw/maintainability-reviewer.md`"
			: "- Maintainability: skipped — --no-maintainability set",
		flags.security
			? "- Security: `.review/raw/security-reviewer.md`"
			: "- Security: skipped — --security not set",
	];
	return lines.join("\n");
}

function testResultsBlock(testResults) {
	const u = testResults?.untagged ?? "skipped";
	const i = testResults?.integration ?? "skipped";
	return `- Untagged: ${u}\n- Integration (\`-tags integration -count 1 -race\`): ${i}`;
}

/**
 * Per-target review.md. `flags` carries CLI flags plus run metadata
 * (testResults). `verdict` is the worst per-agent verdict.
 */
export function renderReviewMd(target, findings, synth, verdict, flags) {
	const reviewed = flags.reviewedAt || new Date().toISOString().replace(/\.\d+Z$/, "Z");
	const headHead = `${target.head_ref} @ ${target.head_sha}${target.dirty ? " + uncommitted" : ""}`;
	const word = VERDICT_WORD[verdict] || verdict;

	const parts = [
		`# Review — ${target.name}`,
		[
			`- Source: ${target.source}`,
			`- Base: ${target.base_ref} @ ${target.base_sha} / Head: ${headHead}`,
			`- Reviewed: ${reviewed}`,
		].join("\n"),
		section("TL;DR", synth?.tldr || "_No synthesis available._"),
		section("Verdict", `**${word}** — ${rationale(verdict, findings)}.`),
		section("Findings (paste-ready)", findingsBlock(findings)),
	];

	if (flags.eli5) parts.push(section("ELI5", eli5Block(findings, synth)));

	parts.push(section("Style notes", styleBlock(findings)));
	parts.push(section("Raw agent outputs", rawOutputs(flags)));
	parts.push(section("Test results", testResultsBlock(flags.testResults)));

	return parts.join("\n\n") + "\n";
}

// ─── Group summary.md ──────────────────────────────────────────────────────

function ccLocations(f) {
	if (!Array.isArray(f.evidence) || f.evidence.length === 0) return "";
	return f.evidence.map((e) => `\`${e.target}:${e.path}:${e.line}\``).join(", ");
}

function crosscutFindingsBlock(findings) {
	const real = realFindings(findings);
	if (real.length === 0) return "_No cross-cut findings._";
	return real
		.map((f) => {
			const involves = Array.isArray(f.involves) && f.involves.length ? ` _(involves: ${f.involves.join(", ")})_` : "";
			const loc = ccLocations(f);
			const locLine = loc ? `\n${loc}` : "";
			return `**[${f.severity}] [${f.category}] ${f.title}**${involves}${locLine}\n\n**Problem:** ${f.problem}\n\n**Suggested fix:** ${f.fix}\n\n---`;
		})
		.join("\n\n");
}

function groupRecommendation(perTarget, crosscutVerdict) {
	const all = perTarget.map((p) => p.verdict).concat(crosscutVerdict ? [crosscutVerdict] : []);
	if (all.includes("BLOCKED")) return "BLOCKED";
	if (all.includes("NEEDS-CHANGES")) return "NEEDS-CHANGES";
	return "APPROVED";
}

/**
 * Group summary.md. `perTarget` is [{ target, verdict, reviewMdRel }]. `crosscut`
 * is the parsed+resolved cross-cut reply ({ findings, merge_order, verdict }) or null.
 */
export function renderSummaryMd(group, perTarget, crosscut) {
	const reviewed = group.reviewedAt || new Date().toISOString().replace(/\.\d+Z$/, "Z");
	const ccVerdict = crosscut?.verdict || null;
	const groupRec = groupRecommendation(perTarget, ccVerdict);
	const word = VERDICT_WORD[groupRec] || groupRec;

	const verdictRows = perTarget.map((p) => [p.target.name, VERDICT_WORD[p.verdict] || p.verdict, p.reviewMdRel || ""]);

	const mergeOrder =
		crosscut?.merge_order && crosscut.merge_order.length
			? crosscut.merge_order.map((t, i) => `${i + 1}. ${t}`).join("\n")
			: "_No explicit ordering constraint._";

	const parts = [
		`# Group Review — ${group.name}`,
		`- Reviewed: ${reviewed}\n- Targets: ${perTarget.length}`,
		section("Per-target verdicts", table(["Target", "Verdict", "Report"], verdictRows)),
		section("Cross-cut verdict", ccVerdict ? `**${ccVerdict}** — ${rationale(ccVerdict, crosscut.findings)}.` : "_Cross-cut review unavailable._"),
		section("Cross-cut findings (paste-ready)", crosscut ? crosscutFindingsBlock(crosscut.findings) : "_None._"),
		section("Recommended commit/merge order", mergeOrder),
		section("Group recommendation", `**${word}** — BLOCKED if any per-target or cross-cut verdict is BLOCKED; NEEDS-CHANGES if any is NEEDS-CHANGES; otherwise APPROVED.`),
		section("Raw", "- Cross-cut: `.review/raw/cross-cut-reviewer.md`"),
	];
	return parts.join("\n\n") + "\n";
}
