// review/acquire — review-specific acquisition. Dispatches on the resolved
// mode (from git.classifyTarget) and assembles an in-memory Target (no
// meta.json on disk). Ports acquire.sh dispatch + acquire-pr.sh + acquire-local.sh.
// Originals are never touched: all work happens in the copy/clone under root.

import * as nodePath from "node:path";
import { safeWipe, shq } from "../../_shared/files/index.js";
import * as git from "../../_shared/git/index.js";

const REVIEW_SUBDIR = ".review";

/** branch/ref → filesystem-safe token (matches acquire-local.sh `sanitize`). */
function sanitize(s) {
	return String(s ?? "").replace(/[/ ]/g, "-");
}

async function ensureReviewDir(c, dir) {
	await c.bash(`mkdir -p ${shq(nodePath.join(dir, REVIEW_SUBDIR))}`);
}

function paths(dir) {
	return {
		diffPath: nodePath.join(dir, REVIEW_SUBDIR, "diff.patch"),
		logPath: nodePath.join(dir, REVIEW_SUBDIR, "log.txt"),
	};
}

/**
 * Acquire one classified token into an in-memory Target under `reviewsRoot`.
 * `classified` is the object git.classifyTarget produced (mode already resolved).
 */
export async function acquire(c, classified, { base, reviewsRoot }) {
	switch (classified.mode) {
		case "pr":
			return acquirePr(c, classified, reviewsRoot);
		case "git":
			return acquireGit(c, classified, { base, reviewsRoot });
		case "fulltree":
			return acquireFulltree(c, classified, reviewsRoot);
		default:
			throw new Error(classified.reason || `invalid target: ${classified.token ?? ""}`);
	}
}

async function acquirePr(c, cl, reviewsRoot) {
	const meta = await git.prMeta(c, cl.url);
	const dir = nodePath.join(reviewsRoot, `${cl.repo}-pr${cl.number}`);

	await safeWipe(c, reviewsRoot, dir);
	await git.clonePr(c, { host: cl.host, owner: cl.owner, repo: cl.repo, dest: dir });
	await git.fetchPrHead(c, dir, cl.number);
	await git.checkout(c, dir, `pr-${cl.number}`);

	const baseInfo = await git.resolveBase(c, dir, {
		override: `origin/${meta.baseRefName}`,
		displayRef: meta.baseRefName,
		fallbackSha: meta.baseRefOid,
	});
	const head = await git.headInfo(c, dir);

	await ensureReviewDir(c, dir);
	const { diffPath, logPath } = paths(dir);
	await git.writeDiff(c, dir, { base: baseInfo.base_full, head: "HEAD", dest: diffPath });
	await git.writeLog(c, dir, { base: baseInfo.base_full, head: "HEAD", dest: logPath });

	return {
		dir,
		name: nodePath.basename(dir),
		mode: "pr",
		source: cl.url,
		repo: cl.repo,
		branch: meta.headRefName,
		base_ref: baseInfo.base_ref,
		base_sha: baseInfo.base_short,
		base_sha_full: baseInfo.base_full,
		head_ref: `pr-${cl.number}`,
		head_sha: head.head_short,
		head_sha_full: head.head_full,
		dirty: false,
		state: meta.state,
		title: meta.title,
		body: String(meta.body ?? ""),
		diffPath,
		logPath,
	};
}

async function acquireGit(c, cl, { base, reviewsRoot }) {
	const srcAbs = cl.srcAbs;
	const repo = nodePath.basename(srcAbs);

	// Base/head/dirty are detected on the SOURCE repo (no fetch), then the diff
	// is taken on the copy using the resolved full sha (rsync includes .git).
	const branch = await git.branchName(c, srcAbs);
	const head = await git.headInfo(c, srcAbs);
	const baseInfo = await git.resolveBase(c, srcAbs, { override: base });
	const dirty = await git.isDirty(c, srcAbs);

	const dir = nodePath.join(reviewsRoot, `${repo}-${sanitize(branch)}-${head.head_short}`);
	await safeWipe(c, reviewsRoot, dir);
	await git.rsyncTree(c, srcAbs, dir);
	// Intent-to-add untracked files in the COPY so the diff includes new files.
	await git.includeUntracked(c, dir);

	await ensureReviewDir(c, dir);
	const { diffPath, logPath } = paths(dir);
	// base..worktree (no head) captures committed + uncommitted (tracked + new) work.
	await git.writeDiff(c, dir, { base: baseInfo.base_full, dest: diffPath });
	await git.writeLog(c, dir, { base: baseInfo.base_full, head: "HEAD", dest: logPath });

	return {
		dir,
		name: nodePath.basename(dir),
		mode: "git",
		source: srcAbs,
		repo,
		branch,
		base_ref: baseInfo.base_ref,
		base_sha: baseInfo.base_short,
		base_sha_full: baseInfo.base_full,
		head_ref: "HEAD",
		head_sha: head.head_short,
		head_sha_full: head.head_full,
		dirty,
		diffPath,
		logPath,
	};
}

async function acquireFulltree(c, cl, reviewsRoot) {
	const srcAbs = cl.srcAbs;
	const repo = nodePath.basename(srcAbs);
	const tsR = await c.bash("date -u +%Y%m%d-%H%M%S");
	const ts = tsR.stdout.trim() || String(Date.now());

	const dir = nodePath.join(reviewsRoot, `${repo}-fulltree-${ts}`);
	await safeWipe(c, reviewsRoot, dir);
	await git.rsyncTree(c, srcAbs, dir);

	await ensureReviewDir(c, dir);
	const { diffPath, logPath } = paths(dir);
	const emptyTree = await git.synthBaseline(c, dir, diffPath);
	await c.write(logPath, "");

	return {
		dir,
		name: nodePath.basename(dir),
		mode: "fulltree",
		source: srcAbs,
		repo,
		branch: null,
		base_ref: "review-base",
		base_sha: emptyTree.slice(0, 7),
		base_sha_full: emptyTree,
		head_ref: "review-head",
		head_sha: "fulltree",
		head_sha_full: "fulltree",
		dirty: false,
		diffPath,
		logPath,
	};
}
