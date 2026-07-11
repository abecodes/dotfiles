import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeC, identityRealpath } from "../testkit.js";
import { assertUnderRoot, expandHome, makeTmpRoot, safeWipe, shq } from "./index.js";

test("shq single-quotes and escapes embedded quotes", () => {
	assert.equal(shq("a b"), "'a b'");
	assert.equal(shq("it's"), "'it'\\''s'");
});

test("expandHome expands ~, ~/…, $HOME, ${HOME}; leaves abs/rel paths", () => {
	const h = "/Users/me";
	assert.equal(expandHome("~", h), "/Users/me");
	assert.equal(expandHome("~/Repos/x", h), "/Users/me/Repos/x");
	assert.equal(expandHome("$HOME/y", h), "/Users/me/y");
	assert.equal(expandHome("${HOME}/z", h), "/Users/me/z");
	assert.equal(expandHome("/abs/path", h), "/abs/path");
	assert.equal(expandHome("rel/path", h), "rel/path");
	assert.equal(expandHome("~/a", ""), "~/a"); // no home -> unchanged
});

test("makeTmpRoot returns the realpath of mktemp output", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd === "mktemp -d") return { stdout: "/tmp/tmp.ABC\n", stderr: "", code: 0 };
			if (cmd.startsWith("realpath '/tmp/tmp.ABC'")) return { stdout: "/private/tmp/tmp.ABC\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 0 };
		},
	});
	assert.equal(await makeTmpRoot(c), "/private/tmp/tmp.ABC");
});

test("assertUnderRoot realpaths BOTH sides (tmp -> private/tmp) and accepts a child", async () => {
	const map = { "/tmp/root": "/private/tmp/root", "/tmp/root/x": "/private/tmp/root/x" };
	const c = fakeC({
		bash: (cmd) => {
			const m = /realpath '([^']*)'/.exec(cmd);
			if (m) return { stdout: (map[m[1]] ?? m[1]) + "\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 0 };
		},
	});
	assert.equal(await assertUnderRoot(c, "/tmp/root", "/tmp/root/x"), "/private/tmp/root/x");
});

test("assertUnderRoot rejects a path outside the root", async () => {
	const c = fakeC({ bash: identityRealpath });
	await assert.rejects(() => assertUnderRoot(c, "/root", "/other/x"), /refusing to operate outside/);
});

test("assertUnderRoot rejects the root itself (must be a strict child)", async () => {
	const c = fakeC({ bash: identityRealpath });
	await assert.rejects(() => assertUnderRoot(c, "/root", "/root"), /refusing to operate outside/);
});

test("safeWipe guards then rm -rf && mkdir -p inside the root", async () => {
	const calls = [];
	const c = fakeC({
		bash: (cmd) => {
			calls.push(cmd);
			return identityRealpath(cmd) ?? { stdout: "", stderr: "", code: 0 };
		},
	});
	await safeWipe(c, "/root", "/root/t");
	assert.ok(calls.some((c) => /rm -rf '\/root\/t' && mkdir -p '\/root\/t'/.test(c)));
});

test("safeWipe refuses to wipe outside the root", async () => {
	const c = fakeC({ bash: identityRealpath });
	await assert.rejects(() => safeWipe(c, "/root", "/etc"), /refusing to operate outside/);
});
