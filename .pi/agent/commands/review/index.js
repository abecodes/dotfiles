// /review — deterministic port of the `review` skill. Orchestration ONLY:
// classify → acquire → intent → reviewers → resolve → synth → emit, fanning out
// across targets and (multi) chaining the cross-cut reviewer. All effects route
// through `c`; classification/parsing/serialization/rendering live in the
// imported modules. See PORTING-SPEC.md for the full contract.

import * as nodePath from "node:path";
import { parseArgs as parseArgsSpec } from "../_shared/args/index.js";
import * as files from "../_shared/files/index.js";
import * as git from "../_shared/git/index.js";
import { acquire } from "./acquire/index.js";
import { renderReviewDeck, renderGroupDeck } from "./deck/index.js";
import { parseAgentReply, resolveAnchorLine, worstVerdict } from "./findings/index.js";
import { pickReviewerPanel, SYNTH_MODEL } from "./models/index.js";
import { renderReviewMd, renderSummaryMd } from "./report/index.js";
import { fallbackTldr, parseSynth, synthPrompt } from "./synth/index.js";

const shq = files.shq;
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// ─── Args ───────────────────────────────────────────────────────────────────

// `author` names the model that wrote the change so it is excluded from the
// reviewer panel (cross-model review). Aliases: opus|sonnet|gpt|codex|haiku.
const ARG_SPEC = {
	flags: {
		"--security": { type: "boolean", key: "security", value: true },
		"--no-maintainability": { type: "boolean", key: "maintainability", value: false },
		"--no-eli5": { type: "boolean", key: "eli5", value: false },
		"--no-deck": { type: "boolean", key: "deck", value: false },
		"--dual": { type: "boolean", key: "dual", value: true },
		"--base": { type: "value", key: "base" },
		"--group": { type: "value", key: "group" },
		"--author": { type: "value", key: "author", transform: (s) => String(s ?? "").toLowerCase() },
	},
	defaults: { security: false, maintainability: true, eli5: true, deck: true, dual: false, base: undefined, group: undefined, author: "sonnet" },
};

function parseArgs(argStr) {
	const { flags, tokens } = parseArgsSpec(argStr, ARG_SPEC);
	if (tokens.length === 0) tokens.push(".");
	return { flags, tokens };
}

function agentSet(flags) {
	const agents = ["architecture-reviewer", "implementation-reviewer"];
	if (flags.maintainability) agents.push("maintainability-reviewer");
	if (flags.security) agents.push("security-reviewer");
	return agents;
}

// ─── Intent (Step 3) ─────────────────────────────────────────────────────────

const INTENT_PRESETS = {
	"General review": "Correctness, design, and maintainability across the change.",
	"Security-sensitive": "Emphasize auth, input handling, secrets, and unsafe patterns.",
};
const INTENT_OPTIONS = Object.entries(INTENT_PRESETS).map(([label, description]) => ({ label, description }));

// PR intent comes from the PR body — no prompt.
function prIntent(target) {
	const body = String(target.body ?? "").slice(0, 2000);
	return body.trim() || "(none provided)";
}

function intentName(cl) {
	return nodePath.basename(cl.srcAbs || cl.token || "target");
}

function resolveIntentAnswer(a) {
	if (!a) return "(none provided)";
	if (a.kind === "custom") return (a.answer || "").trim() || "(none provided)";
	if (a.kind === "option") return INTENT_PRESETS[a.answer] || a.answer || "(none provided)";
	return "(none provided)";
}

// Hoisted, batched intent capture for directory targets (git/fulltree). Asking
// up front — before any review runs — keeps prompts from appearing *after* a
// finished review cycle (which read as a loop). Each question is labelled with
// the target it applies to. PR targets are excluded (they use the PR body) and
// the `c.ask` tool caps at 4 questions per call, so we chunk. Returns a Map
// keyed by the classified-target object. Returns `null` if the user cancels
// (Esc) any chunk — the caller treats that as "abort the whole run".
async function captureDirIntents(c, dirTargets) {
	const intents = new Map();
	for (let i = 0; i < dirTargets.length; i += 4) {
		const chunk = dirTargets.slice(i, i + 4);
		const res = await c.ask({
			questions: chunk.map((cl) => ({
				header: intentName(cl).slice(0, 24),
				question: `What should reviewers focus on for ${intentName(cl)}? Type a 1–3 sentence description, or pick a preset.`,
				options: INTENT_OPTIONS,
			})),
		});
		if (res.cancelled) return null;
		chunk.forEach((cl, j) => intents.set(cl, resolveIntentAnswer(res.answers?.[j])));
	}
	return intents;
}

// ─── Reviewer prompt skeleton (SKILL §6, minus the Go skip line) ──────────────

function reviewerPrompt(target, intent) {
	const headLine = `${target.head_ref} @ ${target.head_sha}${target.dirty ? " + uncommitted" : ""}`;
	return `Review this change set. Your cwd is ${target.dir}. The diff is at .review/diff.patch and the commit log at .review/log.txt.

Repo: ${target.repo}
Source: ${target.source}
Base: ${target.base_ref} @ ${target.base_sha}
Head: ${headLine}
Intent: ${intent}

Line anchors: every finding carries an \`anchor\` — a short fragment copied verbatim from the flagged source line (your agent contract specifies the field). Report \`line\` as your best estimate; the orchestrator resolves the authoritative line by searching for \`anchor\` in the real file. So the anchor must be exact (character-for-character, no paraphrase); the line need not be. Do not copy diff.patch's own line numbering into either field.

Follow your agent contract. Reply with the prose review, then the fenced JSON block. Do not write to disk.`;
}

// ─── Line resolution + code slices (Step 7) ──────────────────────────────────

function extractSlice(fileText, line, endLine) {
	if (!Number.isFinite(line)) return null;
	const lines = fileText.split("\n");
	if (line > lines.length) return null;
	const start = Math.max(1, line);
	const end = Number.isFinite(endLine) && endLine >= start ? Math.min(endLine, lines.length) : start;
	return lines.slice(start - 1, end).join("\n");
}

async function resolveFindings(target, reply, readCached) {
	for (const f of reply.findings) {
		if (!f.path) {
			f.codeSlice = null;
			f.lineResolved = "no-path";
			continue;
		}
		const text = await readCached(nodePath.join(target.dir, f.path));
		if (text == null) {
			f.codeSlice = null;
			f.lineResolved = "unreadable";
			continue;
		}
		const r = resolveAnchorLine(text, f.anchor, f.line);
		if (r.line != null) f.line = r.line;
		f.lineResolved = r.status === "unique" || r.status === "ambiguous" ? "anchor" : "hint-fallback";
		f.codeSlice = f.style ? null : extractSlice(text, f.line, f.endLine);
	}
}

// ─── One target ───────────────────────────────────────────────────────────────

async function reviewOne(c, cl, { flags, root, intents }) {
	try {
		const target = await c.phase("acquire", async () => {
			const t = await acquire(c, cl, { base: flags.base, reviewsRoot: root });
			const patch = await c.read(t.diffPath).catch(() => "");
			t.stats = git.diffStats(patch);
			t.reviewedAt = nowIso();
			if (!patch.trim()) {
				c.log(`${t.name}: no changes between base and head — nothing to review`);
				return { ...t, _empty: true };
			}
			c.log(`${t.name}: ${t.stats.files} file(s), +${t.stats.additions}/-${t.stats.deletions}`);
			return t;
		});

		if (target._empty) {
			return { status: "bailed", name: target.name, warning: "no changes between base and head" };
		}

		const intent = target.mode === "pr" ? prIntent(target) : (intents.get(cl) ?? "(none provided)");
		target.intent = intent;

		// Cross-model panel: each reviewer runs on a distinct model, the author's
		// excluded (PORTING-SPEC §5a is language; this is the model-diversity layer).
		// --dual preserves the non-implementation panel but runs implementation twice
		// (sonnet + codex) for a focused second code-review pass.
		const panel = pickReviewerPanel(flags.author, agentSet(flags), { dual: flags.dual });
		c.log(`panel (author=${flags.author}${flags.dual ? ", dual" : ""}): ${panel.map((p) => `${p.agent.replace(/-reviewer$/, "")}=${p.alias}`).join(", ")}`);
		const results = await c.phase("reviewers", () =>
			c.map(panel, (p) => c.agent({ agent: p.agent, model: p.model, prompt: reviewerPrompt(target, intent), cwd: target.dir })),
		);

		const replies = results.map((r, i) => {
			const reply = r.ok
				? parseAgentReply(r.text, panel[i].agent)
				: { agent: panel[i].agent, prose: `Agent failed: ${r.error || "unknown error"}`, findings: [], verdict: "NEEDS-CHANGES" };
			reply.model = panel[i].alias;
			reply.outputName = panel[i].outputName || panel[i].agent;
			for (const f of reply.findings) f.model = panel[i].alias;
			return reply;
		});

		await c.phase("resolve", async () => {
			const cache = new Map();
			const readCached = async (p) => {
				if (cache.has(p)) return cache.get(p);
				const text = await c.read(p).catch(() => null);
				cache.set(p, text);
				return text;
			};
			for (const reply of replies) {
				await resolveFindings(target, reply, readCached);
				const outputName = reply.outputName || reply.agent;
				await c.write(nodePath.join(target.dir, ".review", "raw", `${outputName}.md`), reply.prose || "");
				await c.write(
					nodePath.join(target.dir, ".review", "findings", `${outputName}.json`),
					JSON.stringify({ verdict: reply.verdict, model: reply.model, test_results: reply.test_results, findings: reply.findings }, null, 2),
				);
			}
		});

		const findings = replies.flatMap((r) => r.findings);
		const verdict = worstVerdict(replies.map((r) => r.verdict));
		const testResults = replies.find((r) => r.agent === "implementation-reviewer" && r.test_results)?.test_results || null;

		const synth = await c.phase("synth", async () => {
			const r = await c.agent({ agent: "general", model: SYNTH_MODEL, prompt: synthPrompt(target, findings, { eli5: flags.eli5 }) });
			return (r.ok && parseSynth(r.text)) || { tldr: fallbackTldr(findings), eli5: [] };
		});

		const renderFlags = {
			eli5: flags.eli5,
			security: flags.security,
			maintainability: flags.maintainability,
			dual: flags.dual,
			testResults,
			reviewedAt: target.reviewedAt,
		};

		const reviewMdPath = nodePath.join(target.dir, "review.md");
		let deckPath = null;
		await c.phase("emit", async () => {
			await c.write(reviewMdPath, renderReviewMd(target, findings, synth, verdict, renderFlags));
			if (flags.deck) {
				deckPath = nodePath.join(target.dir, "review.html");
				await c.write(deckPath, renderReviewDeck(target, findings, synth, verdict, renderFlags));
			}
		});

		return { status: "ok", target, findings, verdict, synth, replies, reviewMdPath, deckPath, name: target.name };
	} catch (err) {
		const name = cl.url || cl.srcAbs || cl.token || "target";
		c.log(`drop ${name}: ${err.message}`);
		return { status: "error", name, error: err.message };
	}
}

// ─── Multi-target group plumbing ──────────────────────────────────────────────

async function pickGroupDir(c, reviewsRoot, valid, flags) {
	let name = flags.group;
	if (!name) {
		const ids = valid.map((v) => v.url || v.srcAbs).sort().join("\n");
		const h = await c.bash(`printf %s ${shq(ids)} | shasum -a 1`);
		const suffix = (h.stdout.trim().slice(0, 6) || "000000");
		name = `review-${new Date().toISOString().slice(0, 10)}-${suffix}`;
	}
	const dir = nodePath.join(reviewsRoot, name);
	await c.bash(`mkdir -p ${shq(dir)}`);
	return dir;
}

async function runCrossCut(c, groupDir, ok) {
	if (ok.length < 2) return null;
	const intent = ok.map((r) => r.target.intent).filter((i) => i && i !== "(none provided)").join(" | ") || "(none provided)";
	const per = ok
		.map((r) => `${r.target.name} at ${r.target.dir}, base ${r.target.base_ref}, report ${r.target.dir}/review.md, findings ${r.target.dir}/.review/findings/, diff ${r.target.diffPath}`)
		.join("\n");
	const prompt = `Cross-cut review of ${ok.length} targets. For each:\n${per}\nUser intent: ${intent}. Follow your agent contract; reply with prose then the fenced JSON block.`;

	const res = await c.agent({ agent: "cross-cut-reviewer", model: SYNTH_MODEL, prompt, cwd: groupDir });
	const reply = res.ok ? parseAgentReply(res.text, "cross-cut-reviewer") : { agent: "cross-cut-reviewer", prose: `Agent failed: ${res.error || "unknown"}`, findings: [], verdict: "NEEDS-CHANGES", merge_order: [] };

	// Resolve each evidence line from its verbatim snippet, like Step 7.
	const byName = new Map(ok.map((r) => [r.target.name, r.target]));
	const cache = new Map();
	for (const f of reply.findings) {
		if (!Array.isArray(f.evidence)) continue;
		for (const ev of f.evidence) {
			const t = byName.get(ev.target);
			if (!t || !ev.path) continue;
			const key = nodePath.join(t.dir, ev.path);
			if (!cache.has(key)) cache.set(key, await c.read(key).catch(() => null));
			const text = cache.get(key);
			if (text == null) continue;
			const r = resolveAnchorLine(text, ev.snippet, ev.line);
			if (r.line != null) ev.line = r.line;
		}
	}

	await c.write(nodePath.join(groupDir, ".review", "raw", "cross-cut-reviewer.md"), reply.prose || "");
	await c.write(nodePath.join(groupDir, ".review", "findings", "cross-cut.json"), JSON.stringify({ verdict: reply.verdict, merge_order: reply.merge_order || [], findings: reply.findings }, null, 2));
	return reply;
}

async function emitGroup(c, groupDir, ok, crosscut, flags) {
	const group = { name: nodePath.basename(groupDir), reviewedAt: nowIso() };
	const perTarget = ok.map((r) => ({
		target: r.target,
		verdict: r.verdict,
		reviewMdRel: `${r.target.name}/review.md`,
		reviewHtmlRel: `${r.target.name}/review.html`,
	}));
	const summaryMdPath = nodePath.join(groupDir, "summary.md");
	await c.write(summaryMdPath, renderSummaryMd(group, perTarget, crosscut));
	let summaryHtmlPath = null;
	if (flags.deck) {
		summaryHtmlPath = nodePath.join(groupDir, "summary.html");
		await c.write(summaryHtmlPath, renderGroupDeck(group, perTarget, crosscut));
	}
	return { summaryMdPath, summaryHtmlPath, group, crosscut };
}

async function openDeck(c, deckPath) {
	if (!deckPath) return;
	const q = shq(deckPath);
	const one = `( open ${q} 2>/dev/null || xdg-open ${q} 2>/dev/null || start "" ${q} 2>/dev/null || powershell.exe -c "Start-Process '${deckPath}'" 2>/dev/null ) &`;
	try {
		await c.bash(one);
	} catch {
		/* never fail the run on an open error */
	}
}

// ─── Final reply ──────────────────────────────────────────────────────────────

function finalReply(results, group, flags) {
	const lines = [];
	const ok = results.filter((r) => r.status === "ok");
	const bailed = results.filter((r) => r.status === "bailed");
	const errored = results.filter((r) => r.status === "error");

	for (const r of ok) {
		const word = { BLOCKED: "DO NOT MERGE", "NEEDS-CHANGES": "NEEDS-CHANGES", APPROVED: "APPROVED" }[r.verdict] || r.verdict;
		lines.push(`### ${r.name} — ${word}`);
		lines.push(`- review.md: ${r.reviewMdPath}`);
		if (flags.deck && r.deckPath) lines.push(`- review.html: ${r.deckPath}`);
	}
	for (const r of bailed) lines.push(`### ${r.name} — skipped (${r.warning})`);
	for (const r of errored) lines.push(`### ${r.name} — dropped (${r.error})`);

	if (group) {
		const rec = group.crosscut?.verdict;
		lines.push("");
		lines.push(`## Group — ${group.group.name}`);
		lines.push(`- summary.md: ${group.summaryMdPath}`);
		if (flags.deck && group.summaryHtmlPath) lines.push(`- summary.html: ${group.summaryHtmlPath}`);
		if (group.crosscut?.merge_order?.length) lines.push(`- Recommended merge order: ${group.crosscut.merge_order.join(" → ")}`);
		if (rec) lines.push(`- Cross-cut verdict: ${rec}`);
	}

	return lines.join("\n") || "No reviewable targets.";
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default async (c, args) =>
	c.phase("review", async () => {
		const { flags, tokens } = parseArgs(c.args ?? args);

		// Step 0: classify every token up front (before any clone/rsync).
		const classified = [];
		for (const t of tokens) classified.push({ token: t, ...(await git.classifyTarget(c, t)) });
		const valid = classified.filter((x) => x.mode !== "invalid");
		for (const x of classified.filter((x) => x.mode === "invalid")) c.log(`drop ${x.token}: ${x.reason}`);

		if (valid.length === 0) return "No valid review targets (each token must be a PR URL or an existing directory).";

		const reviewsRoot = await files.makeTmpRoot(c);
		const multi = valid.length > 1;
		const groupDir = multi ? await pickGroupDir(c, reviewsRoot, valid, flags) : null;
		const root = multi ? groupDir : reviewsRoot;

		// Capture intent for all directory targets up front (PRs use their body),
		// before any review runs — otherwise the per-target prompt surfaces after a
		// completed review cycle and looks like a loop.
		const intents = await c.phase("intent", () => captureDirIntents(c, valid.filter((cl) => cl.mode !== "pr")));
		if (intents === null) return "Review cancelled — no targets reviewed.";

		// Serialize targets (concurrency 1) so the shared agent ceiling of 4 is
		// never exceeded by nested fan-out (PORTING-SPEC §8 decision 2).
		const results = await c.map(valid, (cl) => reviewOne(c, cl, { flags, root, intents }), { concurrency: 1 });
		const ok = results.filter((r) => r.status === "ok");

		let group = null;
		if (multi && ok.length >= 2) {
			const crosscut = await c.phase("cross-cut", () => runCrossCut(c, groupDir, ok));
			group = await emitGroup(c, groupDir, ok, crosscut, flags);
		} else if (multi && ok.length > 0) {
			group = await emitGroup(c, groupDir, ok, null, flags);
		}

		// Open one deck: single-target → its review.html; multi → summary.html only.
		if (group?.summaryHtmlPath) await openDeck(c, group.summaryHtmlPath);
		else if (!multi && ok.length === 1) await openDeck(c, ok[0].deckPath);

		return finalReply(results, group, flags);
	});
