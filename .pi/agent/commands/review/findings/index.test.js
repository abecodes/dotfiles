import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentReply, resolveAnchorLine, resolvePatchOffset, worstVerdict } from "./index.js";

const REPLY = `## Summary
Looks mostly fine.

## Findings
Something at foo.go.

\`\`\`json
{
  "verdict": "NEEDS-CHANGES",
  "findings": [
    { "severity": "HIGH", "category": "CORRECTNESS", "title": "off by one", "path": "foo.go", "line": 10, "endLine": null, "anchor": "for i := 0", "problem": "loop bound", "fix": "use <=", "style": false }
  ]
}
\`\`\``;

test("parseAgentReply splits prose from the last json fence and parses findings", () => {
	const r = parseAgentReply(REPLY, "implementation-reviewer");
	assert.equal(r.verdict, "NEEDS-CHANGES");
	assert.equal(r.findings.length, 1);
	assert.equal(r.findings[0].title, "off by one");
	assert.equal(r.findings[0].agent, "implementation-reviewer");
	assert.match(r.prose, /## Summary/);
	assert.doesNotMatch(r.prose, /```json/);
});

test("parseAgentReply captures test_results + merge_order when present", () => {
	const withExtra = REPLY.replace('"verdict": "NEEDS-CHANGES",', '"verdict": "NEEDS-CHANGES", "test_results": {"untagged":"pass","integration":"skipped"}, "merge_order": ["a","b"],');
	const r = parseAgentReply(withExtra, "implementation-reviewer");
	assert.deepEqual(r.test_results, { untagged: "pass", integration: "skipped" });
	assert.deepEqual(r.merge_order, ["a", "b"]);
});

test("parseAgentReply degrades to NEEDS-CHANGES on malformed json, keeping prose", () => {
	const r = parseAgentReply("no json here", "x");
	assert.equal(r.verdict, "NEEDS-CHANGES");
	assert.equal(r.findings.length, 0);
	assert.equal(r.parseError, true);
	assert.equal(r.prose, "no json here");
});

test("resolveAnchorLine: unique, not_found, ambiguous-nearest", () => {
	const text = "alpha\nbeta target\ngamma\nbeta target\n";
	assert.deepEqual(resolveAnchorLine(text, "alpha", 99), { line: 1, status: "unique" });
	assert.deepEqual(resolveAnchorLine(text, "nowhere", 7), { line: 7, status: "not_found" });
	// two matches at lines 2 and 4; hint 5 -> nearest is 4
	assert.deepEqual(resolveAnchorLine(text, "beta target", 5), { line: 4, status: "ambiguous" });
	assert.deepEqual(resolveAnchorLine(text, "", 3), { line: 3, status: "no_anchor" });
});

test("resolvePatchOffset maps a patch offset to source path:line", () => {
	const patch = ["diff --git a/x.go b/x.go", "--- a/x.go", "+++ b/x.go", "@@ -1,1 +1,2 @@", " keep", "+new line"].join("\n");
	// line 5 = " keep" (context) -> +1 = source 1; line 6 = "+new line" -> source 2
	assert.deepEqual(resolvePatchOffset(patch, 5), { path: "x.go", line: 1, removed: false });
	assert.deepEqual(resolvePatchOffset(patch, 6), { path: "x.go", line: 2, removed: false });
});

test("worstVerdict picks the strongest", () => {
	assert.equal(worstVerdict(["APPROVED", "NEEDS-CHANGES", "APPROVED"]), "NEEDS-CHANGES");
	assert.equal(worstVerdict(["APPROVED", "BLOCKED", "NEEDS-CHANGES"]), "BLOCKED");
	assert.equal(worstVerdict(["APPROVED", "APPROVED"]), "APPROVED");
	assert.equal(worstVerdict([]), "APPROVED");
});
