// simplify/scope — classify each CLI token into an analyzable unit, expand
// dirs/globs/diffs into source-file lists, score expanded files by cheap
// complexity signals, and order them into waves (PORTING-SPEC §3).
//
// Effectful helpers take `c` (probe the filesystem / run git); the scoring,
// glob/path detection, filtering, and wave ordering are pure and exported for
// direct unit testing.

import * as nodePath from "node:path";
import { changedFiles } from "../../_shared/git/index.js";
import { expandHome, shq } from "../../_shared/files/index.js";

// ─── Pure detection + filtering ───────────────────────────────────────────────

/** True if the token carries shell/git glob metacharacters. */
export function isGlob(token) {
	return /[*?[\]{}]/.test(String(token ?? ""));
}

/** True if the token looks like a path (contains a separator). */
export function hasPathSep(token) {
	return String(token ?? "").includes("/");
}

const VENDOR_DIR = /(^|\/)(node_modules|vendor|\.git|dist|build|out|\.next|target|__pycache__|\.venv|venv|coverage|\.cache)\//;
const BINARY_EXT =
	/\.(png|jpe?g|gif|svg|ico|webp|bmp|pdf|zip|gz|tgz|tar|bz2|xz|7z|rar|mp[34]|mov|avi|webm|wav|flac|woff2?|ttf|eot|otf|class|jar|war|wasm|so|dylib|dll|exe|bin|obj|o|a|lib|node|lock|snap)$/i;
const MINIFIED = /\.min\.(js|css)$|\.(js|css)\.map$/i;

/** True if a path is plausibly editable source (not vendor / binary / minified). */
export function isSourceFile(p) {
	const s = String(p ?? "").trim();
	if (!s) return false;
	if (VENDOR_DIR.test("/" + s)) return false;
	if (MINIFIED.test(s)) return false;
	if (BINARY_EXT.test(s)) return false;
	return true;
}

/**
 * Cheap deterministic complexity score for a file's text — "messiest first".
 * Combines line count, longest run of non-blank lines (a proxy for the longest
 * function body), and max indentation depth (a proxy for nesting). Pure.
 */
export function scoreComplexity(text) {
	const lines = String(text ?? "").split("\n");
	const loc = lines.length;
	let maxIndent = 0;
	let run = 0;
	let longestRun = 0;
	for (const line of lines) {
		if (line.trim() === "") {
			run = 0;
			continue;
		}
		run++;
		if (run > longestRun) longestRun = run;
		const lead = /^[\t ]*/.exec(line)[0].replace(/\t/g, "  ");
		const depth = Math.floor(lead.length / 2);
		if (depth > maxIndent) maxIndent = depth;
	}
	return loc + longestRun * 2 + maxIndent * 3;
}

/**
 * Order units into the analysis queue: explicit units first (always run, never
 * capped), then expanded units messiest-first, truncated so the TOTAL analyzed
 * (explicit + expanded) respects `maxFiles`. Explicit units run even if they
 * alone exceed the cap. Pure.
 */
export function orderForWaves(units, maxFiles) {
	const explicit = units.filter((u) => u.provenance === "explicit");
	const expanded = units
		.filter((u) => u.provenance === "expanded")
		.slice()
		.sort((a, b) => (b.complexity ?? 0) - (a.complexity ?? 0) || String(a.path ?? "").localeCompare(String(b.path ?? "")));
	const cap = Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : Infinity;
	const room = cap - explicit.length;
	return [...explicit, ...expanded.slice(0, room)];
}

// ─── Unit helpers ─────────────────────────────────────────────────────────────

function makeUnit({ path, symbol, kind, provenance }) {
	return { path, symbol, kind, line: undefined, endLine: undefined, complexity: undefined, provenance };
}

/** Dedupe units by path (explicit provenance wins) and by symbol. */
function dedupeUnits(units) {
	const byPath = new Map();
	const symbols = new Set();
	const out = [];
	for (const u of units) {
		if (u.symbol) {
			if (!symbols.has(u.symbol)) {
				symbols.add(u.symbol);
				out.push(u);
			}
			continue;
		}
		const existing = byPath.get(u.path);
		if (!existing) {
			byPath.set(u.path, u);
			out.push(u);
			continue;
		}
		if (existing.provenance !== "explicit" && u.provenance === "explicit") {
			existing.provenance = "explicit";
			existing.kind = u.kind;
		}
	}
	return out;
}

// ─── Effectful classification ─────────────────────────────────────────────────

async function expandGlob(c, glob, repoDir) {
	const opts = { cwd: repoDir };
	const g = await c.bash(`git ls-files -- ${shq(glob)} 2>/dev/null`, opts);
	let files = g.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
	if (files.length === 0) {
		// Outside a repo (or unmatched by git): fall back to shell nullglob.
		const sh = await c.bash(`bash -c 'shopt -s nullglob; for f in ${glob}; do [ -f "$f" ] && printf "%s\\n" "$f"; done'`, opts);
		files = sh.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
	}
	return files.filter(isSourceFile);
}

async function expandDir(c, dir, repoDir) {
	const opts = { cwd: repoDir };
	const g = await c.bash(`git ls-files -- ${shq(dir)} 2>/dev/null`, opts);
	let files = g.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
	if (files.length === 0) {
		const f = await c.bash(`find ${shq(dir)} -type f 2>/dev/null`, opts);
		files = f.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
	}
	return files.filter(isSourceFile);
}

/**
 * Classify one token (PORTING-SPEC §3). Symbol resolution is NOT done here —
 * the orchestrator has no LSP; the simplifier agent resolves the symbol.
 *   glob   -> { mode:"glob", glob, files }
 *   file   -> { mode:"file", path }
 *   dir    -> { mode:"dir", root, files }
 *   symbol -> { mode:"symbol", symbol }   (no separator, not a glob, no file)
 *   invalid-> { mode:"invalid", reason }
 */
export async function classifyScope(c, token, repoDir = ".") {
	const raw = String(token ?? "").trim();
	if (!raw) return { mode: "invalid", reason: "empty token" };
	if (isGlob(raw)) return { mode: "glob", glob: raw, files: await expandGlob(c, raw, repoDir) };

	const home = process.env.HOME || process.env.USERPROFILE || "";
	const t = expandHome(raw, home);
	const probe = await c.bash(`if [ -f ${shq(t)} ]; then echo file; elif [ -d ${shq(t)} ]; then echo dir; else echo none; fi`, { cwd: repoDir });
	const kind = probe.stdout.trim();
	if (kind === "file") return { mode: "file", path: raw };
	if (kind === "dir") return { mode: "dir", root: raw, files: await expandDir(c, raw, repoDir) };
	if (!hasPathSep(raw)) return { mode: "symbol", symbol: raw };
	return { mode: "invalid", reason: `not a file, directory, glob, or symbol: ${raw}` };
}

/** Read each unit's file and attach a `complexity` score. Mutates + returns. */
export async function rankByComplexity(c, units, repoDir = ".") {
	await c.map(units, async (u) => {
		if (!u.path) return;
		const text = await c.read(nodePath.join(repoDir, u.path)).catch(() => null);
		u.complexity = text == null ? 0 : scoreComplexity(text);
	});
	return units.slice().sort((a, b) => (b.complexity ?? 0) - (a.complexity ?? 0));
}

/**
 * Resolve all tokens + diff flags into ScopeUnits (PORTING-SPEC §3).
 *   no tokens & no --diff/--staged -> working-tree changes (default)
 *   --diff [ref] / --staged        -> changedFiles (read-only)
 * Returns { units, explicit, expanded, invalids }. Explicit = directly-named
 * file/symbol tokens (never capped); expanded = dir/glob/diff members.
 */
export async function resolveScope(c, tokens, flags = {}) {
	const repoDir = flags.repoDir || ".";
	const list = [];
	const invalids = [];

	const wantChanged = !!flags.staged || flags.diff !== undefined || tokens.length === 0;
	if (wantChanged) {
		const files = (await changedFiles(c, repoDir, { staged: !!flags.staged, ref: flags.diff || "" })).filter(isSourceFile);
		for (const p of files) list.push(makeUnit({ path: p, kind: "diff-member", provenance: "expanded" }));
	}

	for (const tok of tokens) {
		const cl = await classifyScope(c, tok, repoDir);
		if (cl.mode === "invalid") {
			invalids.push({ token: tok, reason: cl.reason });
		} else if (cl.mode === "file") {
			list.push(makeUnit({ path: cl.path, kind: "file", provenance: "explicit" }));
		} else if (cl.mode === "symbol") {
			list.push(makeUnit({ symbol: cl.symbol, kind: "symbol", provenance: "explicit" }));
		} else if (cl.mode === "glob") {
			for (const p of cl.files) list.push(makeUnit({ path: p, kind: "glob-member", provenance: "expanded" }));
		} else if (cl.mode === "dir") {
			for (const p of cl.files) list.push(makeUnit({ path: p, kind: "dir-member", provenance: "expanded" }));
		}
	}

	const units = dedupeUnits(list);
	const expanded = units.filter((u) => u.provenance === "expanded" && u.path);
	if (expanded.length) await rankByComplexity(c, expanded, repoDir);

	return {
		units,
		explicit: units.filter((u) => u.provenance === "explicit"),
		expanded,
		invalids,
	};
}
