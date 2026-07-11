import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeC, identityRealpath } from "../_shared/testkit.js";
import run from "./index.js";

const FILE_A = "export function f(x) {\n  if (x) {\n    return 1\n  }\n  return 0\n}\n";

const SIMPLIFIER_REPLY = [
	"## Summary",
	"One cleanup.",
	"",
	"```json",
	'{ "proposals": [ { "path":"a.ts","anchor":"if (x)","before":"  if (x) {\\n    return 1\\n  }\\n  return 0","after":"  return x ? 1 : 0","line":2,"endLine":5,"title":"collapse if","category":"nesting","impact":"HIGH","interfaceImpact":"internal","rationale":"early return preserves behavior" } ] }',
	"```",
].join("\n");

const SYNTH_REPLY = '```json\n{ "tldr": "Collapsed a nested if into an early return." }\n```';

function harness({ argv = "", askAnswer } = {}) {
	const writes = {};
	const c = fakeC({
		bash: (cmd) => {
			const rp = identityRealpath(cmd);
			if (rp) return rp;
			if (cmd === "pwd") return { stdout: "/repo\n", code: 0, stderr: "" };
			if (cmd.includes("rev-parse -q --verify HEAD")) return { stdout: "abc\n", code: 0, stderr: "" };
			if (cmd === "git diff --name-only HEAD") return { stdout: "a.ts\n", code: 0, stderr: "" };
			if (cmd.includes("ls-files --others")) return { stdout: "", code: 0, stderr: "" };
			if (cmd === "mktemp -d") return { stdout: "/tmp/simpout\n", code: 0, stderr: "" };
			return { stdout: "", code: 0, stderr: "" };
		},
		read: (p) => (p === "/repo/a.ts" ? FILE_A : null),
		agent: (req) => {
			if (req.agent === "simplifier") return { ok: true, text: SIMPLIFIER_REPLY, usage: {} };
			if (req.agent === "general") return { ok: true, text: SYNTH_REPLY, usage: {} };
			return { ok: true, text: "", usage: {} };
		},
		ask: () => askAnswer || { answers: [], cancelled: true, error: "no_ui" },
	});
	c.args = argv;
	return { c, writes: c._writes };
}

test("no-arg run: working-tree file -> report, deck, patch, and a summary reply", async () => {
	const { c, writes } = harness();
	const reply = await run(c, "");

	// Artifacts written under the ephemeral root.
	assert.ok(writes["/tmp/simpout/report.md"], "report.md written");
	assert.ok(writes["/tmp/simpout/deck.html"], "deck.html written");
	assert.ok(writes["/tmp/simpout/simplify.patch"], "simplify.patch written");

	// Report header is populated (regression: scopeLabel/scopeDesc must not be undefined).
	assert.match(writes["/tmp/simpout/report.md"], /^# Simplify — /m);
	assert.doesNotMatch(writes["/tmp/simpout/report.md"], /undefined/);
	// Report contains the proposal + apply line.
	assert.match(writes["/tmp/simpout/report.md"], /collapse if/);
	assert.match(writes["/tmp/simpout/report.md"], /Collapsed a nested if/); // synth tldr
	assert.match(writes["/tmp/simpout/report.md"], /git apply \/tmp\/simpout\/simplify\.patch/);

	// Patch is a real unified diff with the located block.
	assert.match(writes["/tmp/simpout/simplify.patch"], /^diff --git a\/a\.ts b\/a\.ts$/m);
	assert.match(writes["/tmp/simpout/simplify.patch"], /^-  if \(x\) \{$/m);
	assert.match(writes["/tmp/simpout/simplify.patch"], /^\+  return x \? 1 : 0$/m);

	// Final reply summarizes counts + paths.
	assert.match(reply, /1 proposal\(s\)/);
	assert.match(reply, /1 HIGH/);
	assert.match(reply, /report\.md: \/tmp\/simpout\/report\.md/);
});

test("--no-deck --no-patch suppresses those artifacts", async () => {
	const { c, writes } = harness({ argv: "--no-deck --no-patch --focus duplication" });
	await run(c, "--no-deck --no-patch --focus duplication");
	assert.ok(writes["/tmp/simpout/report.md"]);
	assert.equal(writes["/tmp/simpout/deck.html"], undefined);
	assert.equal(writes["/tmp/simpout/simplify.patch"], undefined);
	assert.match(writes["/tmp/simpout/report.md"], /Focus: duplication/);
});

test("multi-select focus maps checked categories into the bias string", async () => {
	const { c, writes } = harness({
		askAnswer: { answers: [{ kind: "multi", answer: null, selected: ["Dead code", "Nesting"] }], cancelled: false },
	});
	await run(c, "");
	const report = writes["/tmp/simpout/report.md"];
	assert.ok(report, "report.md written");
	assert.match(report, /Focus: dead-code.*nesting/s);
});

test("interactive cancel on the focus prompt aborts the run and writes nothing", async () => {
	// cancelled WITHOUT an error == a real user Esc / "Chat about this" (vs the
	// headless `error: "no_ui"` path, which auto-proceeds).
	const { c, writes } = harness({ askAnswer: { answers: [], cancelled: true } });
	const reply = await run(c, "");
	assert.match(reply, /aborted/i);
	assert.equal(writes["/tmp/simpout/report.md"], undefined);
	assert.equal(writes["/tmp/simpout/deck.html"], undefined);
	assert.equal(writes["/tmp/simpout/simplify.patch"], undefined);
});

test("empty scope -> nothing to simplify", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd === "pwd") return { stdout: "/repo\n", code: 0, stderr: "" };
			if (cmd.includes("rev-parse -q --verify HEAD")) return { stdout: "abc\n", code: 0, stderr: "" };
			return { stdout: "", code: 0, stderr: "" }; // no changed files, no untracked
		},
	});
	c.args = "";
	const reply = await run(c, "");
	assert.match(reply, /Nothing to simplify/);
});
