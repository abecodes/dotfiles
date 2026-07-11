import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSimplifyDeck } from "./index.js";

const META = {
	scopeLabel: "src/ (2 files)",
	scopeDesc: "2 files",
	focus: "nesting",
	generatedAt: "2026-06-21T00:00:00Z",
	patchRel: "/tmp/x/simplify.patch",
	patchCount: 1,
	models: ["sonnet", "codex"],
};

const PROPOSALS = [
	{
		path: "a.ts",
		resolvedLine: 12,
		deckId: "prop-0",
		title: "collapse nested if",
		category: "nesting",
		impact: "HIGH",
		interfaceImpact: "internal",
		status: "located",
		patchable: true,
		models: ["sonnet", "codex"],
		consensus: true,
		source: "file:a.ts",
		before: "if (x) {\n  return 1\n}",
		after: "return x ? 1 : 0",
		rationale: "early return is clearer",
	},
	{
		path: "b.ts",
		resolvedLine: 4,
		deckId: "prop-1",
		title: "rename export",
		category: "api",
		impact: "MEDIUM",
		interfaceImpact: "caller-visible",
		status: "located",
		patchable: false,
		patchExcludedReason: "caller-visible",
		model: "codex",
		models: ["codex"],
		source: "module-pass",
		before: "export const fooBar",
		after: "export const foo",
		rationale: "callers must update imports",
	},
];

test("renderSimplifyDeck: offline doc, verbatim before slice, jump targets, apply count", () => {
	const html = renderSimplifyDeck(META, PROPOSALS, { tldr: "Two cleanups." });
	assert.match(html, /^<!doctype html>/);
	assert.match(html, /src\/ \(2 files\)/);
	assert.match(html, /Models: sonnet \+ codex/);
	assert.match(html, /Two cleanups\./);
	// verbatim before present in a Current pane
	assert.match(html, /if \(x\) \{/);
	assert.match(html, /return x \? 1 : 0/);
	// overview card jump + detail slide ids
	assert.match(html, /data-jump="prop-0"/);
	assert.match(html, /id="prop-0"/);
	assert.match(html, /CONSENSUS/);
	assert.match(html, /NO AUTO-PATCH/);
	// caller-visible slide + apply count
	assert.match(html, /id="caller-visible"/);
	assert.match(html, /1 patchable proposal/);
	assert.match(html, /git apply \/tmp\/x\/simplify\.patch/);
	// offline (no remote scripts)
	assert.doesNotMatch(html, /src="https?:/);
});

test("renderSimplifyDeck: caller-visible slide omitted when all internal", () => {
	const html = renderSimplifyDeck(META, [PROPOSALS[0]], null);
	assert.doesNotMatch(html, /id="caller-visible"/);
	assert.match(html, /No synthesis available\./);
});

test("renderSimplifyDeck: same-block conflict uses split comparison slide", () => {
	const proposals = [
		{
			...PROPOSALS[0],
			deckId: "conflict-1",
			conflictGroupId: "conflict-1",
			conflictKind: "same-block-different-replacement",
			patchable: false,
			patchExcludedReason: "same-block-different-replacement",
			consensus: false,
			model: "sonnet",
			models: ["sonnet"],
			title: "sonnet suggestion",
			after: "return 1",
		},
		{
			...PROPOSALS[0],
			deckId: "conflict-1",
			conflictGroupId: "conflict-1",
			conflictKind: "same-block-different-replacement",
			patchable: false,
			patchExcludedReason: "same-block-different-replacement",
			consensus: false,
			model: "codex",
			models: ["codex"],
			title: "codex suggestion",
			after: "return 0",
		},
	];
	const html = renderSimplifyDeck(META, proposals, null);
	assert.match(html, /id="conflict-1"/);
	assert.match(html, /Problem \/ current code/);
	assert.match(html, /Suggestions/);
	assert.match(html, /class="stacked-panels"/);
	assert.match(html, /sonnet suggestion/);
	assert.match(html, /codex suggestion/);
});

test("renderSimplifyDeck: overlapping no-auto proposals link to conflicts", () => {
	const html = renderSimplifyDeck(
		META,
		[
			{ ...PROPOSALS[0], deckId: "prop-0", patchable: false, patchExcludedReason: "overlap-conflict", conflictKind: "overlap", conflictsWith: ["prop-1"], models: ["sonnet"], consensus: false },
			{ ...PROPOSALS[0], deckId: "prop-1", title: "other overlap", patchable: false, patchExcludedReason: "overlap-conflict", conflictKind: "overlap", conflictsWith: ["prop-0"], models: ["codex"], consensus: false },
		],
		null,
	);
	assert.match(html, /Conflicts with/);
	assert.match(html, /data-jump="prop-1"/);
	assert.match(html, /overlap conflict/);
});
