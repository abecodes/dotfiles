import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildPatch } from "./index.js";

const FILE_A = ["import x", "", "function f() {", "  if (a) {", "    return 1", "  }", "  return 0", "}", "", "export default f"].join("\n") + "\n";

function readerFor(map) {
	return (p) => (p in map ? map[p] : null);
}

test("buildPatch emits a well-formed hunk with real context", () => {
	const proposals = [
		{
			path: "a.js",
			before: "  if (a) {\n    return 1\n  }\n  return 0",
			after: "  return a ? 1 : 0",
			resolvedLine: 4,
			interfaceImpact: "internal",
			impact: "HIGH",
		},
	];
	const { text, included } = buildPatch(proposals, readerFor({ "a.js": FILE_A }));
	assert.equal(included, 1);
	assert.match(text, /^diff --git a\/a\.js b\/a\.js$/m);
	assert.match(text, /^--- a\/a\.js$/m);
	assert.match(text, /^\+\+\+ b\/a\.js$/m);
	assert.match(text, /^@@ -1,\d+ \+1,\d+ @@$/m);
	assert.match(text, /^-  if \(a\) \{$/m);
	assert.match(text, /^\+  return a \? 1 : 0$/m);
});

test("buildPatch excludes caller-visible proposals", () => {
	const proposals = [
		{ path: "a.js", before: "  return 0", after: "  return 0 // noop", resolvedLine: 7, interfaceImpact: "caller-visible", impact: "HIGH" },
	];
	const { text, included } = buildPatch(proposals, readerFor({ "a.js": FILE_A }));
	assert.equal(included, 0);
	assert.equal(text, "");
});

test("buildPatch excludes explicit no-auto-patch proposals", () => {
	const proposals = [
		{ path: "a.js", before: "  return 0", after: "  return 2", resolvedLine: 7, interfaceImpact: "internal", impact: "HIGH", patchable: false, patchExcludedReason: "overlap-conflict" },
	];
	const { text, included } = buildPatch(proposals, readerFor({ "a.js": FILE_A }));
	assert.equal(included, 0);
	assert.equal(text, "");
});

test("buildPatch omits proposals whose before is not found", () => {
	const proposals = [{ path: "a.js", before: "this is not in the file at all", after: "x", resolvedLine: 2, interfaceImpact: "internal", impact: "LOW" }];
	const { included, omitted } = buildPatch(proposals, readerFor({ "a.js": FILE_A }));
	assert.equal(included, 0);
	assert.equal(omitted.length, 1);
});

test("buildPatch honors max cap by input order", () => {
	const proposals = [
		{ path: "a.js", before: "import x", after: "import y", resolvedLine: 1, interfaceImpact: "internal", impact: "HIGH" },
		{ path: "a.js", before: "  return 0", after: "  return 2", resolvedLine: 7, interfaceImpact: "internal", impact: "MEDIUM" },
	];
	const { included } = buildPatch(proposals, readerFor({ "a.js": FILE_A }), { max: 1 });
	assert.equal(included, 1);
});

test("buildPatch output applies cleanly with `git apply`", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simplify-patch-"));
	try {
		execFileSync("git", ["init", "-q"], { cwd: dir });
		fs.writeFileSync(path.join(dir, "a.js"), FILE_A);
		const proposals = [
			{
				path: "a.js",
				before: "  if (a) {\n    return 1\n  }\n  return 0",
				after: "  return a ? 1 : 0",
				resolvedLine: 4,
				interfaceImpact: "internal",
				impact: "HIGH",
			},
		];
		const { text } = buildPatch(proposals, (p) => fs.readFileSync(path.join(dir, p), "utf8"));
		fs.writeFileSync(path.join(dir, "simplify.patch"), text);
		// --check would throw on a bad patch; apply for real then assert content.
		execFileSync("git", ["apply", "simplify.patch"], { cwd: dir });
		const out = fs.readFileSync(path.join(dir, "a.js"), "utf8");
		assert.match(out, /return a \? 1 : 0/);
		assert.doesNotMatch(out, /if \(a\)/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
