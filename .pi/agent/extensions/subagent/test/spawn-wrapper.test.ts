import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ALLOW_LIST_ACTIVE_ENV_VAR } from "../depth.ts";
import { spawnSubagent } from "../index.ts";

// ---------------------------------------------------------------------------
// spawnSubagent: the public wrapper around the internal runSingleAgent.
//
// These exercise the branches that return BEFORE a child pi is ever spawned —
// the unknown-agent guard (in spawnSubagent itself) and the allow-list
// presence guard (inside runSingleAgent). No real `pi` process is launched.
//
// Requires the resolve hook (imports index.ts -> pi runtime):
//   node --import ./test/pi-resolve.mjs --test --experimental-strip-types \
//     test/spawn-wrapper.test.ts
// ---------------------------------------------------------------------------

function tmpProject(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnsub-"));
	// An (initially empty) project agents dir so discovery resolves here and
	// never walks up into the real user/project roster — keeps tests hermetic.
	fs.mkdirSync(path.join(dir, ".pi", "agents"), { recursive: true });
	return dir;
}

function writeAgent(projectDir: string, name: string, frontmatterExtra: string): void {
	const file = path.join(projectDir, ".pi", "agents", `${name}.md`);
	fs.writeFileSync(file, `---\nname: ${name}\ndescription: test agent\n${frontmatterExtra}---\nbody\n`, "utf-8");
}

async function withAllowListInactive<T>(fn: () => Promise<T>): Promise<T> {
	const saved = process.env[ALLOW_LIST_ACTIVE_ENV_VAR];
	delete process.env[ALLOW_LIST_ACTIVE_ENV_VAR];
	try {
		return await fn();
	} finally {
		if (saved !== undefined) process.env[ALLOW_LIST_ACTIVE_ENV_VAR] = saved;
	}
}

test("spawnSubagent: unknown agent -> ok:false, error names the agent (no spawn)", async () => {
	const dir = tmpProject(); // empty .pi/agents -> empty roster
	try {
		const r = await spawnSubagent({
			agent: "nope",
			task: "x",
			cwd: dir,
			agentScope: "project",
			ctx: { cwd: dir } as any,
		});
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /unknown agent/i);
		assert.match(r.error ?? "", /nope/);
		assert.equal(r.agent, "nope");
		assert.equal(r.text, "");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("spawnSubagent: agent declares tools + allow-list inactive -> refusal (no spawn)", async () => {
	const dir = tmpProject();
	writeAgent(dir, "guarded", "tools: [read]\n");
	try {
		const r = await withAllowListInactive(() =>
			spawnSubagent({
				agent: "guarded",
				task: "x",
				cwd: dir,
				agentScope: "project",
				ctx: { cwd: dir } as any,
			}),
		);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /allow-list/i);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("spawnSubagent: opts.tools override + allow-list inactive -> refusal (no spawn)", async () => {
	const dir = tmpProject();
	writeAgent(dir, "plain", ""); // no tools in frontmatter; override supplies them
	try {
		const r = await withAllowListInactive(() =>
			spawnSubagent({
				agent: "plain",
				task: "x",
				cwd: dir,
				agentScope: "project",
				tools: ["read"],
				ctx: { cwd: dir } as any,
			}),
		);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /allow-list/i);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
