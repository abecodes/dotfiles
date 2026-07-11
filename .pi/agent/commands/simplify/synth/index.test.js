import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackTldr, parseSynth, synthPrompt } from "./index.js";

const PROPOSALS = [
	{ impact: "MEDIUM", category: "nesting", title: "flatten guard", rationale: "early return" },
	{ impact: "HIGH", category: "duplication", title: "extract helper", rationale: "3 copies" },
	{ impact: "LOW", category: "naming", title: "rename tmp", rationale: "clarity" },
];

test("synthPrompt lists proposals in impact order and asks for strict JSON", () => {
	const p = synthPrompt("src/", PROPOSALS, "duplication");
	// HIGH proposal should appear before MEDIUM/LOW
	assert.ok(p.indexOf("extract helper") < p.indexOf("flatten guard"));
	assert.ok(p.indexOf("flatten guard") < p.indexOf("rename tmp"));
	assert.match(p, /```json/);
	assert.match(p, /"tldr"/);
	assert.match(p, /Focus area: duplication/);
});

test("synthPrompt handles empty proposal set", () => {
	const p = synthPrompt("file.ts", [], "(none)");
	assert.match(p, /no simplifications proposed/);
});

test("parseSynth reads a fenced block; returns null on garbage", () => {
	assert.deepEqual(parseSynth('```json\n{ "tldr": "  clean it up " }\n```'), { tldr: "clean it up" });
	assert.equal(parseSynth("no json"), null);
	assert.equal(parseSynth('```json\n{ "nope": 1 }\n```'), null);
});

test("fallbackTldr summarizes the top proposals deterministically", () => {
	const t = fallbackTldr(PROPOSALS);
	assert.match(t, /3 simplification/);
	assert.match(t, /extract helper \(HIGH\)/);
});

test("fallbackTldr handles the empty case", () => {
	assert.match(fallbackTldr([]), /already close to its simplest/);
});
