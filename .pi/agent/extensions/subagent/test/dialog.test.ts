/**
 * dialog.test.ts — unit tests for subagent/dialog.ts
 *
 * Run with the pi-resolve.mjs loader so @earendil-works/pi-tui resolves:
 *   node --import ./test/pi-resolve.mjs --test test/dialog.test.ts
 *
 * Test contract:
 *  1. Dialog constructs in each mode (select / confirm / input) without throwing.
 *  2. cancel() triggers done({cancelled: true}) exactly once, even on repeat calls.
 *  3. Missing optional fields (no matchedRule, no options, no placeholder) don't throw.
 *  4. render() returns a non-empty string array (smoke test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Dialog, type DialogParams, type DialogResult } from "../dialog.ts";

// ─── Minimal mocks ────────────────────────────────────────────────────────────

/** Bare-minimum TUI stub — Dialog stores it but only reads terminal.rows */
function makeTui() {
	return { terminal: { rows: 24 } } as any;
}

/**
 * Minimal Theme stub.
 * Dialog calls: theme.fg(key, text), theme.bold(text).
 * We return the text unchanged so render output is purely ASCII and testable.
 */
function makeTheme() {
	return {
		fg: (_key: string, text: string) => text,
		bold: (text: string) => text,
	} as any;
}

/** Build a DialogParams object for the given method with sensible defaults. */
function makeParams(
	method: DialogParams["method"],
	overrides: Partial<DialogParams> = {},
): DialogParams {
	return {
		method,
		agentName: "test-agent",
		taskPreview: "Implement the feature described in the spec",
		toolCall: "Bash(git push origin main)",
		matchedRule: "ask: Bash(git push:*)",
		title: "Allow this tool call?",
		options: method === "select" ? ["Allow", "Block"] : undefined,
		message: method === "confirm" ? "Proceed with push?" : undefined,
		placeholder: method === "input" ? "Enter reason…" : undefined,
		...overrides,
	};
}

// ─── Construction tests ───────────────────────────────────────────────────────

test("Dialog: constructs in select mode without throwing", () => {
	assert.doesNotThrow(() => {
		new Dialog({
			tui: makeTui(),
			theme: makeTheme(),
			params: makeParams("select"),
			done: () => {},
		});
	});
});

test("Dialog: constructs in confirm mode without throwing", () => {
	assert.doesNotThrow(() => {
		new Dialog({
			tui: makeTui(),
			theme: makeTheme(),
			params: makeParams("confirm"),
			done: () => {},
		});
	});
});

test("Dialog: constructs in input mode without throwing", () => {
	assert.doesNotThrow(() => {
		new Dialog({
			tui: makeTui(),
			theme: makeTheme(),
			params: makeParams("input"),
			done: () => {},
		});
	});
});

test("Dialog: constructs with missing optional fields (no matchedRule, no options, no placeholder)", () => {
	assert.doesNotThrow(() => {
		new Dialog({
			tui: makeTui(),
			theme: makeTheme(),
			params: {
				method: "input",
				agentName: "agent",
				taskPreview: "task",
				toolCall: "Read(~/.aws/credentials)",
				title: "What value?",
				// intentionally omit: matchedRule, options, message, placeholder
			},
			done: () => {},
		});
	});
});

test("Dialog: constructs select mode with empty options array without throwing", () => {
	assert.doesNotThrow(() => {
		new Dialog({
			tui: makeTui(),
			theme: makeTheme(),
			params: makeParams("select", { options: [] }),
			done: () => {},
		});
	});
});

// ─── cancel() contract ────────────────────────────────────────────────────────

test("Dialog: cancel() invokes done({cancelled: true})", () => {
	let callCount = 0;
	let lastResult: DialogResult | undefined;

	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("confirm"),
		done: (r) => {
			callCount++;
			lastResult = r;
		},
	});

	dialog.cancel();

	assert.equal(callCount, 1);
	assert.deepEqual(lastResult, { cancelled: true });
});

test("Dialog: cancel() is idempotent — multiple calls only invoke done once", () => {
	let callCount = 0;

	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select"),
		done: () => {
			callCount++;
		},
	});

	dialog.cancel();
	dialog.cancel();
	dialog.cancel();

	assert.equal(callCount, 1);
});

test("Dialog: cancel() works on select mode", () => {
	let result: DialogResult | undefined;

	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", { options: ["A", "B", "C"] }),
		done: (r) => {
			result = r;
		},
	});

	dialog.cancel();
	assert.deepEqual(result, { cancelled: true });
});

test("Dialog: cancel() works on input mode", () => {
	let result: DialogResult | undefined;

	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("input"),
		done: (r) => {
			result = r;
		},
	});

	dialog.cancel();
	assert.deepEqual(result, { cancelled: true });
});

test("Dialog: cancel() after cancel() does not call done again", () => {
	const results: DialogResult[] = [];

	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("confirm"),
		done: (r) => results.push(r),
	});

	dialog.cancel();
	dialog.cancel();
	dialog.cancel();

	assert.equal(results.length, 1);
	assert.deepEqual(results[0], { cancelled: true });
});

// ─── render() smoke tests ─────────────────────────────────────────────────────

test("Dialog: render() returns a non-empty string array in confirm mode", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("confirm"),
		done: () => {},
	});

	const lines = dialog.render(80);
	assert.ok(Array.isArray(lines), "render() must return an array");
	assert.ok(lines.length > 0, "render() must return at least one line");
	// Every element must be a string
	for (const line of lines) {
		assert.equal(typeof line, "string");
	}
});

test("Dialog: render() includes agent name and tool call in output", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", {
			agentName: "deploy-bot",
			toolCall: "Bash(git push origin main)",
		}),
		done: () => {},
	});

	const output = dialog.render(80).join("\n");
	assert.ok(output.includes("deploy-bot"), "output should contain agentName");
	assert.ok(
		output.includes("git push origin main"),
		"output should contain toolCall",
	);
});

test("Dialog: render() includes matchedRule when provided", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("confirm", {
			matchedRule: "ask: Bash(git push:*)",
		}),
		done: () => {},
	});

	const output = dialog.render(80).join("\n");
	assert.ok(output.includes("ask: Bash(git push:*)"), "output should include matchedRule");
});

test("Dialog: render() omits rule line when matchedRule is undefined", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("input", { matchedRule: undefined }),
		done: () => {},
	});

	const output = dialog.render(80).join("\n");
	assert.ok(!output.includes("Rule:"), "should not render Rule: line when matchedRule absent");
});

test("Dialog: render() omits Tool: line when toolCall is undefined", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", { toolCall: undefined }),
		done: () => {},
	});

	const output = dialog.render(80).join("\n");
	assert.ok(!output.includes("Tool:"), "should not render Tool: line when toolCall absent");
});

test("Dialog: render() includes captured widget extraLines as dim context", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", {
			extraLines: ["  ❓ git stash list", "  in /tmp/repo"],
		}),
		done: () => {},
	});

	const output = dialog.render(80).join("\n");
	assert.ok(output.includes("git stash list"), "output should include the first widget line");
	assert.ok(output.includes("/tmp/repo"), "output should include the second widget line");
});

test("Dialog: render() omits widget block when extraLines is empty / undefined", () => {
	const d1 = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", { extraLines: undefined }),
		done: () => {},
	});
	const d2 = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", { extraLines: [] }),
		done: () => {},
	});

	// Just verify both render without throwing and produce non-empty output.
	// Concrete absence is hard to assert without a marker string — the dim
	// rendering is invisible. The intent is no crash on empty/undefined.
	assert.ok(d1.render(80).length > 0);
	assert.ok(d2.render(80).length > 0);
});

test("Dialog: render() splits multi-line title onto separate array rows", () => {
	// Regression: allow-list passes multi-line content as the title (header)
	// to ctx.ui.select — leaf overview, full bash command, etc. If we push
	// the title as one string with embedded \n, pi-tui under-counts our
	// row footprint and the parent's chrome bleeds into our component's
	// rows. Each visual row of the title MUST be its own array element.
	const multiLineTitle =
		"Bash command has 1 subcommand(s) without a matching allow rule:\n" +
		"\n" +
		"  ❓ git stash list\n" +
		"\n" +
		"Full command:\n" +
		"  git stash list 2>&1";
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", { title: multiLineTitle }),
		done: () => {},
	});
	const out = dialog.render(120);

	// Every entry must be a single-line string — no embedded \n in any row.
	for (const row of out) {
		assert.ok(
			!row.includes("\n"),
			`row should not contain embedded newline; got: ${JSON.stringify(row)}`,
		);
	}

	const joined = out.join("|");
	assert.ok(joined.includes("git stash list"), "first line should appear");
	assert.ok(joined.includes("Full command:"), "middle line should appear");
	assert.ok(joined.includes("git stash list 2>&1"), "last line should appear");
});

test("Dialog: render() omits Tool: line when toolCall duplicates title (no extra info)", () => {
	const sharedString = "Allow this tool call?";
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select", { toolCall: sharedString, title: sharedString }),
		done: () => {},
	});

	const output = dialog.render(80).join("\n");
	assert.ok(!output.includes("Tool:"), "Tool: line should be suppressed when toolCall === title");
	// Title should still appear once (as the bold prompt heading)
	assert.ok(output.includes(sharedString), "title still rendered as prompt heading");
});

test("Dialog: render() still works after cancel()", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select"),
		done: () => {},
	});

	dialog.cancel();

	// render() should not throw even after the dialog is finished
	assert.doesNotThrow(() => dialog.render(80));
});

// ─── invalidate() ─────────────────────────────────────────────────────────────

test("Dialog: invalidate() does not throw", () => {
	const dialog = new Dialog({
		tui: makeTui(),
		theme: makeTheme(),
		params: makeParams("select"),
		done: () => {},
	});

	assert.doesNotThrow(() => dialog.invalidate());
});
