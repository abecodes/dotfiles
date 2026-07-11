import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeC, identityRealpath } from "../../_shared/testkit.js";
import { acquire } from "./index.js";

test("acquire fulltree: rsync + synthetic baseline, review-base meta, empty log", async () => {
	const c = fakeC({
		bash: (cmd) => {
			const rp = identityRealpath(cmd);
			if (rp) return rp;
			if (cmd === "date -u +%Y%m%d-%H%M%S") return { stdout: "20260101-000000\n", stderr: "", code: 0 };
			if (cmd.includes("hash-object")) return { stdout: "4b825dc642cb6eb9a060e54bf8d69288fbee4904\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 0 };
		},
	});
	const t = await acquire(c, { mode: "fulltree", srcAbs: "/src/myproj" }, { reviewsRoot: "/root" });
	assert.equal(t.mode, "fulltree");
	assert.equal(t.dir, "/root/myproj-fulltree-20260101-000000");
	assert.equal(t.name, "myproj-fulltree-20260101-000000");
	assert.equal(t.base_ref, "review-base");
	assert.equal(t.base_sha, "4b825dc");
	assert.equal(t.head_sha, "fulltree");
	assert.equal(t.branch, null);
	// empty log written
	assert.equal(c._writes["/root/myproj-fulltree-20260101-000000/.review/log.txt"], "");
});

test("acquire git: detects branch/base/dirty on source, diffs the copy", async () => {
	const c = fakeC({
		bash: (cmd) => {
			const rp = identityRealpath(cmd);
			if (rp) return rp;
			if (cmd.includes("symbolic-ref --quiet --short HEAD")) return { stdout: "feature\n", stderr: "", code: 0 };
			if (cmd.endsWith("rev-parse HEAD")) return { stdout: "headfull\n", stderr: "", code: 0 };
			if (cmd.includes("rev-parse --short HEAD")) return { stdout: "hs\n", stderr: "", code: 0 };
			if (cmd.includes("symbolic-full-name '@{u}'")) return { stdout: "origin/main\n", stderr: "", code: 0 };
			if (cmd.includes("rev-parse -q --verify 'origin/main'")) return { stdout: "originmain\n", stderr: "", code: 0 };
			if (cmd.includes("merge-base 'origin/main' HEAD")) return { stdout: "basefull\n", stderr: "", code: 0 };
			if (cmd.includes("rev-parse --short 'basefull'")) return { stdout: "bs\n", stderr: "", code: 0 };
			if (cmd.includes("status --porcelain")) return { stdout: " M file\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 0 };
		},
	});
	const t = await acquire(c, { mode: "git", srcAbs: "/src/repo" }, { reviewsRoot: "/root" });
	assert.equal(t.mode, "git");
	assert.equal(t.dir, "/root/repo-feature-hs");
	assert.equal(t.branch, "feature");
	assert.equal(t.base_ref, "origin/main");
	assert.equal(t.base_sha, "bs");
	assert.equal(t.head_ref, "HEAD");
	assert.equal(t.dirty, true);
});

test("acquire dispatches invalid mode to a throw", async () => {
	await assert.rejects(() => acquire(fakeC(), { mode: "invalid", reason: "nope", token: "z" }, { reviewsRoot: "/root" }), /nope/);
});
