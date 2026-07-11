import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGroupDeck, renderReviewDeck } from "./index.js";

const TARGET = {
	name: "repo-x",
	source: "/src/repo",
	base_ref: "main",
	base_sha: "aaa",
	head_ref: "HEAD",
	head_sha: "bbb",
	dirty: false,
	stats: { files: 2, additions: 10, deletions: 3 },
	reviewedAt: "2026-01-01T00:00:00Z",
};

const FINDINGS = [
	{ agent: "implementation-reviewer", model: "opus", severity: "BLOCKER", category: "CORRECTNESS", title: "panic on nil", path: "a.go", line: 12, endLine: null, problem: "deref nil ptr", fix: "guard it", style: false, codeSlice: "x := *p // boom" },
	{ agent: "architecture-reviewer", model: "gpt", severity: "LOW", category: "NAMING", title: "bad name", path: "b.go", line: 3, problem: "unclear", fix: "rename", style: true },
];

const FLAGS = { eli5: true, testResults: { untagged: "pass", integration: "fail" } };

test("renderReviewDeck produces an offline doc with the verbatim code slice and no fabricated fix code leaking into the Issue pane", () => {
	const html = renderReviewDeck(TARGET, FINDINGS, { tldr: "tl;dr text", eli5: [{ title: "panic on nil", whatsWrong: "w", whyItMatters: "y", howToFix: "h" }] }, "BLOCKED", FLAGS);
	assert.match(html, /^<!doctype html>/);
	assert.match(html, /repo-x/);
	assert.match(html, /DO NOT MERGE/);
	// verbatim code slice present
	assert.match(html, /x := \*p \/\/ boom/);
	// agent · model attribution on the finding label
	assert.match(html, /implementation · opus/);
	// finding slide + overview card jump target
	assert.match(html, /id="finding-0"/);
	assert.match(html, /data-jump="finding-0"/);
	// style finding lives on the style slide, not the findings overview cards
	assert.match(html, /id="style"/);
	// tests slide rendered
	assert.match(html, /id="tests"/);
	assert.match(html, /fail/);
	// next actions for the blocker
	assert.match(html, /id="next"/);
	// offline
	assert.doesNotMatch(html, /src="https?:/);
});

test("renderGroupDeck renders verdict + per-target table + cross-cut findings", () => {
	const perTarget = [
		{ target: { name: "t1" }, verdict: "APPROVED", reviewHtmlRel: "t1/review.html" },
		{ target: { name: "t2" }, verdict: "BLOCKED", reviewHtmlRel: "t2/review.html" },
	];
	const crosscut = {
		verdict: "BLOCKED",
		prose: "cc summary",
		merge_order: ["t1", "t2"],
		findings: [{ severity: "CRITICAL", category: "CONTRACT_DRIFT", title: "drift", involves: ["t1", "t2"], evidence: [{ target: "t1", path: "x.go", line: 4 }], problem: "p", fix: "f", style: false }],
	};
	const html = renderGroupDeck({ name: "grp", reviewedAt: "2026-01-01T00:00:00Z" }, perTarget, crosscut);
	assert.match(html, /grp/);
	// per-target report path is now a clickable relative link
	assert.match(html, /<a href="t1\/review.html">t1\/review.html<\/a>/);
	assert.match(html, /<a href="t2\/review.html">/);
	assert.match(html, /id="cc-0"/);
	assert.match(html, /drift/);
	assert.match(html, /id="order"/);
});
