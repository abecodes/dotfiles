import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeC } from "../testkit.js";
import { changedFiles, classifyTarget, diffStats, includeUntracked, parsePrUrl, resolveBase } from "./index.js";

test("parsePrUrl parses host/owner/repo/number; rejects non-PR", () => {
	const p = parsePrUrl("https://github.com/o/r/pull/42/files");
	assert.deepEqual(p, { url: "https://github.com/o/r/pull/42/files", host: "github.com", owner: "o", repo: "r", number: "42" });
	assert.equal(parsePrUrl("https://github.com/o/r"), null);
	assert.equal(parsePrUrl("/some/dir"), null);
});

test("classifyTarget expands ~ before probing the filesystem", async () => {
	const prev = process.env.HOME;
	process.env.HOME = "/home/tester";
	try {
		let probed = "";
		const c = fakeC({
			bash: (cmd) => {
				if (cmd.startsWith("test -d")) probed = cmd;
				return { stdout: "", stderr: "", code: 1 };
			},
		});
		await classifyTarget(c, "~/Repos/x");
		assert.match(probed, /test -d '\/home\/tester\/Repos\/x'/);
	} finally {
		process.env.HOME = prev;
	}
});

test("includeUntracked intent-to-adds untracked files in the given repo dir", async () => {
	let seen = null;
	const c = fakeC({
		bash: (cmd, opts) => {
			if (cmd.includes("ls-files")) seen = { cmd, cwd: opts?.cwd };
			return { stdout: "", stderr: "", code: 0 };
		},
	});
	await includeUntracked(c, "/copy");
	assert.match(seen.cmd, /git ls-files -z --others --exclude-standard \| xargs -0 git add -N/);
	assert.equal(seen.cwd, "/copy");
});

test("classifyTarget: PR url -> pr", async () => {
	const r = await classifyTarget(fakeC(), "https://gh.example/o/r/pull/7");
	assert.equal(r.mode, "pr");
	assert.equal(r.number, "7");
});

test("classifyTarget: dir with .git -> git; without -> fulltree; missing -> invalid", async () => {
	const mk = (hasGit) =>
		fakeC({
			bash: (cmd) => {
				if (cmd.startsWith("test -d '/repo' && realpath")) return { stdout: "/repo\n", stderr: "", code: 0 };
				if (cmd.startsWith("test -e '/repo/.git'")) return { stdout: "", stderr: "", code: hasGit ? 0 : 1 };
				return { stdout: "", stderr: "", code: 1 };
			},
		});
	assert.deepEqual(await classifyTarget(mk(true), "/repo"), { mode: "git", srcAbs: "/repo" });
	assert.deepEqual(await classifyTarget(mk(false), "/repo"), { mode: "fulltree", srcAbs: "/repo" });

	const missing = fakeC({ bash: () => ({ stdout: "", stderr: "", code: 1 }) });
	const inv = await classifyTarget(missing, "/nope");
	assert.equal(inv.mode, "invalid");
	assert.match(inv.reason, /neither a PR URL nor an existing directory/);
});

test("diffStats counts files / additions / deletions, ignoring +++/--- headers", () => {
	const patch = [
		"diff --git a/x.go b/x.go",
		"--- a/x.go",
		"+++ b/x.go",
		"@@ -1,2 +1,3 @@",
		" ctx",
		"+added one",
		"+added two",
		"-removed one",
		"diff --git a/y.go b/y.go",
		"+++ b/y.go",
		"+only add",
	].join("\n");
	assert.deepEqual(diffStats(patch), { files: 2, additions: 3, deletions: 1 });
});

test("resolveBase: override path -> merge-base + short", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd.includes("rev-parse -q --verify 'main'")) return { stdout: "mainfull\n", stderr: "", code: 0 };
			if (cmd.includes("merge-base 'main' HEAD")) return { stdout: "basefull\n", stderr: "", code: 0 };
			if (cmd.includes("rev-parse --short 'basefull'")) return { stdout: "basef\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	assert.deepEqual(await resolveBase(c, "/repo", { override: "main" }), {
		base_ref: "main",
		base_full: "basefull",
		base_short: "basef",
	});
});

test("resolveBase: falls back to @{u} when no override", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd.includes("symbolic-full-name '@{u}'")) return { stdout: "origin/dev\n", stderr: "", code: 0 };
			if (cmd.includes("rev-parse -q --verify 'origin/dev'")) return { stdout: "devfull\n", stderr: "", code: 0 };
			if (cmd.includes("merge-base 'origin/dev' HEAD")) return { stdout: "mb\n", stderr: "", code: 0 };
			if (cmd.includes("rev-parse --short 'mb'")) return { stdout: "mbs\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	const r = await resolveBase(c, "/repo", {});
	assert.equal(r.base_ref, "origin/dev");
	assert.equal(r.base_full, "mb");
});

test("changedFiles (working tree): unions HEAD diff with untracked, deduped+sorted", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd.includes("rev-parse -q --verify HEAD")) return { stdout: "abc\n", stderr: "", code: 0 };
			if (cmd === "git diff --name-only HEAD") return { stdout: "b.ts\na.ts\n", stderr: "", code: 0 };
			if (cmd.includes("ls-files --others")) return { stdout: "a.ts\nc.ts\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	assert.deepEqual(await changedFiles(c, "/repo", {}), ["a.ts", "b.ts", "c.ts"]);
});

test("changedFiles (working tree, no HEAD): falls back to plain git diff", async () => {
	let usedPlain = false;
	const c = fakeC({
		bash: (cmd) => {
			if (cmd.includes("rev-parse -q --verify HEAD")) return { stdout: "", stderr: "", code: 1 };
			if (cmd === "git diff --name-only") {
				usedPlain = true;
				return { stdout: "x.ts\n", stderr: "", code: 0 };
			}
			if (cmd.includes("ls-files --others")) return { stdout: "", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	assert.deepEqual(await changedFiles(c, "/repo", {}), ["x.ts"]);
	assert.equal(usedPlain, true);
});

test("changedFiles (--ref): diffs vs the ref and unions untracked", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd === "git diff --name-only 'origin/main'") return { stdout: "r.ts\n", stderr: "", code: 0 };
			if (cmd.includes("ls-files --others")) return { stdout: "u.ts\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	assert.deepEqual(await changedFiles(c, "/repo", { ref: "origin/main" }), ["r.ts", "u.ts"]);
});

test("changedFiles (--staged): only the cached name list, no untracked", async () => {
	let askedUntracked = false;
	const c = fakeC({
		bash: (cmd) => {
			if (cmd === "git diff --cached --name-only") return { stdout: "s.ts\n", stderr: "", code: 0 };
			if (cmd.includes("ls-files --others")) askedUntracked = true;
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	assert.deepEqual(await changedFiles(c, "/repo", { staged: true }), ["s.ts"]);
	assert.equal(askedUntracked, false);
});

test("resolveBase: throws when nothing resolves and no fallback", async () => {
	const c = fakeC({ bash: () => ({ stdout: "", stderr: "", code: 1 }) });
	await assert.rejects(() => resolveBase(c, "/repo", {}), /could not detect a base ref/);
});
