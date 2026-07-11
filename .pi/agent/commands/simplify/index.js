// /simplify — propose behavior-preserving simplifications for code in scope,
// ranked by impact. Orchestration ONLY: scope → focus → per-file waves (+ a
// module pass) of the read-only `simplifier` agent → collate/locate → synth →
// emit report.md / deck.html / simplify.patch. Originals are NEVER touched;
// artifacts land in an ephemeral mktemp root. See PORTING-SPEC.md for the
// full contract.

import * as nodePath from "node:path";
import { parseArgs } from "../_shared/args/index.js";
import * as files from "../_shared/files/index.js";
import { resolveAnchorLine } from "../_shared/findings/index.js";
import { resolveModel, SYNTH_MODEL } from "../_shared/models/index.js";
import { renderSimplifyDeck } from "./deck/index.js";
import { buildPatch } from "./patch/index.js";
import { blockLineCount, locateBlock, mergeProposals, parseProposals } from "./proposals/index.js";
import { renderReportMd } from "./report/index.js";
import { orderForWaves, resolveScope } from "./scope/index.js";
import { fallbackTldr, parseSynth, synthPrompt } from "./synth/index.js";

const shq = files.shq;
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// ─── Args ─────────────────────────────────────────────────────────────────────

const ARG_SPEC = {
	flags: {
		"--staged": { type: "boolean", key: "staged", value: true },
		"--no-module": { type: "boolean", key: "noModule", value: true },
		"--no-deck": { type: "boolean", key: "noDeck", value: true },
		"--no-patch": { type: "boolean", key: "noPatch", value: true },
		"--dual": { type: "boolean", key: "dual", value: true },
		"--diff": { type: "optionalValue", key: "diff" },
		"--focus": { type: "value", key: "focus" },
		"--model": { type: "value", key: "model", transform: (s) => String(s ?? "").toLowerCase() },
		"--max": { type: "value", key: "max", transform: Number },
		"--max-files": { type: "value", key: "maxFiles", transform: Number },
		"--batch": { type: "value", key: "batch", transform: Number },
	},
	defaults: { model: "opus" },
};

function modelAliases(flags) {
	return flags.dual ? ["sonnet", "codex"] : [flags.model || "opus"];
}

// ─── Focus (c.ask multi-select categories) ─────────────────────────────────────

// Focus categories shown as multi-select checkboxes. Selected labels are mapped
// through this table and joined into the bias string handed to the simplifier
// agent; checking every box requests a full-spectrum pass. Multi-select
// questions never render the "Type something." / "Chat about this" rows.
const FOCUS_PRESETS = {
	Readability: "readability and overall clarity",
	"Dead code": "dead-code: unreachable branches, unused exports/locals",
	Duplication: "duplication: near-identical blocks to merge or extract",
	Nesting: "nesting: flatten deeply-nested conditionals into early returns",
	Naming: "naming: clearer, more precise identifiers",
};

// Sentinel returned by captureFocus / confirmContinue to mean "user aborted".
const ABORT = "abort";

async function captureFocus(c, flags) {
	if (flags.focus) return flags.focus;
	const res = await c.ask({
		questions: [
			{
				header: "Simplify focus",
				question: "What should the simplifier bias toward? Check all that apply — check everything for a full pass.",
				multiSelect: true,
				options: [
					{ label: "Readability", description: "General clarity and overall simplicity." },
					{ label: "Dead code", description: "Unreachable branches, unused exports/locals." },
					{ label: "Duplication", description: "Near-identical blocks to merge or extract." },
					{ label: "Nesting", description: "Flatten deeply-nested conditionals into early returns." },
					{ label: "Naming", description: "Clearer, more precise identifiers." },
				],
			},
		],
	});
	// A headless run (no UI) cancels WITH an error and auto-proceeds with no
	// focus bias; an interactive cancel (Esc) has no error and aborts the run.
	// Multi-select never offers a free-text / chat row, so the answer is always
	// a set of category labels (an empty commit is impossible — see Dialog).
	if (res.cancelled) return res.error ? "(none)" : ABORT;
	const a = res.answers?.[0];
	if (a?.kind === "multi") {
		const mapped = (a.selected ?? []).map((l) => FOCUS_PRESETS[l] || l);
		return mapped.length ? mapped.join("; ") : "(none)";
	}
	// Defensive fallbacks (should not occur for a multi-select question).
	if (a?.kind === "option") return FOCUS_PRESETS[a.answer] || a.answer || "(none)";
	if (a?.kind === "custom") return (a.answer || "").trim() || "(none)";
	return "(none)";
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function unitPrompt(u, focus) {
	const common = `Focus: ${focus}. Follow your agent contract: reply with the prose summary, then the single fenced JSON block. \`before\`/\`after\` must be VERBATIM (character-for-character). Do not write to disk.`;
	if (u.symbol) {
		return `Simplify the symbol \`${u.symbol}\`. Your cwd is the repo root. Resolve it to its file + range yourself (LSP, grep fallback), then propose behavior-preserving simplifications confined to that unit and report the real \`path\`.\n\n${common}`;
	}
	return `Simplify the file \`${u.path}\`. Your cwd is the repo root. Propose behavior-preserving simplifications within it (local structure: nesting, conditionals, dead branches, naming).\n\n${common}`;
}

function modulePrompt(units, focus) {
	const list = units
		.filter((u) => u.path)
		.map((u) => `- ${u.path}`)
		.join("\n");
	return `Module pass. Your cwd is the repo root. Analyze these files together for STRUCTURAL simplifications — reuse-over-reinvention (code that re-implements an existing helper/pattern and should hook into it), pattern unification, redundant abstraction layers, over-general interfaces with one caller. You MAY read the WIDER codebase (not just these files) to find the existing helper/pattern to hook into.

Files in scope:
${list}

Focus: ${focus}. Follow your agent contract (module-pass section): reply with the prose summary, then the single fenced JSON block. \`before\`/\`after\` must be VERBATIM. Do not write to disk.`;
}

// ─── Agent runs ────────────────────────────────────────────────────────────────

async function runUnit(c, u, focus, modelAlias, repoDir) {
	const source = u.symbol ? `symbol:${u.symbol}` : `file:${u.path}`;
	const r = await c.agent({ agent: "simplifier", model: resolveModel(modelAlias), prompt: unitPrompt(u, focus), cwd: repoDir });
	if (!r.ok) c.log(`simplifier failed for ${u.symbol || u.path}: ${r.error || "unknown error"}`);
	return { source, model: modelAlias, text: r.ok ? r.text : "", ok: r.ok };
}

async function runModulePass(c, units, focus, modelAlias, repoDir) {
	const r = await c.agent({ agent: "simplifier", model: resolveModel(modelAlias), prompt: modulePrompt(units, focus), cwd: repoDir });
	if (!r.ok) c.log(`module pass failed: ${r.error || "unknown error"}`);
	return { source: "module-pass", model: modelAlias, text: r.ok ? r.text : "", ok: r.ok };
}

// ─── Collate (parse → locate → resolve → attach real slice) ────────────────────

function sliceLines(text, start, end) {
	const lines = String(text ?? "").split("\n");
	if (start < 1 || start > lines.length) return null;
	return lines.slice(start - 1, Math.min(end, lines.length)).join("\n");
}

async function collate(c, replies, readFile) {
	const out = [];
	for (const reply of replies) {
		const parsed = parseProposals(reply.text, reply.source);
		for (const p of parsed.proposals) {
			p.model = reply.model || null;
			p.models = reply.model ? [reply.model] : [];
			p.modelVariants = [
				{
					model: reply.model || "unknown",
					title: p.title,
					category: p.category,
					impact: p.impact,
					after: p.after,
					rationale: p.rationale,
					source: p.source,
				},
			];
			if (!p.path) {
				p.status = "not-found";
				p.patchable = false;
				out.push(p);
				continue;
			}
			const text = await readFile(p.path);
			if (text == null) {
				p.status = "not-found";
				p.patchable = false;
				out.push(p);
				continue;
			}
			const loc = locateBlock(text, p.before, p.line);
			if (loc.status === "verbatim" || loc.status === "normalized") {
				p.resolvedLine = loc.line;
				p.resolvedEnd = loc.line + blockLineCount(p.before) - 1;
				p.status = "located";
				// Attach the file's REAL bytes (never reconstructed) for the deck/patch.
				const real = sliceLines(text, loc.line, loc.line + blockLineCount(p.before) - 1);
				if (real != null) p.before = real;
			} else {
				const ar = resolveAnchorLine(text, p.anchor, p.line);
				if (ar.line != null && (ar.status === "unique" || ar.status === "ambiguous")) {
					p.resolvedLine = ar.line;
					p.status = "anchor-fallback";
				} else {
					p.resolvedLine = ar.line ?? null;
					p.status = "not-found";
				}
			}
			p.patchable = p.status === "located" && p.interfaceImpact === "internal";
			if (!p.patchable) p.patchExcludedReason = p.interfaceImpact !== "internal" ? "caller-visible" : p.status;
			out.push(p);
		}
	}
	return out;
}

// ─── Between-wave checkpoint ────────────────────────────────────────────────────

// Returns one of: "continue" (next wave), "all" (run the rest unattended),
// "stop" (emit what's analyzed), "abort" (cancel, write nothing). `optionsOnly`
// suppresses the free-form rows since the answer drives control flow, not an
// LLM. A headless run (cancel WITH error) auto-continues; an interactive cancel
// (Esc, error-less) aborts.
async function confirmContinue(c, done, left) {
	const res = await c.ask({
		questions: [
			{
				header: "Continue?",
				question: `Analyzed ${done} unit(s); ${left} remaining. Continue with the next wave?`,
				optionsOnly: true,
				options: [
					{ label: "Continue", description: `Analyze the next wave (${left} unit(s) remaining).` },
					{ label: "Continue all", description: "Analyze every remaining wave without asking again." },
					{ label: "Stop & emit", description: "Stop now and write artifacts for what has been analyzed so far." },
					{ label: "Abort", description: "Cancel the whole run. No report/deck/patch is written." },
				],
			},
		],
	});
	if (res.cancelled) return res.error ? "continue" : ABORT;
	const a = res.answers?.[0];
	if (a?.kind === "option") {
		if (a.answer === "Continue all") return "all";
		if (a.answer === "Stop & emit") return "stop";
		if (a.answer === "Abort") return ABORT;
	}
	return "continue";
}

// ─── Scope label ────────────────────────────────────────────────────────────────

function scopeMeta(units, flags) {
	const fileCount = units.filter((u) => u.path).length;
	const symbolCount = units.filter((u) => u.symbol).length;
	const parts = [];
	if (fileCount) parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
	if (symbolCount) parts.push(`${symbolCount} symbol${symbolCount === 1 ? "" : "s"}`);
	const desc = parts.join(" + ") || "nothing";
	const changed = flags.diff !== undefined || flags.staged;
	return { scopeLabel: changed ? `changed code (${desc})` : desc, scopeDesc: desc };
}

// ─── Emit ────────────────────────────────────────────────────────────────────────

async function emit(c, outRoot, ranked, synth, flags, meta, readFile) {
	let patchRel = null;
	let patchCount = 0;
	if (!flags.noPatch) {
		// Pre-warm the cache for every internal proposal's file (buildPatch is sync).
		const paths = [...new Set(ranked.filter((p) => p.path && p.patchable !== false && p.interfaceImpact === "internal").map((p) => p.path))];
		const texts = await c.all(paths.map((p) => readFile(p)));
		const cache = new Map(paths.map((p, i) => [p, texts[i]]));
		const { text, included } = buildPatch(ranked, (p) => (cache.has(p) ? cache.get(p) : null), { max: flags.max });
		if (text) {
			patchRel = nodePath.join(outRoot, "simplify.patch");
			await c.write(patchRel, text);
			patchCount = included;
		}
	}

	const fullMeta = { ...meta, patchRel, patchCount };
	const reportPath = nodePath.join(outRoot, "report.md");
	await c.write(reportPath, renderReportMd(fullMeta, ranked, synth));

	let deckPath = null;
	if (!flags.noDeck) {
		deckPath = nodePath.join(outRoot, "deck.html");
		await c.write(deckPath, renderSimplifyDeck(fullMeta, ranked, synth));
	}
	return { reportPath, deckPath, patchPath: patchRel, patchCount };
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

// ─── Final reply ────────────────────────────────────────────────────────────────

function finalReply(out, ranked, analyzedCount, totalUnits) {
	const n = (impact) => ranked.filter((p) => p.impact === impact).length;
	const cv = ranked.filter((p) => p.interfaceImpact !== "internal").length;
	const consensus = ranked.filter((p) => p.consensus).length;
	const noAuto = ranked.filter((p) => p.patchable === false || p.patchExcludedReason).length;
	const lines = [
		`Simplify — ${ranked.length} proposal(s) across ${analyzedCount}/${totalUnits} unit(s): ${n("HIGH")} HIGH, ${n("MEDIUM")} MEDIUM, ${n("LOW")} LOW${consensus ? `, ${consensus} consensus` : ""}${noAuto ? `, ${noAuto} no-auto-patch` : ""}${cv ? `, ${cv} caller-visible` : ""}.`,
		`- report.md: ${out.reportPath}`,
	];
	if (out.deckPath) lines.push(`- deck.html: ${out.deckPath}`);
	if (out.patchPath) lines.push(`- simplify.patch: ${out.patchPath} (${out.patchCount} hunk(s)) — apply with: git apply ${out.patchPath}`);
	else lines.push("- simplify.patch: (none — no patchable proposals)");
	return lines.join("\n");
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export default async (c, args) =>
	c.phase("simplify", async () => {
		const rawArgs = c.args ?? args;
		const { flags, tokens, warnings } = parseArgs(rawArgs, ARG_SPEC);
		for (const w of warnings) c.log(w);
		if (flags.dual && /(^|\s)--model(?:=|\s|$)/.test(String(rawArgs ?? ""))) {
			return "--dual cannot be combined with --model; --dual uses sonnet + codex.";
		}

		const repoDir = (await c.bash("pwd")).stdout.trim() || ".";
		flags.repoDir = repoDir;

		const { units, invalids } = await c.phase("scope", () => resolveScope(c, tokens, flags));
		for (const iv of invalids) c.log(`drop ${iv.token}: ${iv.reason}`);
		if (units.length === 0) return "Nothing to simplify (no valid targets / no changes).";

		const models = modelAliases(flags);
		if (flags.dual) c.log("dual simplify: running sonnet + codex and merging non-conflicting proposals");

		const meta = { ...scopeMeta(units, flags), generatedAt: nowIso(), models, dual: flags.dual };
		const focus = await captureFocus(c, flags);
		if (focus === ABORT) return "Simplify aborted — no artifacts written.";
		meta.focus = focus;

		// Shared file-text cache: read once, reused by collate + emit (buildPatch).
		const fileCache = new Map();
		const readFile = async (p) => {
			if (!fileCache.has(p)) fileCache.set(p, await c.read(nodePath.join(repoDir, p)).catch(() => null));
			return fileCache.get(p);
		};

		// Explicit units first, then expanded messiest-first, capped to --max-files.
		const queue = orderForWaves(units, flags.maxFiles);
		const WAVE = Number.isFinite(flags.batch) && flags.batch > 0 ? flags.batch : 25;
		const analyzed = [];
		const proposals = [];
		let autoContinue = false;
		let aborted = false;

		for (let i = 0; i < queue.length; i += WAVE) {
			const wave = queue.slice(i, i + WAVE);
			await c.phase(`analyze ${Math.floor(i / WAVE) + 1}`, async () => {
				const runs = wave.flatMap((u) => models.map((model) => ({ u, model })));
				const replies = await c.map(runs, ({ u, model }) => runUnit(c, u, focus, model, repoDir)); // runner cap controls fan-out
				analyzed.push(...wave);
				proposals.push(...(await collate(c, replies, readFile)));
			});
			const left = queue.length - (i + WAVE);
			if (left > 0 && !autoContinue) {
				const decision = await confirmContinue(c, analyzed.length, left);
				if (decision === ABORT) {
					aborted = true;
					break;
				}
				if (decision === "stop") break;
				if (decision === "all") autoContinue = true;
			}
		}
		if (aborted) return "Simplify aborted — no artifacts written.";

		if (!flags.noModule && analyzed.length > 1) {
			const replies = await c.phase("module", () => c.map(models, (model) => runModulePass(c, analyzed, focus, model, repoDir)));
			proposals.push(...(await collate(c, replies, readFile)));
		}

		const ranked = mergeProposals(proposals);
		const synth = await c.phase("synth", async () => {
			const r = await c.agent({ agent: "general", model: SYNTH_MODEL, prompt: synthPrompt(meta.scopeLabel, ranked, focus) });
			return (r.ok && parseSynth(r.text)) || { tldr: fallbackTldr(ranked) };
		});

		const outRoot = await files.makeTmpRoot(c);
		const out = await c.phase("emit", () => emit(c, outRoot, ranked, synth, flags, meta, readFile));
		await openDeck(c, out.deckPath);
		return finalReply(out, ranked, analyzed.length, units.length);
	});
