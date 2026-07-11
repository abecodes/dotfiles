// Tool-module tests for ask-user-question.
//
// Usage:
//   node ~/.pi/agent/extensions/ask-user-question/tool.test.mjs
//
// Loads tool.ts via jiti (shipped with @earendil-works/pi-coding-agent) so we
// don't need a local node_modules and inherit pi's typebox resolution.
// Uses node:test + node:assert/strict (same pattern as subagent/test/spawn.test.ts).
//
// Exit status:
//   0 = all tests passed
//   1 = at least one test failed
//   2 = harness setup error (jiti or pi-coding-agent not findable)

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── jiti / typebox setup ────────────────────────────────────────────────

function findPiPackage() {
	const candidates = [];
	try {
		const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
		candidates.push(join(globalRoot, "@earendil-works/pi-coding-agent"));
	} catch {
		/* npm not on PATH — fall through */
	}
	candidates.push(
		"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent",
	);
	for (const c of candidates) {
		try {
			const pkgRequire = createRequire(pathToFileURL(`${c}/`).href);
			pkgRequire.resolve("./package.json");
			return c;
		} catch {
			/* try next */
		}
	}
	return null;
}

const piRoot = findPiPackage();
if (!piRoot) {
	console.error(
		"Could not find @earendil-works/pi-coding-agent. Install pi globally so this harness can locate jiti and typebox.",
	);
	process.exit(2);
}

const piRequire = createRequire(pathToFileURL(`${piRoot}/`).href);
const jitiDir = dirname(piRequire.resolve("jiti/package.json"));
const typeboxEntry = piRequire.resolve("typebox");
const typeboxValueEntry = piRequire.resolve("typebox/value");

let createJiti;
try {
	({ createJiti } = await import(pathToFileURL(join(jitiDir, "lib/jiti.mjs")).href).catch(() =>
		import(pathToFileURL(join(jitiDir, "dist/jiti.mjs")).href),
	));
} catch (e) {
	console.error("Failed to load jiti:", e);
	process.exit(2);
}

const jiti = createJiti(import.meta.url, {
	interopDefault: true,
	moduleCache: false,
	alias: {
		typebox: typeboxEntry,
		"typebox/value": typeboxValueEntry,
		// pi-coding-agent imports we don't actually use here, but tool.ts is
		// purely a typebox + functions module so this list stays tiny.
	},
});

const here = dirname(fileURLToPath(import.meta.url));
const toolMod = await jiti.import(pathResolve(join(here, "tool.ts")));
const tbValue = await jiti.import(typeboxValueEntry);

const {
	validateQuestionnaire,
	buildEnvelope,
	buildAnswerSegment,
	buildSentinelRows,
	QuestionParamsSchema,
	RESERVED_LABELS,
	MAX_HEADER_LENGTH,
	DECLINE_MESSAGE,
	ENVELOPE_PREFIX,
	ENVELOPE_SUFFIX,
} = toolMod;
const { Check } = tbValue;

// ─── helpers ─────────────────────────────────────────────────────────────

function q(question, header, options, multiSelect) {
	return {
		question,
		header,
		options: options.map((o) => ({
			label: o.label,
			description: o.description ?? "desc",
			...(o.preview !== undefined ? { preview: o.preview } : {}),
		})),
		...(multiSelect !== undefined ? { multiSelect } : {}),
	};
}

function params(...questions) {
	return { questions };
}

const oneQ = params(q("Q1", "H", [{ label: "Pick A" }, { label: "Pick B" }]));

// ─── buildSentinelRows ───────────────────────────────────────────────────

test("buildSentinelRows: plain single-select gets 'other' then 'chat'", () => {
	const question = q("Q?", "H", [{ label: "A" }, { label: "B" }]);
	assert.deepEqual(buildSentinelRows(question, false), ["other", "chat"]);
});

test("buildSentinelRows: single-select with a preview drops 'other', keeps 'chat'", () => {
	const question = q("Q?", "H", [{ label: "A", preview: "```\nx\n```" }, { label: "B" }]);
	assert.deepEqual(buildSentinelRows(question, false), ["chat"]);
});

test("buildSentinelRows: multi-select gets only 'next'", () => {
	const question = q("Q?", "H", [{ label: "A" }, { label: "B" }], true);
	assert.deepEqual(buildSentinelRows(question, true), ["next"]);
});

test("buildSentinelRows: optionsOnly single-select suppresses all free-form rows", () => {
	const question = { ...q("Q?", "H", [{ label: "A" }, { label: "B" }]), optionsOnly: true };
	assert.deepEqual(buildSentinelRows(question, false), []);
});

test("buildSentinelRows: optionsOnly is ignored for multi-select (still 'next')", () => {
	const question = { ...q("Q?", "H", [{ label: "A" }, { label: "B" }], true), optionsOnly: true };
	assert.deepEqual(buildSentinelRows(question, true), ["next"]);
});

test("QuestionParamsSchema accepts optionsOnly on a question", () => {
	const p = params({ ...q("Q?", "H", [{ label: "A" }, { label: "B" }]), optionsOnly: true });
	assert.equal(Check(QuestionParamsSchema, p), true);
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
});

// ─── VALIDATOR — happy path ──────────────────────────────────────────────

test("validateQuestionnaire accepts a single question with two options, single-select", () => {
	const p = params(q("Pick one?", "Hdr", [{ label: "A" }, { label: "B" }]));
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
});

test("validateQuestionnaire accepts a single question with four options, multi-select", () => {
	const p = params(
		q("Pick many?", "Hdr", [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }], true),
	);
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
});

test("validateQuestionnaire accepts a single question with six options (cap)", () => {
	const p = params(
		q("Pick many?", "Hdr", [
			{ label: "A" },
			{ label: "B" },
			{ label: "C" },
			{ label: "D" },
			{ label: "E" },
			{ label: "F" },
		], true),
	);
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
});

test("validateQuestionnaire accepts four questions with mixed multi/single", () => {
	const p = params(
		q("Q1?", "H1", [{ label: "A1" }, { label: "B1" }]),
		q("Q2?", "H2", [{ label: "A2" }, { label: "B2" }, { label: "C2" }], true),
		q("Q3?", "H3", [{ label: "A3" }, { label: "B3" }, { label: "C3" }, { label: "D3" }]),
		q("Q4?", "H4", [{ label: "A4" }, { label: "B4" }], true),
	);
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
});

test("validateQuestionnaire accepts an option with a preview field on a single-select question", () => {
	const p = params(
		q("Layout?", "Hdr", [{ label: "A", preview: "```\nfoo\n```" }, { label: "B" }]),
	);
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
});

// ─── VALIDATOR — failures ────────────────────────────────────────────────

test("validateQuestionnaire rejects empty questions array as no_questions", () => {
	const r = validateQuestionnaire({ questions: [] });
	assert.equal(r.ok, false);
	assert.equal(r.error, "no_questions");
});

test("validateQuestionnaire rejects 5 questions as too_many_questions", () => {
	const p = params(
		q("Q1?", "H1", [{ label: "A" }, { label: "B" }]),
		q("Q2?", "H2", [{ label: "A" }, { label: "B" }]),
		q("Q3?", "H3", [{ label: "A" }, { label: "B" }]),
		q("Q4?", "H4", [{ label: "A" }, { label: "B" }]),
		q("Q5?", "H5", [{ label: "A" }, { label: "B" }]),
	);
	const r = validateQuestionnaire(p);
	assert.equal(r.ok, false);
	assert.equal(r.error, "too_many_questions");
});

test("validateQuestionnaire rejects a question with 1 option as empty_options", () => {
	const p = params(q("Q?", "Hdr", [{ label: "A" }]));
	const r = validateQuestionnaire(p);
	assert.equal(r.ok, false);
	assert.equal(r.error, "empty_options");
});

test("validateQuestionnaire rejects a question with 7 options as empty_options", () => {
	const p = params(
		q("Q?", "Hdr", [
			{ label: "A" },
			{ label: "B" },
			{ label: "C" },
			{ label: "D" },
			{ label: "E" },
			{ label: "F" },
			{ label: "G" },
		]),
	);
	const r = validateQuestionnaire(p);
	assert.equal(r.ok, false);
	assert.equal(r.error, "empty_options");
});

test("validateQuestionnaire rejects two questions with identical text as duplicate_question", () => {
	const p = params(
		q("Same?", "H1", [{ label: "A" }, { label: "B" }]),
		q("Same?", "H2", [{ label: "C" }, { label: "D" }]),
	);
	const r = validateQuestionnaire(p);
	assert.equal(r.ok, false);
	assert.equal(r.error, "duplicate_question");
});

test("validateQuestionnaire rejects two options in same question with same label as duplicate_option_label", () => {
	const p = params(q("Q?", "Hdr", [{ label: "Dup" }, { label: "Dup" }]));
	const r = validateQuestionnaire(p);
	assert.equal(r.ok, false);
	assert.equal(r.error, "duplicate_option_label");
});

test("validateQuestionnaire accepts two options in DIFFERENT questions sharing the same label", () => {
	const p = params(
		q("Q1?", "H1", [{ label: "Shared" }, { label: "X" }]),
		q("Q2?", "H2", [{ label: "Shared" }, { label: "Y" }]),
	);
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
});

for (const reserved of ["Other", "Type something.", "Chat about this", "Next →"]) {
	test(`validateQuestionnaire rejects option label "${reserved}" as reserved_label`, () => {
		const p = params(q("Q?", "Hdr", [{ label: reserved }, { label: "B" }]));
		const r = validateQuestionnaire(p);
		assert.equal(r.ok, false);
		assert.equal(r.error, "reserved_label");
	});
}

test("RESERVED_LABELS contents and order are pinned", () => {
	assert.deepEqual([...RESERVED_LABELS], [
		"Other",
		"Type something.",
		"Chat about this",
		"Next →",
	]);
});

// ─── VALIDATOR — trim & null/undefined edge cases ────────────────────────

test("validateQuestionnaire flags trimmed-equal duplicate questions", () => {
	const p = params(
		q("Same? ", "H1", [{ label: "A" }, { label: "B" }]),
		q(" Same?", "H2", [{ label: "C" }, { label: "D" }]),
	);
	const r = validateQuestionnaire(p);
	assert.equal(r.ok, false);
	assert.equal(r.error, "duplicate_question");
});

test("validateQuestionnaire flags trimmed-equal duplicate option labels within one question", () => {
	const p = params(q("Q?", "Hdr", [{ label: "  A" }, { label: "A  " }]));
	const r = validateQuestionnaire(p);
	assert.equal(r.ok, false);
	assert.equal(r.error, "duplicate_option_label");
});

test("validateQuestionnaire accepts lowercase variants of reserved labels (case-sensitive)", () => {
	for (const lower of ["other", "chat about this", "next \u2192", "type something."]) {
		const p = params(q("Q?", "Hdr", [{ label: lower }, { label: "B" }]));
		const r = validateQuestionnaire(p);
		assert.equal(r.ok, true, `"${lower}" should not be reserved`);
	}
});

test("validateQuestionnaire flags null/undefined/wrong-type as no_questions (no crash)", () => {
	for (const bad of [null, undefined, "string", 42, [], {}]) {
		const r = validateQuestionnaire(bad);
		assert.equal(r.ok, false);
		assert.equal(r.error, "no_questions");
	}
});

// ─── VALIDATOR — long inputs (relaxed limits) ────────────────────────────

test("schema accepts a header exactly MAX_HEADER_LENGTH (24) chars", () => {
	const header = "x".repeat(MAX_HEADER_LENGTH);
	assert.equal(header.length, 24);
	const p = params(q("Q?", header, [{ label: "A" }, { label: "B" }]));
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
	assert.equal(Check(QuestionParamsSchema, p), true);
});

test("schema rejects a 100-char header (header is the only capped field)", () => {
	const header = "x".repeat(100);
	const p = params(q("Q?", header, [{ label: "A" }, { label: "B" }]));
	assert.equal(Check(QuestionParamsSchema, p), false);
});

test("schema accepts a 200-char label (label cap dropped)", () => {
	const label = "L".repeat(200);
	const p = params(q("Q?", "Hdr", [{ label }, { label: "B" }]));
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
	assert.equal(Check(QuestionParamsSchema, p), true);
});

test("schema accepts a 500-char description", () => {
	const description = "D".repeat(500);
	const p = params(q("Q?", "Hdr", [{ label: "A", description }, { label: "B" }]));
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
	assert.equal(Check(QuestionParamsSchema, p), true);
});

test("schema accepts a 5000-char preview", () => {
	const preview = "P".repeat(5000);
	const p = params(q("Q?", "Hdr", [{ label: "A", preview }, { label: "B" }]));
	assert.deepEqual(validateQuestionnaire(p), { ok: true });
	assert.equal(Check(QuestionParamsSchema, p), true);
});

// ─── ENVELOPE ────────────────────────────────────────────────────────────

test("buildEnvelope returns DECLINE_MESSAGE on a cancelled result", () => {
	const r = { answers: [], cancelled: true };
	const out = buildEnvelope(r, oneQ);
	assert.equal(out.content[0].text, DECLINE_MESSAGE);
	assert.equal(out.details.cancelled, true);
});

test("buildEnvelope returns DECLINE_MESSAGE on a result with no answers", () => {
	const r = { answers: [], cancelled: false };
	const out = buildEnvelope(r, oneQ);
	assert.equal(out.content[0].text, DECLINE_MESSAGE);
	assert.equal(out.details.cancelled, true);
});

test("buildEnvelope returns DECLINE_MESSAGE on null", () => {
	const out = buildEnvelope(null, oneQ);
	assert.equal(out.content[0].text, DECLINE_MESSAGE);
});

test("buildEnvelope formats a single option pick with exact byte-level text", () => {
	const ans = { questionIndex: 0, question: "Q1", kind: "option", answer: "Pick A" };
	const out = buildEnvelope({ answers: [ans], cancelled: false }, oneQ);
	assert.equal(
		out.content[0].text,
		`User has answered your questions: "Q1"="Pick A". You can now continue with the user's answers in mind.`,
	);
});

test("buildEnvelope formats a multi-select pick as comma-joined labels", () => {
	const ans = {
		questionIndex: 0,
		question: "Q1",
		kind: "multi",
		answer: null,
		selected: ["A", "B", "C"],
	};
	const out = buildEnvelope({ answers: [ans], cancelled: false }, oneQ);
	assert.equal(
		out.content[0].text,
		`User has answered your questions: "Q1"="A, B, C". You can now continue with the user's answers in mind.`,
	);
});

test("buildEnvelope formats a chat pick with the two-sentence continuation directive", () => {
	const ans = { questionIndex: 0, question: "Q1", kind: "chat", answer: null };
	const out = buildEnvelope({ answers: [ans], cancelled: false }, oneQ);
	assert.equal(
		out.content[0].text,
		`User has answered your questions: "Q1"="User wants to chat about this. Continue the conversation to help them decide.". You can now continue with the user's answers in mind.`,
	);
});

test("buildEnvelope substitutes (no input) for an empty custom answer", () => {
	const empty = { questionIndex: 0, question: "Q1", kind: "custom", answer: "" };
	const out = buildEnvelope({ answers: [empty], cancelled: false }, oneQ);
	assert.ok(out.content[0].text.includes(`"Q1"="(no input)"`), out.content[0].text);
});

test("buildEnvelope formats a custom pick with the typed text", () => {
	const ans = {
		questionIndex: 0,
		question: "Q1",
		kind: "custom",
		answer: "user typed this",
	};
	const out = buildEnvelope({ answers: [ans], cancelled: false }, oneQ);
	const text = out.content[0].text;
	assert.ok(text.includes(`"Q1"="user typed this"`), text);
	assert.ok(text.startsWith(ENVELOPE_PREFIX + " "), text);
	assert.ok(text.endsWith(" " + ENVELOPE_SUFFIX), text);
});

test("buildEnvelope inserts `selected preview: …` between answer and suffix on option+preview", () => {
	const ans = {
		questionIndex: 0,
		question: "Q1",
		kind: "option",
		answer: "Pick A",
		preview: "code mockup",
	};
	const out = buildEnvelope({ answers: [ans], cancelled: false }, oneQ);
	const text = out.content[0].text;
	assert.equal(
		text,
		`User has answered your questions: "Q1"="Pick A". selected preview: code mockup. You can now continue with the user's answers in mind.`,
	);
	const previewIdx = text.indexOf("selected preview:");
	const suffixIdx = text.indexOf(ENVELOPE_SUFFIX);
	assert.ok(previewIdx > text.indexOf(`"Pick A"`));
	assert.ok(suffixIdx > previewIdx);
});

test("buildEnvelope renders multi with empty selected as (no input)", () => {
	const ans = { questionIndex: 0, question: "Q1", kind: "multi", answer: null, selected: [] };
	const out = buildEnvelope({ answers: [ans], cancelled: false }, oneQ);
	assert.ok(out.content[0].text.includes(`"Q1"="(no input)"`), out.content[0].text);
});

test("buildEnvelope orders segments by questionIndex regardless of input order", () => {
	const twoQ = {
		questions: [
			q("Q1", "H1", [{ label: "A" }, { label: "B" }]),
			q("Q2", "H2", [{ label: "C" }, { label: "D" }]),
		],
	};
	const answers = [
		{ questionIndex: 1, question: "Q2", kind: "option", answer: "D" },
		{ questionIndex: 0, question: "Q1", kind: "option", answer: "A" },
	];
	const out = buildEnvelope({ answers, cancelled: false }, twoQ);
	assert.equal(
		out.content[0].text,
		`User has answered your questions: "Q1"="A". "Q2"="D". You can now continue with the user's answers in mind.`,
	);
});

test("buildAnswerSegment is byte-stable for a bare option pick", () => {
	assert.equal(
		buildAnswerSegment({ questionIndex: 0, question: "Q", kind: "option", answer: "A" }),
		`"Q"="A".`,
	);
});
