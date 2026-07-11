import { test } from "node:test";
import assert from "node:assert/strict";
import { codeFence, escapeMd, list, section, severityBadge, table } from "./index.js";

test("escapeMd escapes pipes and flattens newlines", () => {
	assert.equal(escapeMd("a|b\nc"), "a\\|b c");
});

test("table renders a GFM table with header + separator", () => {
	const t = table(["A", "B"], [["1", "2"], ["3", "4"]]);
	assert.match(t, /\| A \| B \|/);
	assert.match(t, /\| --- \| --- \|/);
	assert.match(t, /\| 1 \| 2 \|/);
});

test("table with no rows still emits header + separator", () => {
	const t = table(["X"], []);
	assert.equal(t, "| X |\n| --- |");
});

test("section builds a heading + body at the requested level", () => {
	assert.equal(section("Title", "body", 3), "### Title\n\nbody");
	assert.equal(section("Empty", ""), "## Empty");
});

test("list + codeFence + severityBadge", () => {
	assert.equal(list(["a", "b"]), "- a\n- b");
	assert.equal(codeFence("x = 1", "js"), "```js\nx = 1\n```");
	assert.equal(severityBadge("blocker"), "[BLOCKER]");
});
