import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReviewMd, renderSummaryMd } from "./index.js";

const TARGET = {
	name: "repo-feature-abc",
	source: "/src/repo",
	repo: "repo",
	base_ref: "main",
	base_sha: "aaa",
	head_ref: "HEAD",
	head_sha: "bbb",
	dirty: true,
};

const FINDINGS = [
	{ agent: "implementation-reviewer", model: "opus", severity: "BLOCKER", category: "CORRECTNESS", title: "panic on nil", path: "a.go", line: 12, endLine: null, problem: "deref nil", fix: "guard it", style: false },
	{ agent: "architecture-reviewer", model: "gpt", severity: "LOW", category: "NAMING", title: "bad name", path: "b.go", line: 3, endLine: null, problem: "unclear", fix: "rename", style: true },
];

const FLAGS = { eli5: true, security: false, maintainability: true, testResults: { untagged: "pass", integration: "skipped" }, reviewedAt: "2026-01-01T00:00:00Z" };

test("renderReviewMd emits all sections with the DO NOT MERGE word for BLOCKED", () => {
	const md = renderReviewMd(TARGET, FINDINGS, { tldr: "summary text", eli5: [] }, "BLOCKED", FLAGS);
	assert.match(md, /^# Review — repo-feature-abc/);
	assert.match(md, /\+ uncommitted/);
	assert.match(md, /## TL;DR\n\nsummary text/);
	assert.match(md, /\*\*DO NOT MERGE\*\*/);
	assert.match(md, /\*\*\[BLOCKER\] \[CORRECTNESS\] panic on nil\*\*/);
	assert.match(md, /`a\.go:12`/);
	// agent · model attribution on the finding label
	assert.match(md, /_implementation · opus_/);
	assert.match(md, /## ELI5/);
	assert.match(md, /## Style notes/);
	assert.match(md, /`b\.go:3` — bad name/);
	// attribution also on style notes
	assert.match(md, /_\(architecture · gpt\)_/);
	assert.match(md, /- Untagged: pass/);
	assert.match(md, /Security: skipped — --security not set/);
});

test("renderReviewMd omits ELI5 when flags.eli5 is false", () => {
	const md = renderReviewMd(TARGET, FINDINGS, { tldr: "x", eli5: [] }, "NEEDS-CHANGES", { ...FLAGS, eli5: false });
	assert.doesNotMatch(md, /## ELI5/);
});

test("renderReviewMd lists both implementation raw outputs in dual mode", () => {
	const md = renderReviewMd(TARGET, FINDINGS, { tldr: "x", eli5: [] }, "NEEDS-CHANGES", { ...FLAGS, dual: true });
	assert.match(md, /Implementation \(sonnet\): `\.review\/raw\/implementation-reviewer-sonnet\.md`/);
	assert.match(md, /Implementation \(codex\): `\.review\/raw\/implementation-reviewer-codex\.md`/);
	assert.doesNotMatch(md, /Implementation: `\.review\/raw\/implementation-reviewer\.md`/);
});

test("renderSummaryMd builds the verdict table + group recommendation", () => {
	const perTarget = [
		{ target: { name: "t1" }, verdict: "APPROVED", reviewMdRel: "t1/review.md" },
		{ target: { name: "t2" }, verdict: "BLOCKED", reviewMdRel: "t2/review.md" },
	];
	const crosscut = { verdict: "NEEDS-CHANGES", merge_order: ["t1", "t2"], findings: [] };
	const md = renderSummaryMd({ name: "grp", reviewedAt: "2026-01-01T00:00:00Z" }, perTarget, crosscut);
	assert.match(md, /# Group Review — grp/);
	assert.match(md, /\| t1 \| APPROVED \| t1\/review.md \|/);
	assert.match(md, /\| t2 \| DO NOT MERGE \| t2\/review.md \|/);
	assert.match(md, /1\. t1\n2\. t2/);
	// any BLOCKED per-target -> group recommendation DO NOT MERGE
	assert.match(md, /## Group recommendation\n\n\*\*DO NOT MERGE\*\*/);
});
