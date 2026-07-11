import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReportMd } from "./index.js";

const PROPOSALS = [
	{
		path: "a.ts",
		resolvedLine: 12,
		title: "collapse nested if",
		category: "nesting",
		impact: "HIGH",
		interfaceImpact: "internal",
		status: "located",
		patchable: true,
		models: ["sonnet", "codex"],
		consensus: true,
		before: "if (x) {\n  return 1\n}",
		after: "return x ? 1 : 0",
		rationale: "early return is clearer",
	},
	{
		path: "b.ts",
		resolvedLine: 4,
		title: "rename export",
		category: "api",
		impact: "MEDIUM",
		interfaceImpact: "caller-visible",
		status: "located",
		patchable: false,
		patchExcludedReason: "caller-visible",
		model: "codex",
		models: ["codex"],
		before: "export const fooBar",
		after: "export const foo",
		rationale: "callers must update imports",
	},
	{
		path: "c.ts",
		line: 9,
		title: "drop dead branch",
		category: "dead-code",
		impact: "LOW",
		interfaceImpact: "internal",
		status: "not-found",
		patchable: false,
		patchExcludedReason: "not-found",
		before: "if (never) {}",
		after: "",
		rationale: "unreachable",
	},
];

const META = { scopeLabel: "src/ (3 files)", scopeDesc: "3 files", generatedAt: "2026-06-21T00:00:00Z", focus: "nesting", patchRel: "/tmp/x/simplify.patch", patchCount: 1, models: ["sonnet", "codex"] };

test("renderReportMd emits all sections + the apply line", () => {
	const md = renderReportMd(META, PROPOSALS, { tldr: "Three cleanups." });
	assert.match(md, /^# Simplify — src\/ \(3 files\)/);
	assert.match(md, /- Models: sonnet \+ codex/);
	assert.match(md, /## TL;DR\n\nThree cleanups\./);
	assert.match(md, /## Proposals \(HIGH → MEDIUM → LOW\)/);
	assert.match(md, /\[HIGH\] \[nesting\] collapse nested if/);
	assert.match(md, /consensus: sonnet \+ codex/);
	assert.match(md, /```diff/);
	assert.match(md, /-if \(x\) \{/);
	assert.match(md, /\+return x \? 1 : 0/);
	assert.match(md, /git apply \/tmp\/x\/simplify\.patch` applies the 1 patchable/);
});

test("renderReportMd segregates caller-visible and not-auto-patchable", () => {
	const md = renderReportMd(META, PROPOSALS, null);
	assert.match(md, /## Caller-visible \(review before applying\)/);
	assert.match(md, /rename export/);
	assert.match(md, /NO AUTO-PATCH: caller-visible change/);
	assert.match(md, /## Not auto-patchable/);
	assert.match(md, /drop dead branch\*\*: \*\*NO AUTO-PATCH: target block was not found\*\*/);
	assert.match(md, /_No synthesis available\._/);
});

test("renderReportMd lists model disagreements and overlap conflicts", () => {
	const conflict = [
		{ ...PROPOSALS[0], title: "sonnet way", after: "a", consensus: false, models: ["sonnet"], model: "sonnet", patchable: false, patchExcludedReason: "same-block-different-replacement", conflictKind: "same-block-different-replacement", conflictGroupId: "conflict-1" },
		{ ...PROPOSALS[0], title: "codex way", after: "b", consensus: false, models: ["codex"], model: "codex", patchable: false, patchExcludedReason: "same-block-different-replacement", conflictKind: "same-block-different-replacement", conflictGroupId: "conflict-1" },
		{ ...PROPOSALS[0], title: "overlap", models: ["sonnet"], patchable: false, patchExcludedReason: "overlap-conflict", conflictKind: "overlap", conflictsWith: ["prop-2"] },
	];
	const md = renderReportMd(META, conflict, null);
	assert.match(md, /same block, different replacement \(conflict-1\)/);
	assert.match(md, /Overlapping ranges/);
	assert.match(md, /conflicts with `#prop-2`/);
});

test("renderReportMd handles no-patch + empty proposals", () => {
	const md = renderReportMd({ scopeLabel: "x", scopeDesc: "1 file", focus: "(none)" }, [], { tldr: "Nothing." });
	assert.match(md, /_No simplifications proposed\._/);
	assert.match(md, /_Patch generation skipped/);
});
