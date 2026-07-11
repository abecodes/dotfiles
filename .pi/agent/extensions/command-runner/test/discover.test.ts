import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverCommandDirs, discoverCommands } from "../discover.ts";

function mkBase(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-disc-"));
}

function writeCmd(base: string, name: string): void {
	fs.mkdirSync(path.join(base, name), { recursive: true });
	fs.writeFileSync(path.join(base, name, "index.js"), "export default async () => 'x';");
}

test("discoverCommands: returns only subdirs with index.js, stable sorted order", () => {
	const base = mkBase();
	try {
		writeCmd(base, "b");
		writeCmd(base, "a");
		fs.mkdirSync(path.join(base, "c")); // subdir without index.js -> skipped
		fs.writeFileSync(path.join(base, "loose.js"), "// loose file, not a command");
		const cmds = discoverCommands(base);
		assert.deepEqual(
			cmds.map((c) => c.name),
			["a", "b"],
		);
		assert.ok(cmds[0].file.endsWith(path.join("a", "index.js")));
	} finally {
		fs.rmSync(base, { recursive: true, force: true });
	}
});

test("discoverCommands: missing/unreadable dir -> []", () => {
	assert.deepEqual(discoverCommands(path.join(os.tmpdir(), "definitely-not-here-xyz-123")), []);
});

test("discoverCommandDirs: project (later dir) wins on a name clash", () => {
	const userDir = mkBase();
	const projDir = mkBase();
	try {
		writeCmd(userDir, "shared");
		writeCmd(userDir, "useronly");
		writeCmd(projDir, "shared");
		writeCmd(projDir, "projonly");

		const merged = discoverCommandDirs([userDir, projDir]);
		assert.deepEqual(
			merged.map((c) => c.name),
			["projonly", "shared", "useronly"],
		);
		const shared = merged.find((c) => c.name === "shared");
		assert.ok(shared && shared.file.startsWith(projDir), "project entry should win");
	} finally {
		fs.rmSync(userDir, { recursive: true, force: true });
		fs.rmSync(projDir, { recursive: true, force: true });
	}
});
