// _shared/git — generic, command-agnostic git/diff plumbing. Ports the git
// portions of acquire.sh / acquire-pr.sh / acquire-local.sh and the diff/stats
// portions of sandbox-diff.sh. No review concepts here.
//
// Every system-touching function takes `c` as its first argument (DI; no
// ambient child_process) so it unit-tests with a fake `c`. classifyTarget is
// async because deciding git-vs-fulltree needs a filesystem probe; the PR-URL
// classification underneath it (parsePrUrl) is pure and exported for direct
// testing. diffStats is pure.

import { expandHome, shq } from "../files/index.js";

/** Pure: parse a PR URL into its parts, or null if it isn't one. */
export function parsePrUrl(token) {
	const re = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;
	const m = re.exec(String(token ?? "").trim());
	if (!m) return null;
	return { url: m[0], host: m[1], owner: m[2], repo: m[3], number: m[4] };
}

/**
 * Classify a token into a resolved acquisition mode BEFORE any clone/rsync.
 *   PR URL                  -> { mode: "pr", url, host, owner, repo, number }
 *   existing dir with .git  -> { mode: "git", srcAbs }
 *   existing dir, no .git   -> { mode: "fulltree", srcAbs }
 *   anything else           -> { mode: "invalid", reason }
 */
export async function classifyTarget(c, token) {
	const raw = String(token ?? "").trim();
	if (!raw) return { mode: "invalid", reason: "empty token" };

	const pr = parsePrUrl(raw);
	if (pr) return { mode: "pr", ...pr };

	// Expand ~ / $HOME against the command process's home before probing — the
	// token is single-quoted for the shell, so the shell won't expand it for us.
	const t = expandHome(raw, process.env.HOME || process.env.USERPROFILE || "");
	const dir = await c.bash(`test -d ${shq(t)} && realpath ${shq(t)}`);
	if (dir.code !== 0 || !dir.stdout.trim()) {
		return { mode: "invalid", reason: `token is neither a PR URL nor an existing directory: ${raw}` };
	}
	const srcAbs = dir.stdout.trim();
	const hasGit = await c.bash(`test -e ${shq(srcAbs + "/.git")}`);
	return hasGit.code === 0 ? { mode: "git", srcAbs } : { mode: "fulltree", srcAbs };
}

/** `gh pr view <url> --json …` parsed to an object (JSON.parse, no jq). */
export async function prMeta(c, url) {
	const fields = "number,headRefName,baseRefName,title,state,headRefOid,baseRefOid,body";
	const r = await c.bash(`gh pr view ${shq(url)} --json ${fields}`);
	if (r.code !== 0) throw new Error(`gh pr view failed for ${url} (auth/host/not-found?): ${r.stderr.trim()}`);
	let obj;
	try {
		obj = JSON.parse(r.stdout);
	} catch {
		throw new Error(`gh pr view returned invalid JSON for ${url}`);
	}
	if (!obj.headRefName || !obj.baseRefName) throw new Error(`gh returned empty head/base branch for ${url}`);
	return { ...obj, title: String(obj.title ?? "").replace(/\s*\n\s*/g, " ") };
}

/** Clone the base repo for a PR (gh handles enterprise host + auth). */
export async function clonePr(c, { host, owner, repo, dest }) {
	const slug = `${host}/${owner}/${repo}`;
	const r = await c.bash(`gh repo clone ${shq(slug)} ${shq(dest)} -- -q`);
	if (r.code !== 0) throw new Error(`gh repo clone ${slug} failed: ${r.stderr.trim()}`);
}

/** Fetch a PR head ref into a local `pr-<n>` branch. */
export async function fetchPrHead(c, repoDir, number) {
	const spec = `pull/${number}/head:pr-${number}`;
	const r = await c.bash(`git -C ${shq(repoDir)} fetch -q origin ${shq(spec)}`);
	if (r.code !== 0) throw new Error(`could not fetch pull/${number}/head from origin: ${r.stderr.trim()}`);
}

/** `git checkout -q <ref>`. */
export async function checkout(c, repoDir, ref) {
	const r = await c.bash(`git -C ${shq(repoDir)} checkout -q ${shq(ref)}`);
	if (r.code !== 0) throw new Error(`git checkout ${ref} failed: ${r.stderr.trim()}`);
}

/** `rsync -a <src>/ <dest>/` — copy a working tree off-tree. */
export async function rsyncTree(c, srcAbs, dest) {
	const r = await c.bash(`rsync -a ${shq(srcAbs.replace(/\/?$/, "/"))} ${shq(dest.replace(/\/?$/, "/"))}`);
	if (r.code !== 0) throw new Error(`rsync failed (${srcAbs} -> ${dest}): ${r.stderr.trim()}`);
}

/** Current branch name, or "(detached)". */
export async function branchName(c, repoDir) {
	const r = await c.bash(`git -C ${shq(repoDir)} symbolic-ref --quiet --short HEAD`);
	return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : "(detached)";
}

/** { head_full, head_short } for HEAD. Throws if there is no HEAD commit. */
export async function headInfo(c, repoDir) {
	const full = await c.bash(`git -C ${shq(repoDir)} rev-parse HEAD`);
	if (full.code !== 0 || !full.stdout.trim()) throw new Error(`no HEAD commit in ${repoDir}`);
	const head_full = full.stdout.trim();
	const short = await c.bash(`git -C ${shq(repoDir)} rev-parse --short HEAD`);
	return { head_full, head_short: short.stdout.trim() || head_full.slice(0, 7) };
}

/** True if the working tree has uncommitted changes. */
export async function isDirty(c, repoDir) {
	const r = await c.bash(`git -C ${shq(repoDir)} status --porcelain`);
	return r.code === 0 && r.stdout.trim().length > 0;
}

/**
 * Resolve a base commit + its display ref/short sha.
 *   override     -> use this ref verbatim (e.g. --base, or "origin/<branch>")
 *   else @{u}    -> upstream tracking branch
 *   else first of candidates that resolves
 * The resolved commit is merge-base(ref, HEAD); if that fails it is the ref tip.
 * If nothing resolves but fallbackSha is given (PR baseRefOid), use it.
 * displayRef overrides the human-readable base_ref (PR shows "main", not
 * "origin/main").
 */
export async function resolveBase(c, repoDir, opts = {}) {
	const { override, displayRef, fallbackSha } = opts;
	const candidates = opts.candidates ?? ["origin/HEAD", "origin/main", "origin/master", "main", "master"];

	let baseRef = "";
	if (override) {
		baseRef = override;
	} else {
		const up = await c.bash(`git -C ${shq(repoDir)} rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null`);
		if (up.code === 0 && up.stdout.trim()) {
			baseRef = up.stdout.trim();
		} else {
			for (const cand of candidates) {
				const v = await c.bash(`git -C ${shq(repoDir)} rev-parse -q --verify ${shq(cand)}`);
				if (v.code === 0) {
					baseRef = cand;
					break;
				}
			}
		}
	}

	let baseFull = "";
	if (baseRef) {
		const verify = await c.bash(`git -C ${shq(repoDir)} rev-parse -q --verify ${shq(baseRef)}`);
		if (verify.code === 0) {
			const mb = await c.bash(`git -C ${shq(repoDir)} merge-base ${shq(baseRef)} HEAD`);
			baseFull = mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : verify.stdout.trim();
		}
	}
	if (!baseFull && fallbackSha) baseFull = fallbackSha;
	if (!baseFull) {
		if (override) throw new Error(`base ref does not resolve: ${override}`);
		throw new Error("could not detect a base ref (pass --base <ref>)");
	}

	const shortR = await c.bash(`git -C ${shq(repoDir)} rev-parse --short ${shq(baseFull)}`);
	const base_short = shortR.code === 0 && shortR.stdout.trim() ? shortR.stdout.trim() : baseFull.slice(0, 7);
	return { base_ref: displayRef || baseRef || baseFull, base_full: baseFull, base_short };
}

/** `git diff <base> [head] > dest` (base..worktree when head omitted). */
export async function writeDiff(c, repoDir, { base, head, dest }) {
	const headPart = head ? ` ${shq(head)}` : "";
	await c.bash(`git -C ${shq(repoDir)} diff ${shq(base)}${headPart} > ${shq(dest)} 2>/dev/null || true`);
}

/** `git log --oneline <base>..<head> > dest` (head defaults to HEAD). */
export async function writeLog(c, repoDir, { base, head = "HEAD", dest }) {
	await c.bash(`git -C ${shq(repoDir)} log --oneline ${shq(`${base}..${head}`)} > ${shq(dest)} 2>/dev/null || true`);
}

/**
 * Make untracked (non-ignored) files visible to `git diff <base>` via a
 * transient intent-to-add (`git add -N`). Run on the ephemeral COPY only — its
 * index is throwaway, so unlike lib/sandbox-diff.sh (which works in a real
 * worktree and undoes the marks) we never need to reset. Mirrors that script's
 * `git ls-files --others --exclude-standard | git add -N` technique;
 * --exclude-standard keeps .gitignore'd artifacts out.
 */
export async function includeUntracked(c, repoDir) {
	await c.bash("git ls-files -z --others --exclude-standard | xargs -0 git add -N 2>/dev/null || true", { cwd: repoDir });
}

/**
 * Full-tree baseline: init a repo, stage everything, diff against the empty
 * tree so every file appears as added. Returns the empty-tree hash. Writes the
 * patch to `dest`.
 */
export async function synthBaseline(c, repoDir, dest) {
	const opts = { cwd: repoDir };
	const et = await c.bash("git hash-object -t tree /dev/null 2>/dev/null", opts);
	const emptyTree = et.code === 0 && et.stdout.trim() ? et.stdout.trim() : "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
	await c.bash("git init -q 2>/dev/null || true", opts);
	await c.bash("git add -A 2>/dev/null || true", opts);
	await c.bash(`git -c core.quotepath=false diff --cached ${shq(emptyTree)} > ${shq(dest)} 2>/dev/null || true`, opts);
	return emptyTree;
}

/**
 * Read-only list of changed file paths in `repoDir`. Unlike includeUntracked
 * (copy-only) this NEVER mutates the real repo's index — /simplify reads files
 * in place, so it must not `git add -N`. It only needs the file LIST:
 *   staged       -> `git diff --cached --name-only` (index vs HEAD) only.
 *   ref provided -> `git diff --name-only <ref>` ∪ untracked-non-ignored.
 *   working tree -> `git diff --name-only HEAD` (staged + unstaged vs HEAD)
 *                   ∪ untracked-non-ignored; falls back to plain `git diff`
 *                   when there is no HEAD commit yet.
 * Using HEAD as the implicit base (rather than the bare working-tree diff)
 * captures already-`git add`ed changes, so "simplify what I just wrote" works
 * after a stage. Paths are returned repo-root-relative (deduped, sorted).
 */
export async function changedFiles(c, repoDir, { staged = false, ref = "" } = {}) {
	const opts = { cwd: repoDir };
	const out = new Set();
	const add = (r) => {
		if (r && r.code === 0) for (const f of r.stdout.split("\n")) if (f.trim()) out.add(f.trim());
	};

	if (staged) {
		add(await c.bash("git diff --cached --name-only", opts));
		return [...out].sort();
	}

	if (ref) {
		add(await c.bash(`git diff --name-only ${shq(ref)}`, opts));
	} else {
		const hasHead = await c.bash("git rev-parse -q --verify HEAD", opts);
		add(await c.bash(hasHead.code === 0 ? "git diff --name-only HEAD" : "git diff --name-only", opts));
	}
	add(await c.bash("git ls-files --others --exclude-standard", opts));
	return [...out].sort();
}

/** Pure: count files / additions / deletions from unified-diff text. */
export function diffStats(patchText) {
	const text = String(patchText ?? "");
	let files = 0;
	let additions = 0;
	let deletions = 0;
	for (const line of text.split("\n")) {
		if (line.startsWith("diff --git ")) files++;
		else if (line.startsWith("+++") || line.startsWith("---")) continue;
		else if (line.startsWith("+")) additions++;
		else if (line.startsWith("-")) deletions++;
	}
	return { files, additions, deletions };
}
