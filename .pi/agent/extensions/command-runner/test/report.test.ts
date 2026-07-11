import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeReport, type TruncationView } from "../report.ts";

// A pass-through truncator: never truncates. Lets banner tests run in isolation.
const noTruncate = (content: string): TruncationView => ({
	content,
	truncated: false,
	outputLines: content.split("\n").length,
	totalLines: content.split("\n").length,
});

const neverSpill = (): string | null => {
	throw new Error("spill should not be called when not truncated");
};

test("finalizeReport: no failures -> isError false, body unchanged", () => {
	const r = finalizeReport("the report", { agentFailures: 0, commandName: "x" }, { truncate: noTruncate, spill: neverSpill });
	assert.equal(r.isError, false);
	assert.equal(r.content, "the report");
});

test("finalizeReport: agent failures -> isError true, banner prefixed (head, survives truncation)", () => {
	const r = finalizeReport("body text", { agentFailures: 2, commandName: "review" }, { truncate: noTruncate, spill: neverSpill });
	assert.equal(r.isError, true);
	assert.match(r.content, /^⚠️ {2}2 agent calls failed during \/review/);
	assert.ok(r.content.includes("body text"));
});

test("finalizeReport: singular noun for a single failure", () => {
	const r = finalizeReport("b", { agentFailures: 1, commandName: "x" }, { truncate: noTruncate, spill: neverSpill });
	assert.match(r.content, /1 agent call failed/);
});

test("finalizeReport: truncated -> spills full report and appends its path", () => {
	let spilled: string | null = null;
	const r = finalizeReport(
		"huge report body",
		{ agentFailures: 0, commandName: "big" },
		{
			truncate: () => ({ content: "huge repo", truncated: true, outputLines: 1, totalLines: 9 }),
			spill: (full) => {
				spilled = full;
				return "/tmp/command-big-123.txt";
			},
		},
	);
	assert.equal(spilled, "huge report body");
	assert.match(r.content, /^huge repo/);
	assert.match(r.content, /\[Output truncated to 1 of 9 lines\. Full report written to \/tmp\/command-big-123\.txt\]$/);
});

test("finalizeReport: truncated but spill fails -> note without a path", () => {
	const r = finalizeReport(
		"huge",
		{ agentFailures: 0, commandName: "big" },
		{
			truncate: () => ({ content: "hu", truncated: true, outputLines: 1, totalLines: 5 }),
			spill: () => null,
		},
	);
	assert.match(r.content, /\[Output truncated to 1 of 5 lines\.\]$/);
	assert.ok(!r.content.includes("Full report written"));
});

test("finalizeReport: failure banner AND truncation compose (banner spilled in full report)", () => {
	let spilled = "";
	const r = finalizeReport(
		"body",
		{ agentFailures: 1, commandName: "c" },
		{
			truncate: () => ({ content: "⚠️  1 agent call failed during /c; resul", truncated: true, outputLines: 1, totalLines: 3 }),
			spill: (full) => {
				spilled = full;
				return "/tmp/c.txt";
			},
		},
	);
	assert.equal(r.isError, true);
	// The spilled full report includes the banner at its head.
	assert.match(spilled, /^⚠️ {2}1 agent call failed during \/c/);
	assert.match(r.content, /Full report written to \/tmp\/c\.txt\]$/);
});
