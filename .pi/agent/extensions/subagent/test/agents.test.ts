/**
 * Regression tests for agent discovery resilience.
 *
 * Run with:
 *   node --import ./test/pi-resolve.mjs --test test/agents.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents } from "../agents.ts";

function makeProjectWithAgents(files: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-agents-"));
	const dir = path.join(root, ".pi", "agents");
	fs.mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		fs.writeFileSync(path.join(dir, name), content);
	}
	return root;
}

test("discoverAgents: a malformed agent file does not drop its siblings", () => {
	// `description:` is an unquoted scalar containing `: ` — the exact YAML
	// failure mode that previously made implement.md silently invisible.
	const broken = `---\nname: broken\ndescription: phase 1 (gateway: build) breaks yaml\n---\nbody\n`;
	const good = `---\nname: good\ndescription: a healthy agent\n---\nbody\n`;
	const root = makeProjectWithAgents({ "broken.md": broken, "good.md": good });
	try {
		const { agents } = discoverAgents(root, "project");
		const names = agents.map((a) => a.name);
		assert.ok(names.includes("good"), "sibling agent must still load");
		assert.ok(!names.includes("broken"), "malformed agent is skipped, not loaded");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("discoverAgents: a description containing `: ` loads when quoted", () => {
	const quoted = `---\nname: quoted\ndescription: 'phase 1 (gateway: build/lint) then phase 2 (coder: tests)'\n---\nbody\n`;
	const root = makeProjectWithAgents({ "quoted.md": quoted });
	try {
		const { agents } = discoverAgents(root, "project");
		const agent = agents.find((a) => a.name === "quoted");
		assert.ok(agent, "quoted description must parse and load");
		assert.match(agent!.description, /gateway: build\/lint/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
