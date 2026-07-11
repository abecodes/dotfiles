import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandApi } from "../c-api.ts";
import { createCommandApi } from "../c.ts";
import { loadCommandModule, runCommandModule } from "../load.ts";

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 });

// A fixture dir with a type:module package.json so index.js loads as ESM —
// exactly the marker the runner guarantees in the real commands root.
function fixture(indexBody: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-load-"));
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
	fs.writeFileSync(path.join(dir, "index.js"), indexBody);
	return dir;
}

function fakeC(args = ""): CommandApi {
	return createCommandApi({
		args,
		cwd: "/tmp",
		spawn: async () => ({ ok: true, text: "", usage: zero() }),
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		readFile: async () => "",
		onProgress: () => {},
		maxConcurrency: 4,
	});
}

test("runCommandModule: happy path returns the script's string using c + args", async () => {
	const dir = fixture("export default async (c, args) => `hello ${args} / ${c.args}`;");
	try {
		const out = await runCommandModule(path.join(dir, "index.js"), fakeC("world"), "world");
		assert.equal(out, "hello world / world");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("runCommandModule: coerces a non-string return to string", async () => {
	const dir = fixture("export default async () => 123;");
	try {
		assert.equal(await runCommandModule(path.join(dir, "index.js"), fakeC(), ""), "123");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("loadCommandModule: no default export -> clear error naming the requirement", async () => {
	const dir = fixture("export const notDefault = 1;");
	try {
		await assert.rejects(() => loadCommandModule(path.join(dir, "index.js")), /must `export default/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("runCommandModule: a throwing default propagates with its message preserved", async () => {
	const dir = fixture("export default async () => { throw new Error('script boom'); };");
	try {
		await assert.rejects(() => runCommandModule(path.join(dir, "index.js"), fakeC(), ""), /script boom/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("runCommandModule: re-imports an edited script (mtime cache-bust)", async () => {
	const dir = fixture("export default async () => 'v1';");
	const file = path.join(dir, "index.js");
	try {
		assert.equal(await runCommandModule(file, fakeC(), ""), "v1");
		// Rewrite the command and force a distinct mtime (two writes can land in the
		// same millisecond), then confirm the new version is served.
		fs.writeFileSync(file, "export default async () => 'v2';");
		const future = Date.now() / 1000 + 5;
		fs.utimesSync(file, future, future);
		assert.equal(await runCommandModule(file, fakeC(), ""), "v2");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
