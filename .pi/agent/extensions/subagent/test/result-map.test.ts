import { test } from "node:test";
import assert from "node:assert/strict";
import { type SpawnOutcome, toAgentResult } from "../helpers.ts";

// ---------------------------------------------------------------------------
// toAgentResult: pure mapping from a finished spawn -> public AgentResult.
// No pi runtime here — runs in the default harness (no resolve hook needed).
// ---------------------------------------------------------------------------

const usage = (over: Partial<SpawnOutcome["usage"]> = {}): SpawnOutcome["usage"] => ({
	input: 10,
	output: 20,
	cacheRead: 1,
	cacheWrite: 2,
	cost: 0.5,
	contextTokens: 30,
	turns: 3,
	...over,
});

const outcome = (over: Partial<SpawnOutcome> = {}): SpawnOutcome => ({
	exitCode: 0,
	text: "hello",
	stderr: "",
	usage: usage(),
	...over,
});

test("toAgentResult: clean exit -> ok:true, text + usage carried, no error", () => {
	const r = toAgentResult(outcome({ agent: "scout", model: "portkey/x" }));
	assert.equal(r.ok, true);
	assert.equal(r.text, "hello");
	assert.equal(r.error, undefined);
	assert.equal(r.agent, "scout");
	assert.equal(r.model, "portkey/x");
	assert.deepEqual(r.usage, usage());
});

test("toAgentResult: usage is a copy, not the same reference", () => {
	const o = outcome();
	const r = toAgentResult(o);
	assert.notEqual(r.usage, o.usage);
	assert.deepEqual(r.usage, o.usage);
});

test("toAgentResult: non-zero exit -> ok:false, error from stderr (trimmed)", () => {
	const r = toAgentResult(outcome({ exitCode: 1, stderr: "  boom\n" }));
	assert.equal(r.ok, false);
	assert.equal(r.error, "boom");
});

test("toAgentResult: stopReason error with exit 0 -> ok:false", () => {
	const r = toAgentResult(outcome({ stopReason: "error", stderr: "x" }));
	assert.equal(r.ok, false);
});

test("toAgentResult: stopReason aborted with exit 0 -> ok:false", () => {
	const r = toAgentResult(outcome({ stopReason: "aborted", stderr: "x" }));
	assert.equal(r.ok, false);
});

test("toAgentResult: errorMessage wins over stderr", () => {
	const r = toAgentResult(outcome({ exitCode: 1, errorMessage: "real cause", stderr: "noise" }));
	assert.equal(r.error, "real cause");
});

test("toAgentResult: empty errorMessage+stderr -> synthesized exit-code string", () => {
	const r = toAgentResult(outcome({ exitCode: 7, stderr: "   " }));
	assert.equal(r.error, "agent exited with code 7");
});

test("toAgentResult: synthesized error includes stopReason when present", () => {
	const r = toAgentResult(outcome({ exitCode: 2, stderr: "", stopReason: "max_turns" }));
	assert.equal(r.error, "agent exited with code 2 (stopReason: max_turns)");
});

test("toAgentResult: agent/model omitted when absent", () => {
	const r = toAgentResult(outcome());
	assert.equal("agent" in r, false);
	assert.equal("model" in r, false);
});

test("toAgentResult: stopReason 'stop' on clean exit stays ok:true", () => {
	const r = toAgentResult(outcome({ stopReason: "stop" }));
	assert.equal(r.ok, true);
	assert.equal(r.error, undefined);
});
