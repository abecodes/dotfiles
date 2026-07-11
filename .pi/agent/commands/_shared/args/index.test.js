import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./index.js";

const SPEC = {
	flags: {
		"--staged": { type: "boolean", key: "staged", value: true },
		"--no-deck": { type: "boolean", key: "deck", value: false },
		"--base": { type: "value", key: "base" },
		"--author": { type: "value", key: "author", transform: (s) => s.toLowerCase() },
		"--max": { type: "value", key: "max", transform: Number },
		"--diff": { type: "optionalValue", key: "diff" },
	},
	defaults: { deck: true, author: "sonnet" },
};

test("defaults seed flags before parsing", () => {
	const { flags, tokens } = parseArgs("", SPEC);
	assert.equal(flags.deck, true);
	assert.equal(flags.author, "sonnet");
	assert.deepEqual(tokens, []);
});

test("boolean flags set their fixed value", () => {
	const { flags } = parseArgs("--staged --no-deck", SPEC);
	assert.equal(flags.staged, true);
	assert.equal(flags.deck, false);
});

test("value flags consume the next token; transform applies", () => {
	const { flags } = parseArgs("--base origin/main --author OPUS --max 5", SPEC);
	assert.equal(flags.base, "origin/main");
	assert.equal(flags.author, "opus");
	assert.equal(flags.max, 5);
});

test("optionalValue: bare flag -> empty string", () => {
	const { flags } = parseArgs("--diff", SPEC);
	assert.equal(flags.diff, "");
});

test("optionalValue: consumes a non-flag following token as the ref", () => {
	const { flags, tokens } = parseArgs("--diff origin/main", SPEC);
	assert.equal(flags.diff, "origin/main");
	assert.deepEqual(tokens, []);
});

test("optionalValue: does not consume a following flag", () => {
	const { flags } = parseArgs("--diff --staged", SPEC);
	assert.equal(flags.diff, "");
	assert.equal(flags.staged, true);
});

test("positionals collect; unknown flags warn and are dropped", () => {
	const { flags, tokens, warnings } = parseArgs("src/a.ts --bogus src/b.ts", SPEC);
	assert.deepEqual(tokens, ["src/a.ts", "src/b.ts"]);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /--bogus/);
	assert.equal(flags.deck, true);
});
