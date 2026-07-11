// review/deck — review-specific population of the generic _shared/deck shell.
// Pure string building: code slices are pre-read in index.js (via c.read) and
// attached to findings as `codeSlice`, so nothing here touches the filesystem.
// Implements the SKILL.md §10 slide order + the never-fabricate-code rule:
// ROW-1-LEFT code is the verbatim codeSlice only; ROW-1-RIGHT is the agent fix.

import { badge, card, escapeHtml, htmlDoc, langFor, mdFence, SEVERITY_PALETTE, slide } from "../../_shared/deck/index.js";

const SEV_ORDER = { BLOCKER: 0, CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
const SEVERITIES = ["BLOCKER", "CRITICAL", "HIGH", "MEDIUM", "LOW"];
const VERDICT_WORD = { BLOCKED: "DO NOT MERGE", "NEEDS-CHANGES": "NEEDS-CHANGES", APPROVED: "APPROVED" };
const MAX_CODE_LINES = 50;

function realFindings(findings) {
	return findings.filter((f) => !f.style).slice().sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
}

function agentShort(agent) {
	return String(agent ?? "").replace(/-reviewer$/, "") || "review";
}

function agentModel(f) {
	const a = agentShort(f.agent);
	return f.model ? `${a} · ${f.model}` : a;
}

function loc(f) {
	if (!f.path) return "";
	if (f.line == null) return f.path;
	const range = f.endLine && f.endLine !== f.line ? `-${f.endLine}` : "";
	return `${f.path}:${f.line}${range}`;
}

/** Render review prose: fenced ```blocks``` become <pre>, inline `x` becomes <code>. */
function prose(text) {
	const raw = String(text ?? "");
	if (!raw.trim()) return "";
	const parts = raw.split(/```[^\n]*\n?/);
	// Even indices = prose, odd indices = code (split on fence markers).
	return parts
		.map((part, i) => {
			if (i % 2 === 1) return `<pre>${escapeHtml(part.replace(/\n$/, ""))}</pre>`;
			const html = escapeHtml(part)
				.replace(/`([^`]+)`/g, "<code>$1</code>")
				.replace(/\n{2,}/g, "</p><p>")
				.replace(/\n/g, "<br>");
			return part.trim() ? `<p>${html}</p>` : "";
		})
		.join("");
}

/** Verbatim source slice (never fabricated), truncated with a literal marker. */
function codeSliceHtml(slice) {
	const text = String(slice ?? "");
	if (!text.trim()) return "";
	const lines = text.split("\n");
	const shown = lines.length > MAX_CODE_LINES ? lines.slice(0, MAX_CODE_LINES).join("\n") + "\n… (truncated, see review.md)" : text;
	return `<pre>${escapeHtml(shown)}</pre>`;
}

function counts(findings) {
	const c = {};
	for (const s of SEVERITIES) c[s] = 0;
	for (const f of realFindings(findings)) c[f.severity] = (c[f.severity] ?? 0) + 1;
	return c;
}

function badgeRow(findings) {
	const c = counts(findings);
	return SEVERITIES.filter((s) => c[s] > 0)
		.map((s) => `${badge(s)} <span class="mono">${c[s]}</span>`)
		.join(" &nbsp; ");
}

function histogram(findings) {
	const c = counts(findings);
	const cells = SEVERITIES.map((s) => `<span style="color:${SEVERITY_PALETTE[s]}">${s} ${c[s]}</span>`).join("");
	return `<div class="histo">${cells}</div>`;
}

// ─── Per-target deck ────────────────────────────────────────────────────────

function slideTitle(target, findings) {
	const stats = target.stats || { files: 0, additions: 0, deletions: 0 };
	const dirty = target.dirty ? " + uncommitted" : "";
	const body = `
<h1>${escapeHtml(target.name)}</h1>
<p class="mono muted">${escapeHtml(target.source)}</p>
<p class="mono">${escapeHtml(target.base_ref)} @ ${escapeHtml(target.base_sha)} → ${escapeHtml(target.head_ref)} @ ${escapeHtml(target.head_sha)}${escapeHtml(dirty)}</p>
<p class="muted">${escapeHtml(target.reviewedAt || "")}</p>
<p class="mono">${stats.files} file(s) · <span style="color:${SEVERITY_PALETTE.LOW}">+${stats.additions}</span> / −${stats.deletions}</p>
<div class="histo">${badgeRow(findings) || '<span class="muted">no substantive findings</span>'}</div>`;
	return slide({ id: "title", header: "Code review", body });
}

function slideVerdict(verdict, findings) {
	const word = VERDICT_WORD[verdict] || verdict;
	const real = realFindings(findings);
	const rationale = verdict === "APPROVED" || real.length === 0 ? "no blocking findings" : `strongest concern: ${escapeHtml(real[0].title)}`;
	const color = verdict === "BLOCKED" ? SEVERITY_PALETTE.BLOCKER : verdict === "NEEDS-CHANGES" ? SEVERITY_PALETTE.HIGH : "#3fb950";
	const body = `<div class="big" style="color:${color}">${escapeHtml(word)}</div><p>${rationale}.</p>${histogram(findings)}`;
	return slide({ id: "verdict", header: "Verdict", body });
}

function slideTldr(synth) {
	return slide({ id: "tldr", header: "TL;DR", body: prose(synth?.tldr || "No synthesis available.") });
}

function slideOverview(findings) {
	const real = realFindings(findings);
	if (real.length === 0) return "";
	const cards = real
		.map((f, i) =>
			card({
				badge: badge(f.severity),
				meta: escapeHtml(f.category),
				title: escapeHtml(f.title),
				body: `<span class="mono">${escapeHtml(loc(f))}</span> · ${escapeHtml(agentModel(f))}`,
				accent: SEVERITY_PALETTE[f.severity],
				jump: `finding-${i}`,
			}),
		)
		.join("");
	return slide({ id: "overview", header: "Findings overview", body: `<div class="cards">${cards}</div>` });
}

/** Clean Markdown for one finding: header + Issue (prose + verbatim slice) + fix.
 *  `f.problem`/`f.fix` are already Markdown-ish (fences + inline code), so they
 *  pass through verbatim; the verbatim source slice is fenced separately. */
function findingMarkdown(f) {
	const l = loc(f);
	const parts = [`# ${f.title}`, "", `**${f.severity} · ${f.category}**${l ? ` · \`${l}\`` : ""} · ${agentModel(f)}`, "", "## Issue", ""];
	if (String(f.problem ?? "").trim()) parts.push(String(f.problem).trim(), "");
	const slice = mdFence(f.codeSlice, langFor(f.path));
	if (slice) parts.push(slice, "");
	parts.push("## Suggested Fix", "", String(f.fix ?? "").trim() || "_No fix supplied._");
	return `${parts.join("\n").replace(/\n+$/, "")}\n`;
}

function slideFinding(f, index, synth, flags) {
	const eli5 = (synth?.eli5 ?? []).find((e) => e.title === f.title) ?? null;
	const header = `${badge(f.severity)} <span class="mono">${escapeHtml(f.category)}</span> · ${escapeHtml(f.title)} · <span class="mono">${escapeHtml(loc(f))}</span> · ${escapeHtml(agentModel(f))}`;

	const issue = `${prose(f.problem)}${codeSliceHtml(f.codeSlice)}`;
	const fix = `${prose(f.fix)}`;

	const why = [];
	why.push(`<li>${eli5?.whyItMatters ? escapeHtml(eli5.whyItMatters) : "Concrete failure mode: see the issue prose above."}</li>`);
	if (flags.eli5 && eli5?.whatsWrong) why.push(`<li><strong>ELI5:</strong> ${escapeHtml(eli5.whatsWrong)}</li>`);

	const body = `
<div class="cols">
  <div class="col"><h3>Issue</h3>${issue}</div>
  <div class="col"><h3>Suggested fix</h3>${fix || '<p class="muted">No fix supplied.</p>'}</div>
</div>
<div class="rowfull"><h3>Why it matters / details</h3><ul>${why.join("")}</ul></div>`;
	return slide({ id: `finding-${index}`, header, body, copy: findingMarkdown(f) });
}

function slideStyle(findings) {
	const style = findings.filter((f) => f.style);
	if (style.length === 0) return "";
	const items = style.map((f) => `<li><span class="mono">${escapeHtml(loc(f))}</span> — ${escapeHtml(f.title)}: ${escapeHtml(f.problem)}</li>`).join("");
	return slide({ id: "style", header: "Style notes", body: `<ul>${items}</ul>` });
}

function slideTests(testResults) {
	if (!testResults) return "";
	const row = (label, v) => `<tr><td>${label}</td><td class="mono">${escapeHtml(v || "skipped")}</td></tr>`;
	const body = `<table class="grid"><tr><th>Suite</th><th>Result</th></tr>${row("untagged", testResults.untagged)}${row("integration (-tags integration -count 1 -race)", testResults.integration)}</table>`;
	return slide({ id: "tests", header: "Test results", body });
}

function slideNextActions(findings) {
	const blockers = realFindings(findings).filter((f) => f.severity === "BLOCKER" || f.severity === "CRITICAL");
	if (blockers.length === 0) return "";
	const items = blockers.map((f) => `<li>${badge(f.severity)} ${escapeHtml(f.title)} — <span class="mono">${escapeHtml(loc(f))}</span></li>`).join("");
	return slide({ id: "next", header: "Next actions", body: `<ul class="checks">${items}</ul>` });
}

/** Full per-target HTML deck. */
export function renderReviewDeck(target, findings, synth, verdict, flags) {
	const real = realFindings(findings);
	const slides = [
		slideTitle(target, findings),
		slideVerdict(verdict, findings),
		slideTldr(synth),
		slideOverview(findings),
		...real.map((f, i) => slideFinding(f, i, synth, flags)),
		slideStyle(findings),
		flags.testResults ? slideTests(flags.testResults) : "",
		slideNextActions(findings),
	].filter(Boolean);
	return htmlDoc({ title: `Review — ${target.name}`, slides });
}

// ─── Group deck ─────────────────────────────────────────────────────────────

function ccLoc(f) {
	if (!Array.isArray(f.evidence) || !f.evidence.length) return "";
	return f.evidence.map((e) => `${e.target}:${e.path}:${e.line}`).join(", ");
}

export function renderGroupDeck(group, perTarget, crosscut) {
	const ccVerdict = crosscut?.verdict || null;
	const all = perTarget.map((p) => p.verdict).concat(ccVerdict ? [ccVerdict] : []);
	const groupRec = all.includes("BLOCKED") ? "BLOCKED" : all.includes("NEEDS-CHANGES") ? "NEEDS-CHANGES" : "APPROVED";
	const word = VERDICT_WORD[groupRec] || groupRec;
	const recColor = groupRec === "BLOCKED" ? SEVERITY_PALETTE.BLOCKER : groupRec === "NEEDS-CHANGES" ? SEVERITY_PALETTE.HIGH : "#3fb950";

	const slides = [];
	slides.push(slide({ id: "title", header: "Group review", body: `<h1>${escapeHtml(group.name)}</h1><p class="muted">${perTarget.length} target(s) · ${escapeHtml(group.reviewedAt || "")}</p>` }));
	slides.push(slide({ id: "verdict", header: "Group recommendation", body: `<div class="big" style="color:${recColor}">${escapeHtml(word)}</div>` }));

	// The per-target decks live at <groupdir>/<name>/review.html, sibling to this
	// summary.html, so a relative href clicks straight through over file://.
	const reportCell = (p) => {
		const rel = p.reviewHtmlRel || p.reviewMdRel || "";
		if (!rel) return '<span class="muted">—</span>';
		return `<a href="${escapeHtml(encodeURI(rel))}">${escapeHtml(rel)}</a>`;
	};
	const rows = perTarget
		.map((p) => `<tr><td><a href="${escapeHtml(encodeURI(p.reviewHtmlRel || p.reviewMdRel || "#"))}">${escapeHtml(p.target.name)}</a></td><td>${escapeHtml(VERDICT_WORD[p.verdict] || p.verdict)}</td><td class="mono">${reportCell(p)}</td></tr>`)
		.join("");
	slides.push(slide({ id: "targets", header: "Per-target verdicts", body: `<table class="grid"><tr><th>Target</th><th>Verdict</th><th>Report</th></tr>${rows}</table>` }));

	if (crosscut) {
		slides.push(slide({ id: "cc-tldr", header: "Cross-cut TL;DR", body: prose(crosscut.tldr || crosscut.prose || "See cross-cut findings.") }));
		const real = realFindings(crosscut.findings || []);
		real.forEach((f, i) => {
			const header = `${badge(f.severity)} <span class="mono">${escapeHtml(f.category)}</span> · ${escapeHtml(f.title)}`;
			const involves = Array.isArray(f.involves) && f.involves.length ? `<p class="muted">involves: ${escapeHtml(f.involves.join(", "))}</p>` : "";
			const evidence = ccLoc(f) ? `<p class="mono">${escapeHtml(ccLoc(f))}</p>` : "";
			const body = `<div class="cols"><div class="col"><h3>Issue</h3>${involves}${evidence}${prose(f.problem)}</div><div class="col"><h3>Suggested fix</h3>${prose(f.fix)}</div></div>`;
			const ccLocStr = ccLoc(f);
			const copyParts = [`# ${f.title}`, "", `**${f.severity} · ${f.category}**${ccLocStr ? ` · \`${ccLocStr}\`` : ""}`, ""];
			if (Array.isArray(f.involves) && f.involves.length) copyParts.push(`involves: ${f.involves.join(", ")}`, "");
			copyParts.push("## Issue", "", String(f.problem ?? "").trim(), "", "## Suggested Fix", "", String(f.fix ?? "").trim() || "_No fix supplied._");
			slides.push(slide({ id: `cc-${i}`, header, body, copy: `${copyParts.join("\n").replace(/\n+$/, "")}\n` }));
		});
		const order = crosscut.merge_order && crosscut.merge_order.length ? crosscut.merge_order.map((t) => `<li>${escapeHtml(t)}</li>`).join("") : "";
		if (order) slides.push(slide({ id: "order", header: "Recommended merge order", body: `<ol>${order}</ol>` }));
	}

	return htmlDoc({ title: `Group review — ${group.name}`, slides });
}
