import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, resolveModel, SYNTH_MODEL } from "./index.js";

test("resolveModel maps aliases to portkey ids; passes unknowns through", () => {
	assert.equal(resolveModel("opus"), "portkey/claude-opus-4-8");
	assert.equal(resolveModel("sonnet"), MODEL.sonnet);
	assert.equal(resolveModel("portkey/whatever"), "portkey/whatever");
});

test("MODEL has the five aliases", () => {
	assert.deepEqual(Object.keys(MODEL).sort(), ["codex", "gpt", "haiku", "opus", "sonnet"]);
});

test("SYNTH_MODEL stays cheap (sonnet)", () => {
	assert.equal(SYNTH_MODEL, MODEL.sonnet);
});
