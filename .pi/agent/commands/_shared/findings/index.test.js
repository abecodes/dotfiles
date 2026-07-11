import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAnchorLine } from "./index.js";

test("resolveAnchorLine: unique, not_found, ambiguous-nearest, no_anchor", () => {
	const text = "alpha\nbeta target\ngamma\nbeta target\n";
	assert.deepEqual(resolveAnchorLine(text, "alpha", 99), { line: 1, status: "unique" });
	assert.deepEqual(resolveAnchorLine(text, "nowhere", 7), { line: 7, status: "not_found" });
	// two matches at lines 2 and 4; hint 5 -> nearest is 4
	assert.deepEqual(resolveAnchorLine(text, "beta target", 5), { line: 4, status: "ambiguous" });
	assert.deepEqual(resolveAnchorLine(text, "", 3), { line: 3, status: "no_anchor" });
});

test("resolveAnchorLine: ambiguous with no hint -> first match", () => {
	const text = "x\ndup\ny\ndup\n";
	assert.deepEqual(resolveAnchorLine(text, "dup", undefined), { line: 2, status: "ambiguous" });
});

test("resolveAnchorLine: not_found with no hint -> null line", () => {
	assert.deepEqual(resolveAnchorLine("a\nb\n", "zzz", undefined), { line: null, status: "not_found" });
});
