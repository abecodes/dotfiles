/**
 * Tests for the worktree sandbox (sandbox.ts).
 *
 * Pure-helper tests run anywhere; the isolate/integrate roundtrip tests shell
 * out to the real `git` binary against temp repos/folders.
 *
 * Run with:
 *   node --import ./test/pi-resolve.mjs --test test/sandbox.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents } from "../agents.ts";
import {
	PI_SANDBOX_BASE,
	PI_SANDBOX_BOUNDARY,
	PI_SANDBOX_RUN,
	PI_SANDBOX_WORKTREE,
	integrate,
	isDegenerateBoundary,
	isolate,
	newRunId,
	readSandboxEnv,
	remapCwd,
} from "../sandbox.ts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
	const r = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
			GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
		},
	});
	if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	return r.stdout;
}

function mkTmp(prefix: string): string {
	return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeDirtyRepo(): { repo: string; sandboxRoot: string } {
	const repo = mkTmp("sbx-repo-");
	git(["init", "-q"], repo);
	fs.writeFileSync(path.join(repo, "f.txt"), "a\nb\nc\nd\ne\nf\ng\nh\n");
	git(["add", "-A"], repo);
	git(["commit", "-qm", "base"], repo);
	// uncommitted dirty change on line 4
	fs.writeFileSync(path.join(repo, "f.txt"), "a\nb\nc\nDIRTY\ne\nf\ng\nh\n");
	return { repo, sandboxRoot: mkTmp("sbx-root-") };
}

function rm(...dirs: string[]): void {
	for (const d of dirs) {
		try {
			fs.rmSync(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

test("readSandboxEnv: returns null when not all vars present", () => {
	assert.equal(readSandboxEnv({}), null);
	assert.equal(readSandboxEnv({ [PI_SANDBOX_BOUNDARY]: "/x" }), null);
});

test("readSandboxEnv: parses a complete env", () => {
	const e = readSandboxEnv({
		[PI_SANDBOX_WORKTREE]: "/wt", [PI_SANDBOX_BOUNDARY]: "/b", [PI_SANDBOX_RUN]: "ab12",
	});
	assert.deepEqual(e, { worktree: "/wt", boundary: "/b", run: "ab12" });
});

test("isDegenerateBoundary: refuses /, $HOME, ~/.pi/agent, fs root", () => {
	const home = "/Users/x";
	assert.equal(isDegenerateBoundary("/", home), true);
	assert.equal(isDegenerateBoundary(home, home), true);
	assert.equal(isDegenerateBoundary(path.join(home, ".pi", "agent"), home), true);
	assert.equal(isDegenerateBoundary("/repo/project", home), false);
});

test("isDegenerateBoundary: honors an extra denylist", () => {
	assert.equal(isDegenerateBoundary("/repo/x", "/home/u", ["/repo/x"]), true);
	assert.equal(isDegenerateBoundary("/repo/y", "/home/u", ["/repo/x"]), false);
});

test("remapCwd: rewrites boundary and subpaths into the worktree", () => {
	const env = { boundary: "/repo", worktree: "/wt", run: "r1" };
	assert.equal(remapCwd("/repo", env), "/wt");
	assert.equal(remapCwd("/repo/pkg/a", env), "/wt/pkg/a");
});

test("remapCwd: leaves paths outside the boundary untouched", () => {
	const env = { boundary: "/repo", worktree: "/wt", run: "r1" };
	assert.equal(remapCwd("/elsewhere", env), "/elsewhere");
	assert.equal(remapCwd("/repofoo", env), "/repofoo"); // prefix but not a subpath
});

test("newRunId: distinct hex ids", () => {
	const a = newRunId();
	const b = newRunId();
	assert.match(a, /^[0-9a-f]{8}$/);
	assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// agents.ts frontmatter parse
// ---------------------------------------------------------------------------

test("discoverAgents: parses `sandbox: worktree`", () => {
	const root = mkTmp("sbx-agents-");
	const dir = path.join(root, ".pi", "agents");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "boxed.md"), `---\nname: boxed\ndescription: d\nsandbox: worktree\n---\nbody\n`);
	fs.writeFileSync(path.join(dir, "plain.md"), `---\nname: plain\ndescription: d\n---\nbody\n`);
	try {
		const { agents } = discoverAgents(root, "project");
		assert.equal(agents.find((a) => a.name === "boxed")?.sandbox, "worktree");
		assert.equal(agents.find((a) => a.name === "plain")?.sandbox, undefined);
	} finally {
		rm(root);
	}
});

// ---------------------------------------------------------------------------
// isolate / integrate roundtrip (git)
// ---------------------------------------------------------------------------

test("isolate carries the dirty tree into the worktree", async () => {
	const { repo, sandboxRoot } = makeDirtyRepo();
	const iso = await isolate({ cwd: repo, sandboxRoot });
	try {
		assert.ok(iso.ok, iso.ok ? "" : iso.error);
		if (!iso.ok) return;
		const wt = iso.sandbox.worktree;
		assert.equal(fs.readFileSync(path.join(wt, "f.txt"), "utf8"), "a\nb\nc\nDIRTY\ne\nf\ng\nh\n");
		assert.equal(iso.boundary, repo);
		// BASE is exported so descendants can diff against the run baseline.
		assert.equal(iso.sandbox.env[PI_SANDBOX_BASE], iso.sandbox.base);
		assert.match(iso.sandbox.env[PI_SANDBOX_BASE], /^[0-9a-f]{40}$/);
	} finally {
		rm(repo, sandboxRoot);
	}
});

test("integrate lands a disjoint edit AND preserves the dirty tree (no --3way)", async () => {
	const { repo, sandboxRoot } = makeDirtyRepo();
	const iso = await isolate({ cwd: repo, sandboxRoot });
	assert.ok(iso.ok);
	if (!iso.ok) return;
	try {
		// Agent edits a disjoint line (line 1) in the worktree.
		const wtFile = path.join(iso.sandbox.worktree, "f.txt");
		fs.writeFileSync(wtFile, "a-RUN\nb\nc\nDIRTY\ne\nf\ng\nh\n");

		const res = await integrate(iso.sandbox, { sandboxRoot });
		assert.equal(res.status, "landed", res.reason);

		const real = fs.readFileSync(path.join(repo, "f.txt"), "utf8");
		assert.match(real, /a-RUN/, "run edit landed");
		assert.match(real, /DIRTY/, "user's dirty line preserved");
		assert.doesNotMatch(real, /<<<<<<</, "no conflict markers");

		// Real index untouched: f.txt still shows as unstaged-modified.
		const status = git(["status", "--porcelain"], repo);
		assert.match(status, /^ M f\.txt/m, "change is unstaged, index not touched");
	} finally {
		rm(repo, sandboxRoot);
	}
});

test("integrate holds back a genuine same-line overlap, real tree untouched", async () => {
	// BASE *is* the dirty snapshot, so the user's dirty line is the baseline, not
	// drift. A real overlap needs the real tree to move AFTER isolate, on the
	// same line the run touches.
	const { repo, sandboxRoot } = makeDirtyRepo();
	const iso = await isolate({ cwd: repo, sandboxRoot });
	assert.ok(iso.ok);
	if (!iso.ok) return;
	try {
		// Real tree drifts on line 4 after isolate (concurrent user/sibling edit).
		fs.writeFileSync(path.join(repo, "f.txt"), "a\nb\nc\nUSER-LATER\ne\nf\ng\nh\n");
		// Agent edits the same line 4 in the worktree.
		fs.writeFileSync(path.join(iso.sandbox.worktree, "f.txt"), "a\nb\nc\nRUN\ne\nf\ng\nh\n");
		const res = await integrate(iso.sandbox, { sandboxRoot });
		assert.equal(res.status, "conflict", res.reason);
		assert.equal(res.class, "overlap");
		// Real tree keeps the post-isolate drift, unchanged.
		assert.equal(fs.readFileSync(path.join(repo, "f.txt"), "utf8"), "a\nb\nc\nUSER-LATER\ne\nf\ng\nh\n");
		// Worktree preserved for follow-up.
		assert.ok(fs.existsSync(iso.sandbox.worktree));
	} finally {
		rm(repo, sandboxRoot);
	}
});

test("integrate auto-absorbs disjoint same-file drift via scratch 3-way", async () => {
	const repo = mkTmp("sbx-3way-");
	const sandboxRoot = mkTmp("sbx-root-");
	git(["init", "-q"], repo);
	fs.writeFileSync(path.join(repo, "f.txt"), "L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\n");
	git(["add", "-A"], repo);
	git(["commit", "-qm", "base"], repo);
	const iso = await isolate({ cwd: repo, sandboxRoot });
	assert.ok(iso.ok, iso.ok ? "" : iso.error);
	if (!iso.ok) return;
	try {
		// Agent edits L2; real tree drifts on L4 (separated from L2 by the
		// unchanged L3, but still inside a straight apply's 3-line context). The
		// straight apply fails on the context mismatch -> scratch 3-way merges
		// the two disjoint edits and forward-applies the clean result.
		fs.writeFileSync(path.join(iso.sandbox.worktree, "f.txt"), "L1\nL2-RUN\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\n");
		fs.writeFileSync(path.join(repo, "f.txt"), "L1\nL2\nL3\nL4-USER\nL5\nL6\nL7\nL8\nL9\nL10\n");
		const res = await integrate(iso.sandbox, { sandboxRoot });
		assert.equal(res.status, "landed", res.reason);
		assert.equal(res.class, "ordering");
		const real = fs.readFileSync(path.join(repo, "f.txt"), "utf8");
		assert.match(real, /L2-RUN/, "run edit merged in");
		assert.match(real, /L4-USER/, "concurrent drift preserved");
		assert.doesNotMatch(real, /<<<<<<</);
	} finally {
		rm(repo, sandboxRoot);
	}
});

test("ignored-but-needed files are cloned into the worktree", async () => {
	const repo = mkTmp("sbx-ign-");
	const sandboxRoot = mkTmp("sbx-root-");
	git(["init", "-q"], repo);
	fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
	fs.writeFileSync(path.join(repo, "f.txt"), "x\n");
	git(["add", "-A"], repo);
	git(["commit", "-qm", "base"], repo);
	fs.mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true });
	fs.writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "module.exports = 1\n");

	const iso = await isolate({ cwd: repo, sandboxRoot });
	try {
		assert.ok(iso.ok, iso.ok ? "" : iso.error);
		if (!iso.ok) return;
		const dep = path.join(iso.sandbox.worktree, "node_modules", "dep", "index.js");
		assert.ok(fs.existsSync(dep), "ignored dependency must be present in the worktree");
	} finally {
		rm(repo, sandboxRoot);
	}
});

test("degenerate boundary is refused", async () => {
	const repo = mkTmp("sbx-degen-");
	const sandboxRoot = mkTmp("sbx-root-");
	git(["init", "-q"], repo);
	fs.writeFileSync(path.join(repo, "f.txt"), "x\n");
	git(["add", "-A"], repo);
	git(["commit", "-qm", "b"], repo);
	try {
		const iso = await isolate({ cwd: repo, sandboxRoot, extraDenylist: [repo] });
		assert.equal(iso.ok, false);
	} finally {
		rm(repo, sandboxRoot);
	}
});

// ---------------------------------------------------------------------------
// non-git folder
// ---------------------------------------------------------------------------

test("non-git folder: isolate + integrate forward-applies to the folder", async () => {
	const folder = mkTmp("sbx-plain-");
	const sandboxRoot = mkTmp("sbx-root-");
	fs.writeFileSync(path.join(folder, "doc.txt"), "one\ntwo\nthree\n");
	const iso = await isolate({ cwd: folder, sandboxRoot });
	assert.ok(iso.ok, iso.ok ? "" : iso.error);
	if (!iso.ok) return;
	try {
		assert.equal(iso.sandbox.isGit, false);
		// agent edits in the worktree
		fs.writeFileSync(path.join(iso.sandbox.worktree, "doc.txt"), "one-EDIT\ntwo\nthree\n");
		const res = await integrate(iso.sandbox, { sandboxRoot });
		assert.equal(res.status, "landed", res.reason);
		assert.equal(fs.readFileSync(path.join(folder, "doc.txt"), "utf8"), "one-EDIT\ntwo\nthree\n");
	} finally {
		rm(folder, sandboxRoot);
	}
});

// ---------------------------------------------------------------------------
// parallel: two runs off one repo, disjoint files, both land
// ---------------------------------------------------------------------------

test("parallel disjoint runs both land via serialized integrate", async () => {
	const repo = mkTmp("sbx-par-");
	const sandboxRoot = mkTmp("sbx-root-");
	git(["init", "-q"], repo);
	fs.writeFileSync(path.join(repo, "a.txt"), "A0\n");
	fs.writeFileSync(path.join(repo, "b.txt"), "B0\n");
	git(["add", "-A"], repo);
	git(["commit", "-qm", "base"], repo);
	try {
		const [ia, ib] = await Promise.all([
			isolate({ cwd: repo, sandboxRoot }),
			isolate({ cwd: repo, sandboxRoot }),
		]);
		assert.ok(ia.ok && ib.ok);
		if (!ia.ok || !ib.ok) return;
		fs.writeFileSync(path.join(ia.sandbox.worktree, "a.txt"), "A1\n");
		fs.writeFileSync(path.join(ib.sandbox.worktree, "b.txt"), "B1\n");
		const [ra, rb] = await Promise.all([
			integrate(ia.sandbox, { sandboxRoot }),
			integrate(ib.sandbox, { sandboxRoot }),
		]);
		assert.equal(ra.status, "landed", ra.reason);
		assert.equal(rb.status, "landed", rb.reason);
		assert.equal(fs.readFileSync(path.join(repo, "a.txt"), "utf8"), "A1\n");
		assert.equal(fs.readFileSync(path.join(repo, "b.txt"), "utf8"), "B1\n");
	} finally {
		rm(repo, sandboxRoot);
	}
});
