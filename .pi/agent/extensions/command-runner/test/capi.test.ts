import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentResult } from "../c-api.ts";
import { type CommandApiDeps, createCommandApi } from "../c.ts";

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 });
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function baseDeps(over: Partial<CommandApiDeps> = {}): CommandApiDeps {
	return {
		args: "the args",
		cwd: "/tmp",
		spawn: async () => ({ ok: true, text: "ok", usage: zero() }),
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		readFile: async () => "",
		writeFile: async () => {},
		ask: async () => ({ answers: [], cancelled: true }),
		onProgress: () => {},
		maxConcurrency: 4,
		...over,
	};
}

test("args: exposed verbatim", () => {
	assert.equal(createCommandApi(baseDeps({ args: "hello world" })).args, "hello world");
});

test("agent: forwards the request to spawn and returns its AgentResult", async () => {
	let seen: unknown;
	const result: AgentResult = { ok: true, text: "hi", usage: zero(), agent: "scout" };
	const c = createCommandApi(
		baseDeps({
			spawn: async (req) => {
				seen = req;
				return result;
			},
		}),
	);
	const got = await c.agent({ agent: "scout", prompt: "say hi" });
	assert.deepEqual(seen, { agent: "scout", prompt: "say hi" });
	assert.equal(got, result);
});

test("map: results match input order regardless of completion order", async () => {
	const c = createCommandApi(baseDeps());
	const out = await c.map([12, 1, 6], async (n) => {
		await delay(n);
		return n * 2;
	});
	assert.deepEqual(out, [24, 2, 12]);
});

test("map: peak concurrency never exceeds the ceiling", async () => {
	let active = 0;
	let peak = 0;
	const c = createCommandApi(baseDeps({ maxConcurrency: 2 }));
	await c.map([1, 2, 3, 4, 5, 6], async () => {
		active++;
		peak = Math.max(peak, active);
		await delay(5);
		active--;
		return 0;
	});
	assert.ok(peak <= 2, `peak ${peak} should be <= 2`);
});

test("map: opts.concurrency can lower the cap", async () => {
	let active = 0;
	let peak = 0;
	const c = createCommandApi(baseDeps({ maxConcurrency: 4 }));
	await c.map(
		[1, 2, 3, 4, 5, 6],
		async () => {
			active++;
			peak = Math.max(peak, active);
			await delay(5);
			active--;
			return 0;
		},
		{ concurrency: 1 },
	);
	assert.equal(peak, 1);
});

test("map: opts.concurrency cannot raise above the ceiling", async () => {
	let active = 0;
	let peak = 0;
	const c = createCommandApi(baseDeps({ maxConcurrency: 2 }));
	await c.map(
		[1, 2, 3, 4, 5, 6],
		async () => {
			active++;
			peak = Math.max(peak, active);
			await delay(5);
			active--;
			return 0;
		},
		{ concurrency: 10 },
	);
	assert.ok(peak <= 2, `peak ${peak} should stay capped at 2`);
});

test("map: a rejection propagates", async () => {
	const c = createCommandApi(baseDeps());
	await assert.rejects(
		() =>
			c.map([1, 2], async (n) => {
				if (n === 2) throw new Error("boom");
				return n;
			}),
		/boom/,
	);
});

test("all: Promise.all semantics, order preserved", async () => {
	const c = createCommandApi(baseDeps());
	const out = await c.all([delay(5).then(() => "a"), Promise.resolve("b")]);
	assert.deepEqual(out, ["a", "b"]);
});

test("bash: forwards command + opts to exec and returns the BashResult", async () => {
	let seen: unknown;
	const c = createCommandApi(
		baseDeps({
			exec: async (cmd, opts) => {
				seen = { cmd, opts };
				return { stdout: "out", stderr: "err", code: 3 };
			},
		}),
	);
	const r = await c.bash("echo hi", { cwd: "/x", timeoutMs: 100 });
	assert.deepEqual(seen, { cmd: "echo hi", opts: { cwd: "/x", timeoutMs: 100 } });
	assert.deepEqual(r, { stdout: "out", stderr: "err", code: 3 });
});

test("read: returns file contents via the readFile dep", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-read-"));
	const f = path.join(dir, "data.txt");
	fs.writeFileSync(f, "file body");
	try {
		const c = createCommandApi(baseDeps({ readFile: (p) => fs.promises.readFile(p, "utf8") }));
		assert.equal(await c.read(f), "file body");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("write: forwards path + content to the writeFile dep", async () => {
	let seen: unknown;
	const c = createCommandApi(
		baseDeps({
			writeFile: async (p, content) => {
				seen = { p, content };
			},
		}),
	);
	await c.write("/out/review.md", "# body");
	assert.deepEqual(seen, { p: "/out/review.md", content: "# body" });
});

test("ask: forwards params to the ask dep and returns its result", async () => {
	let seen: unknown;
	const result = { answers: [{ questionIndex: 0, question: "q?", kind: "custom" as const, answer: "freeform" }], cancelled: false };
	const c = createCommandApi(
		baseDeps({
			ask: async (params) => {
				seen = params;
				return result;
			},
		}),
	);
	const params = { questions: [{ question: "q?", header: "Q", options: [{ label: "a", description: "" }, { label: "b", description: "" }] }] };
	const got = await c.ask(params);
	assert.equal(seen, params);
	assert.equal(got, result);
});

test("log: captured untagged when outside a phase", () => {
	const lines: Array<[string, string | undefined]> = [];
	const c = createCommandApi(baseDeps({ onProgress: (l, p) => lines.push([l, p]) }));
	c.log("hello");
	assert.deepEqual(lines, [["hello", undefined]]);
});

test("phase: brackets with start/finish + timing, tags inner logs, restores outer phase", async () => {
	const lines: Array<[string, string | undefined]> = [];
	const c = createCommandApi(baseDeps({ onProgress: (l, p) => lines.push([l, p]) }));

	const out = await c.phase("build", async () => {
		c.log("step");
		return 42;
	});

	assert.equal(out, 42);
	// Boundary markers are untagged; only the inner log carries the phase tag.
	assert.deepEqual(lines[0], ["▶ build", undefined]);
	assert.deepEqual(lines[1], ["step", "build"]);
	assert.match(lines[2][0], /^✓ build \(\d+ms\)$/);
	assert.equal(lines[2][1], undefined);

	// After the phase, the active phase is cleared again.
	c.log("after");
	assert.deepEqual(lines[lines.length - 1], ["after", undefined]);
});

test("phase: a failing body logs ✗ and rethrows", async () => {
	const lines: string[] = [];
	const c = createCommandApi(baseDeps({ onProgress: (l) => lines.push(l) }));
	await assert.rejects(
		() =>
			c.phase("risky", async () => {
				throw new Error("nope");
			}),
		/nope/,
	);
	assert.ok(
		lines.some((l) => /^✗ risky \(\d+ms\)$/.test(l)),
		"should log a ✗ line for the failed phase",
	);
});
