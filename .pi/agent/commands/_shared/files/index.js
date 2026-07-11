// _shared/files — reviews-root + wipe helpers, ported from lib/review/_common.sh.
//
// All system effects go through the injected `c` handle (no ambient fs /
// child_process), so these unit-test with a fake `c` exactly like the runner's
// capi.test.ts. Path math uses node:path (pure, effect-free).
//
// Key fix over the old _common.sh: assertUnderRoot realpaths BOTH sides, so the
// macOS /tmp -> /private/tmp (and /var -> /private/var) symlink mismatch no
// longer lets a guarded path slip the check (or trip a false negative).

import * as nodePath from "node:path";

/** POSIX single-quote a string for safe interpolation into a shell command. */
export const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * Expand a leading ~, ~/…, $HOME, or ${HOME} to an absolute home path. Pure.
 * Node has no built-in tilde expansion (`~` is a shell feature; `path` ignores
 * it and `os.homedir()` only returns the dir), so callers pass the home in.
 */
export function expandHome(token, home) {
	const t = String(token ?? "");
	if (!home) return t;
	if (t === "~" || t === "$HOME" || t === "${HOME}") return home;
	if (t.startsWith("~/")) return home + t.slice(1);
	if (t.startsWith("$HOME/")) return home + t.slice(5);
	if (t.startsWith("${HOME}/")) return home + t.slice(7);
	return t;
}

/**
 * Canonicalize a path to its realpath. If the path itself does not exist yet
 * (e.g. a target dir about to be created by safeWipe), realpath its nearest
 * existing ancestor and re-append the missing tail, so the comparison still
 * collapses symlinks on the part that exists.
 */
async function canonicalize(c, p) {
	const direct = await c.bash(`realpath ${shq(p)} 2>/dev/null`);
	if (direct.code === 0 && direct.stdout.trim()) return direct.stdout.trim();
	const parent = nodePath.dirname(p);
	const base = nodePath.basename(p);
	const pr = await c.bash(`realpath ${shq(parent)} 2>/dev/null`);
	if (pr.code === 0 && pr.stdout.trim()) return nodePath.join(pr.stdout.trim(), base);
	return nodePath.resolve(p);
}

/**
 * Create the ephemeral reviews root via `mktemp -d` and return its realpath.
 * Replaces _common.sh `reviews_root` (which defaulted to ~/Repos/reviews); the
 * command uses an ephemeral temp dir — no resume, no durable artifacts.
 */
export async function makeTmpRoot(c) {
	const r = await c.bash("mktemp -d");
	if (r.code !== 0 || !r.stdout.trim()) {
		throw new Error(`mktemp -d failed: ${r.stderr.trim() || `exit ${r.code}`}`);
	}
	return canonicalize(c, r.stdout.trim());
}

/**
 * Throw unless `dir` realpaths to a strict child of `root`'s realpath. Returns
 * the canonicalized dir on success. Realpaths BOTH sides (the _common.sh guard
 * only realpath'd the root).
 */
export async function assertUnderRoot(c, root, dir) {
	const rootReal = (await canonicalize(c, root)).replace(/\/+$/, "");
	const dirReal = (await canonicalize(c, dir)).replace(/\/+$/, "");
	if (dirReal !== rootReal && dirReal.startsWith(rootReal + "/")) return dirReal;
	throw new Error(`refusing to operate outside reviews root (${rootReal}): ${dirReal}`);
}

/** Guarded `rm -rf <dir> && mkdir -p <dir>` — only ever inside `root`. */
export async function safeWipe(c, root, dir) {
	await assertUnderRoot(c, root, dir);
	const r = await c.bash(`rm -rf ${shq(dir)} && mkdir -p ${shq(dir)}`);
	if (r.code !== 0) throw new Error(`safeWipe failed for ${dir}: ${r.stderr.trim() || `exit ${r.code}`}`);
}
