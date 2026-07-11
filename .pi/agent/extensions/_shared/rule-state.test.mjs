// Standalone test harness for _shared/rule-state.ts
//
// Usage (from anywhere):
//   node ~/.pi/agent/extensions/_shared/rule-state.test.mjs
//
// The harness uses jiti (ships with @earendil-works/pi-coding-agent) to load
// the TypeScript source. No global tsx install required.
//
// Exit status:
//   0 = all assertions passed
//   1 = at least one assertion failed
//   2 = harness setup error (jiti not found)

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Locate jiti by asking the system npm where pi-coding-agent is installed. */
function findJiti() {
	const candidates = [];
	try {
		const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
		candidates.push(
			join(globalRoot, "@earendil-works/pi-coding-agent/node_modules/jiti"),
			join(globalRoot, "jiti"),
		);
	} catch {
		/* npm not on PATH — try the next strategy */
	}
	for (const p of [
		"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti",
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti",
	]) {
		candidates.push(p);
	}
	for (const c of candidates) {
		try {
			const pkg = createRequire(pathToFileURL(`${c}/`).href).resolve("./package.json");
			return dirname(pkg);
		} catch {
			/* try next */
		}
	}
	return null;
}

const jitiDir = findJiti();
if (!jitiDir) {
	console.error(
		"Could not find jiti. Make sure @earendil-works/pi-coding-agent is installed (it ships jiti).",
	);
	process.exit(2);
}

let mod;
try {
	const { createJiti } = await import(
		pathToFileURL(join(jitiDir, "lib/jiti.mjs")).href
	).catch(() => import(pathToFileURL(join(jitiDir, "dist/jiti.mjs")).href));
	const jiti = createJiti(import.meta.url, { interopDefault: true });
	mod = await jiti.import(pathResolve(join(here, "rule-state.ts")));
} catch (e) {
	console.error("Failed to load rule-state.ts via jiti:");
	console.error(e);
	process.exit(2);
}

const { publishLoadedRules, getLoadedRules, couldRulesBindOnAgent } = mod;

for (const [name, value] of Object.entries({
	publishLoadedRules,
	getLoadedRules,
	couldRulesBindOnAgent,
})) {
	if (typeof value !== "function") {
		console.error(
			`Expected ${name} to be a function exported from rule-state.ts; got ${typeof value}.`,
		);
		process.exit(2);
	}
}

let pass = 0;
let fail = 0;
const failures = [];

function assertEq(label, actual, expected) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		pass++;
	} else {
		fail++;
		failures.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
	}
}

// ---------------------------------------------------------------------------
// Helper: build a minimal LoadedRules object
// ---------------------------------------------------------------------------
function makeRules({ globalAsk = [], globalDeny = [], projectAsk = [], projectDeny = [], sessionAsk = [], sessionDeny = [] } = {}) {
	return {
		global:  { allow: [], ask: globalAsk,  deny: globalDeny  },
		project: { allow: [], ask: projectAsk, deny: projectDeny },
		session: { allow: [], ask: sessionAsk, deny: sessionDeny },
		globalPath: "/dev/null",
		projectPath: "/dev/null",
	};
}

// ---------------------------------------------------------------------------
// publishLoadedRules / getLoadedRules round-trip
// ---------------------------------------------------------------------------

assertEq("getLoadedRules: initially null (or whatever state from prior test runs)",
	typeof getLoadedRules(),
	"object",  // null is object
);

const sampleRules = makeRules({ globalAsk: ["Bash(git push:*)"] });
publishLoadedRules(sampleRules);
assertEq("getLoadedRules: returns what was published",
	getLoadedRules() === sampleRules,
	true,
);

// ---------------------------------------------------------------------------
// couldRulesBindOnAgent: empty rules → false
// ---------------------------------------------------------------------------

assertEq("couldRulesBindOnAgent: empty rules → false",
	couldRulesBindOnAgent(makeRules(), [{ name: "bash" }]),
	false,
);

assertEq("couldRulesBindOnAgent: empty agent tools → false even with rules",
	couldRulesBindOnAgent(makeRules({ globalAsk: ["Bash(rm:*)"] }), []),
	false,
);

// ---------------------------------------------------------------------------
// couldRulesBindOnAgent: tool-name match → true
// ---------------------------------------------------------------------------

assertEq("couldRulesBindOnAgent: global ask rule matches agent tool → true",
	couldRulesBindOnAgent(
		makeRules({ globalAsk: ["Bash(git push:*)"] }),
		[{ name: "bash" }],
	),
	true,
);

assertEq("couldRulesBindOnAgent: global deny rule matches agent tool → true",
	couldRulesBindOnAgent(
		makeRules({ globalDeny: ["Edit(path:~/.ssh/*)"] }),
		[{ name: "edit" }],
	),
	true,
);

assertEq("couldRulesBindOnAgent: project ask rule matches agent tool → true",
	couldRulesBindOnAgent(
		makeRules({ projectAsk: ["Bash(rm:*)"] }),
		[{ name: "bash" }],
	),
	true,
);

assertEq("couldRulesBindOnAgent: session deny rule matches agent tool → true",
	couldRulesBindOnAgent(
		makeRules({ sessionDeny: ["Write"] }),
		[{ name: "write" }],
	),
	true,
);

// ---------------------------------------------------------------------------
// couldRulesBindOnAgent: tool-name mismatch → false
// ---------------------------------------------------------------------------

assertEq("couldRulesBindOnAgent: rule for Bash, agent only has Read → false",
	couldRulesBindOnAgent(
		makeRules({ globalAsk: ["Bash(git push:*)"] }),
		[{ name: "read" }],
	),
	false,
);

assertEq("couldRulesBindOnAgent: rule for Edit, agent has Bash and Read → false",
	couldRulesBindOnAgent(
		makeRules({ globalDeny: ["Edit"] }),
		[{ name: "bash" }, { name: "read" }],
	),
	false,
);

// ---------------------------------------------------------------------------
// couldRulesBindOnAgent: case-insensitivity
// ---------------------------------------------------------------------------

assertEq("couldRulesBindOnAgent: rule written as 'bash(...)' (lowercase), agent entry 'bash' → true",
	couldRulesBindOnAgent(
		makeRules({ globalAsk: ["bash(rm:*)"] }),
		[{ name: "bash" }],
	),
	true,
);

assertEq("couldRulesBindOnAgent: rule written as 'BASH', agent entry 'bash' → true",
	couldRulesBindOnAgent(
		makeRules({ globalDeny: ["BASH"] }),
		[{ name: "bash" }],
	),
	true,
);

assertEq("couldRulesBindOnAgent: rule 'Bash', agent entry uppercase 'Bash' → true",
	couldRulesBindOnAgent(
		makeRules({ globalAsk: ["Bash(git push:*)"] }),
		[{ name: "Bash" }],
	),
	true,
);

// ---------------------------------------------------------------------------
// couldRulesBindOnAgent: multiple tools — partial overlap
// ---------------------------------------------------------------------------

assertEq("couldRulesBindOnAgent: one of two agent tools matches → true",
	couldRulesBindOnAgent(
		makeRules({ globalAsk: ["Bash(rm:*)"] }),
		[{ name: "read" }, { name: "bash" }],
	),
	true,
);

// ---------------------------------------------------------------------------
// couldRulesBindOnAgent: malformed rule strings are skipped
// ---------------------------------------------------------------------------

assertEq("couldRulesBindOnAgent: malformed rule string → skipped, does not throw",
	couldRulesBindOnAgent(
		makeRules({ globalAsk: ["123invalid", "Bash(git push:*)"] }),
		[{ name: "bash" }],
	),
	true,  // "Bash(git push:*)" still matches
);

assertEq("couldRulesBindOnAgent: only malformed rules present → false",
	couldRulesBindOnAgent(
		makeRules({ globalAsk: ["123bad", "(missingname)"] }),
		[{ name: "bash" }],
	),
	false,
);

// ---------------------------------------------------------------------------
// Multi-instance singleton sharing (mechanism-level)
//
// Production bug: pi loads each extension as its own module graph, so relative
// imports across extension boundaries (allow-list → _shared/rule-state vs
// subagent → _shared/rule-state) do NOT dedupe through node's ES module cache.
// Two module instances per process, each with its own private `let _rules`,
// allow-list publishes into instance A, subagent reads NULL from instance B.
//
// Fix: park state on globalThis under a well-known Symbol.for() key. There is
// exactly one globalThis per V8 isolate, so all module instances share it.
//
// We can't easily simulate two genuinely-separate module instances inside this
// test (jiti dedupes by file path even across createJiti calls), so we verify
// the MECHANISM that makes the fix work:
//   1. Symbol.for() is used (so the key is shared across realms / module copies)
//   2. After publishLoadedRules(), state is reachable via the symbol on globalThis
//   3. A second module simulating itself by reading globalThis directly sees it
// ---------------------------------------------------------------------------
{
	const SYMBOL_KEY = "@pi-agent/allow-list/loaded-rules";
	const sharedSymbol = Symbol.for(SYMBOL_KEY);

	const mechRules = makeRules({ globalAsk: ["Bash(mechanism test:*)"] });
	publishLoadedRules(mechRules);

	const slot = globalThis[sharedSymbol];
	assertEq("mechanism: globalThis slot exists under Symbol.for(@pi-agent/allow-list/loaded-rules)",
		typeof slot === "object" && slot !== null,
		true,
	);
	assertEq("mechanism: slot.rules holds the published value",
		slot && slot.rules === mechRules,
		true,
	);

	// Simulate "second module instance reads through its own slot() helper":
	// the helper would also do globalThis[Symbol.for(...)]. Since Symbol.for()
	// returns the same symbol every time, a separate module would see the same
	// slot we just wrote to.
	const sharedSymbol2 = Symbol.for(SYMBOL_KEY);
	assertEq("mechanism: Symbol.for() returns identical symbol across calls (cross-module sharing key)",
		sharedSymbol === sharedSymbol2,
		true,
	);
	assertEq("mechanism: a second access via the same Symbol.for() key sees the same slot object",
		globalThis[sharedSymbol2] === slot,
		true,
	);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\nrule-state tests: ${pass} passed, ${fail} failed.\n`);
if (failures.length > 0) {
	for (const f of failures) console.log(f);
	process.exit(1);
}
process.exit(0);
