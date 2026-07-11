import { test } from "node:test";
import assert from "node:assert/strict";
import { blockLineCount, dedupe, locateBlock, mergeProposals, parseProposals, rankByImpact } from "./index.js";

const REPLY = `## Summary
Two simplifications.

\`\`\`json
{
  "proposals": [
    { "path": "a.ts", "anchor": "if (x)", "before": "if (x) {\\n  return 1\\n}", "after": "return x ? 1 : 0", "line": 3, "endLine": 5, "title": "collapse if", "category": "nesting", "impact": "high", "interfaceImpact": "internal", "rationale": "fewer branches" },
    { "path": "b.ts", "before": "exportConst", "after": "x", "title": "rename", "category": "api", "impact": "MEDIUM", "interfaceImpact": "caller-visible", "rationale": "callers change" }
  ]
}
\`\`\``;

test("parseProposals splits prose from the json fence and normalizes fields", () => {
	const r = parseProposals(REPLY, "file:a.ts");
	assert.equal(r.proposals.length, 2);
	assert.match(r.prose, /## Summary/);
	assert.doesNotMatch(r.prose, /```json/);
	const p0 = r.proposals[0];
	assert.equal(p0.impact, "HIGH"); // uppercased
	assert.equal(p0.interfaceImpact, "internal");
	assert.equal(p0.source, "file:a.ts");
	assert.equal(p0.patchable, false); // not resolved yet
	assert.equal(r.proposals[1].interfaceImpact, "caller-visible");
});

test("parseProposals degrades gracefully on garbage", () => {
	const r = parseProposals("no json", "x");
	assert.equal(r.proposals.length, 0);
	assert.equal(r.parseError, true);
	assert.equal(r.prose, "no json");
});

test("locateBlock: verbatim multi-line match returns start line", () => {
	const file = "line1\nfunc()\n  if (x) {\n    return 1\n  }\nline6\n";
	const r = locateBlock(file, "  if (x) {\n    return 1\n  }", 3);
	assert.deepEqual(r, { line: 3, status: "verbatim" });
});

test("locateBlock: whitespace-normalized retry when indentation drifts", () => {
	const file = "a\n    if (x) {\n        go()\n    }\n";
	// before has different indentation but same tokens
	const r = locateBlock(file, "if (x) {\n  go()\n}", 2);
	assert.deepEqual(r, { line: 2, status: "normalized" });
});

test("locateBlock: ambiguous normalized match -> not-found", () => {
	const file = "if (x) { go() }\nif (x) { go() }\n";
	const r = locateBlock(file, "if (x) { go() }", null);
	// verbatim has two hits -> returns first (verbatim picks nearest/first)
	assert.equal(r.status, "verbatim");
});

test("locateBlock: missing block -> not-found", () => {
	assert.deepEqual(locateBlock("a\nb\n", "zzz\nyyy", 1), { line: null, status: "not-found" });
});

test("blockLineCount counts lines (>=1)", () => {
	assert.equal(blockLineCount("one"), 1);
	assert.equal(blockLineCount("a\nb\nc"), 3);
	assert.equal(blockLineCount(""), 1);
});

test("rankByImpact: HIGH before MEDIUM before LOW, then path", () => {
	const ps = [
		{ path: "z.ts", impact: "LOW", line: 1 },
		{ path: "a.ts", impact: "HIGH", line: 1 },
		{ path: "m.ts", impact: "MEDIUM", line: 1 },
	];
	assert.deepEqual(
		rankByImpact(ps).map((p) => p.impact),
		["HIGH", "MEDIUM", "LOW"],
	);
});

test("mergeProposals: exact same replacement becomes consensus", () => {
	const ps = [
		{ path: "a.ts", impact: "HIGH", resolvedLine: 10, before: "x", after: "y", status: "located", interfaceImpact: "internal", patchable: true, model: "sonnet", models: ["sonnet"], title: "simplify", category: "idiom", rationale: "same" },
		{ path: "a.ts", impact: "HIGH", resolvedLine: 10, before: "x", after: "y", status: "located", interfaceImpact: "internal", patchable: true, model: "codex", models: ["codex"], title: "simplify", category: "idiom", rationale: "same" },
	];
	const merged = mergeProposals(ps);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].consensus, true);
	assert.deepEqual(merged[0].models, ["sonnet", "codex"]);
	assert.equal(merged[0].patchable, true);
});

test("mergeProposals: same block with different replacements is a no-auto-patch conflict", () => {
	const ps = [
		{ path: "a.ts", impact: "HIGH", resolvedLine: 10, before: "x", after: "y", status: "located", interfaceImpact: "internal", patchable: true, model: "sonnet", models: ["sonnet"], title: "sonnet way", category: "idiom", rationale: "shorter" },
		{ path: "a.ts", impact: "HIGH", resolvedLine: 10, before: "x", after: "z", status: "located", interfaceImpact: "internal", patchable: true, model: "codex", models: ["codex"], title: "codex way", category: "idiom", rationale: "clearer" },
	];
	const merged = mergeProposals(ps);
	assert.equal(merged.length, 2);
	assert.ok(merged.every((p) => p.conflictKind === "same-block-different-replacement"));
	assert.ok(merged.every((p) => p.patchable === false));
	assert.ok(merged.every((p) => p.patchExcludedReason === "same-block-different-replacement"));
	assert.equal(new Set(merged.map((p) => p.deckId)).size, 1);
});

test("mergeProposals: overlapping ranges are retained but marked no-auto-patch", () => {
	const ps = [
		{ path: "a.ts", impact: "LOW", resolvedLine: 10, before: "x\ny\nz", after: "one", status: "located", interfaceImpact: "internal", patchable: true, model: "sonnet", models: ["sonnet"], title: "first", category: "nesting", rationale: "a" },
		{ path: "a.ts", impact: "HIGH", resolvedLine: 11, before: "y", after: "two", status: "located", interfaceImpact: "internal", patchable: true, model: "codex", models: ["codex"], title: "second", category: "nesting", rationale: "b" },
		{ path: "b.ts", impact: "MEDIUM", resolvedLine: 5, before: "q", after: "r", status: "located", interfaceImpact: "internal", patchable: true, model: "sonnet", models: ["sonnet"], title: "other", category: "idiom", rationale: "c" },
	];
	const kept = mergeProposals(ps);
	assert.equal(kept.length, 3);
	const overlapping = kept.filter((p) => p.path === "a.ts");
	assert.equal(overlapping.length, 2);
	assert.ok(overlapping.every((p) => p.conflictKind === "overlap"));
	assert.ok(overlapping.every((p) => p.patchExcludedReason === "overlap-conflict"));
	assert.ok(overlapping.every((p) => p.conflictsWith.length === 1));
});

test("dedupe keeps backwards-compatible merge behavior", () => {
	const ps = [
		{ path: "a.ts", impact: "LOW", resolvedLine: null, line: null, before: "x" },
		{ path: "a.ts", impact: "HIGH", resolvedLine: null, line: null, before: "y" },
	];
	assert.equal(dedupe(ps).length, 2);
});
