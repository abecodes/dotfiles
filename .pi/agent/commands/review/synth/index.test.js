import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackTldr, parseSynth, rankedFindings, synthPrompt } from "./index.js";

const FINDINGS = [
	{ severity: "LOW", category: "NAMING", title: "rename x", problem: "p1", fix: "f1", style: false },
	{ severity: "BLOCKER", category: "CORRECTNESS", title: "data loss", problem: "p2", fix: "f2", style: false },
	{ severity: "MEDIUM", category: "STYLE", title: "nit", problem: "p3", fix: "f3", style: true },
];

const TARGET = { name: "t", repo: "r", base_ref: "main", base_sha: "abc", head_ref: "HEAD", head_sha: "def", dirty: false };

test("rankedFindings drops style and sorts by severity", () => {
	const r = rankedFindings(FINDINGS);
	assert.deepEqual(r.map((f) => f.title), ["data loss", "rename x"]);
});

test("synthPrompt lists findings in severity order and asks for strict JSON", () => {
	const p = synthPrompt(TARGET, FINDINGS, { eli5: true });
	assert.match(p, /1\. \[BLOCKER\]/);
	assert.match(p, /"tldr"/);
	assert.match(p, /"eli5"/);
	const noEli5 = synthPrompt(TARGET, FINDINGS, { eli5: false });
	assert.doesNotMatch(noEli5, /"eli5": \[\{/);
});

test("parseSynth reads a fenced block; returns null on garbage", () => {
	const ok = parseSynth('```json\n{"tldr":"hi","eli5":[{"title":"a","whatsWrong":"w"}]}\n```');
	assert.equal(ok.tldr, "hi");
	assert.equal(ok.eli5[0].title, "a");
	assert.equal(parseSynth("not json"), null);
	assert.equal(parseSynth('{"no":"tldr"}'), null);
});

test("fallbackTldr summarizes top findings deterministically", () => {
	const t = fallbackTldr(FINDINGS);
	assert.match(t, /data loss \(BLOCKER\)/);
	assert.match(fallbackTldr([]), /No substantive findings/);
});
