// Demo harness for /simplify. Unlike a renderer-only fixture, this drives the
// REAL orchestrator (../index.js) against the real Go files in this folder:
// scope classification, the per-file + module-pass waves, collate/locate against
// the real file bytes, dedupe across passes, deterministic patch assembly, and
// the report/deck renderers all run for real. Only the LLM `c.agent` call is
// stubbed — it returns hand-authored proposals whose before/after are copied
// VERBATIM from the files here, exactly what a good simplifier would emit.
//
//   node commands/simplify/demo/build.mjs            # run + verify (no GUI)
//   node commands/simplify/demo/build.mjs --open     # also open the deck
//
// Output lands in <demo>/out/: report.md, deck.html, simplify.patch.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import run from "../index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPEN = process.argv.includes("--open");

// ─── Canned proposals (before/after copied verbatim from the .go files) ───────

const accessBefore = [
	"\tif banned {",
	"\t\treturn false",
	"\t} else {",
	'\t\tif role == "admin" {',
	"\t\t\treturn true",
	"\t\t} else {",
	"\t\t\tif owner {",
	"\t\t\t\treturn true",
	"\t\t\t} else {",
	"\t\t\t\treturn false",
	"\t\t\t}",
	"\t\t}",
	"\t}",
].join("\n");
const accessAfter = ["\tif banned {", "\t\treturn false", "\t}", '\tif role == "admin" {', "\t\treturn true", "\t}", "\treturn owner"].join("\n");

const suBefore = ["\tfound := false", "\tfor _, n := range names {", "\t\tif n == name {", "\t\t\tfound = true", "\t\t}", "\t}", "\treturn found"].join("\n");
const suAfter = ["\tfor _, n := range names {", "\t\tif n == name {", "\t\t\treturn true", "\t\t}", "\t}", "\treturn false"].join("\n");

const vDeadBefore = ["\tif false {", "\t\t// legacy escape hatch, never taken", "\t\tok = true", "\t}"].join("\n");

const vBody = [
	"\tok := false",
	"\tfor _, a := range allowed {",
	"\t\tif a == tag {",
	"\t\t\tok = true",
	"\t\t}",
	"\t}",
	"\tif false {",
	"\t\t// legacy escape hatch, never taken",
	"\t\tok = true",
	"\t}",
	"\treturn ok",
].join("\n");

function reply(prose, proposals) {
	return `${prose}\n\n\`\`\`json\n${JSON.stringify({ proposals }, null, 2)}\n\`\`\``;
}

const accessReply = reply("## Summary\nThe access check nests three if/else levels; early returns flatten it.", [
	{
		path: "access.go",
		anchor: "if banned {",
		before: accessBefore,
		after: accessAfter,
		line: 6,
		endLine: 18,
		title: "Flatten nested if/else into early returns",
		category: "nesting",
		impact: "HIGH",
		interfaceImpact: "internal",
		rationale: "Each guard returns immediately, so the trailing branch reduces to `return owner`. Same truth table: banned→false, admin→true, else owner.",
	},
]);

const suReply = reply("## Summary\nThe membership loop accumulates a flag it could return directly.", [
	{
		path: "stringsutil.go",
		anchor: "found := false",
		before: suBefore,
		after: suAfter,
		line: 5,
		endLine: 11,
		title: "Return on first match instead of a found flag",
		category: "idiom",
		impact: "MEDIUM",
		interfaceImpact: "internal",
		rationale: "Returning true on the first hit and false after the loop is equivalent — the flag only ever latches true — and avoids scanning the rest of the slice.",
	},
]);

const validateReply = reply("## Summary\nThere is a dead `if false` branch that can be removed.", [
	{
		path: "validate.go",
		anchor: "if false {",
		before: vDeadBefore,
		after: "",
		line: 10,
		endLine: 13,
		title: "Remove dead legacy branch",
		category: "dead-code",
		impact: "MEDIUM",
		interfaceImpact: "internal",
		rationale: "`if false` is never entered, so the block has no effect on the result.",
	},
]);

// Module pass: the WIDER-codebase lens. IsAllowed re-implements containsName,
// which already exists in this package — hook into it instead. This overlaps
// the per-file dead-code proposal above, so dedupe keeps this HIGHER-impact one.
const moduleReply = reply("## Summary\nIsAllowed reinvents containsName (same package). Call it instead.", [
	{
		path: "validate.go",
		anchor: "ok := false",
		before: vBody,
		after: "\treturn containsName(allowed, tag)",
		line: 5,
		endLine: 14,
		title: "Reuse containsName instead of reinventing membership",
		category: "duplication",
		impact: "HIGH",
		interfaceImpact: "internal",
		rationale: "containsName already implements this exact membership check in the same package; delegating removes the duplicated loop and the dead branch in one move. Behavior is identical.",
	},
]);

const synthReply =
	'```json\n{ "tldr": "Three behavior-preserving cleanups: the access check flattens three nested if/else levels into early returns, the membership helper returns on first match instead of latching a flag, and IsAllowed is rewritten to reuse the existing containsName helper (dropping a duplicated loop and a dead branch)." }\n```';

// ─── A real `c`, backed by fs/child_process ───────────────────────────────────

function makeC(args) {
	const log = [];
	return {
		args,
		_log: log,
		log: (m) => log.push(m),
		async phase(name, fn) {
			return fn();
		},
		async map(items, fn) {
			const out = [];
			for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
			return out;
		},
		async all(ps) {
			return Promise.all(ps);
		},
		async bash(cmd, opts = {}) {
			const cwd = opts.cwd || HERE;
			if (cmd === "mktemp -d") {
				const dir = path.join(HERE, "out");
				fs.rmSync(dir, { recursive: true, force: true });
				fs.mkdirSync(dir, { recursive: true });
				return { stdout: dir + "\n", stderr: "", code: 0 };
			}
			if (cmd.includes("xdg-open") || cmd.startsWith("( open ")) {
				if (!OPEN) return { stdout: "", stderr: "", code: 0 };
			}
			try {
				const stdout = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
				return { stdout, stderr: "", code: 0 };
			} catch (e) {
				return { stdout: e.stdout?.toString() || "", stderr: e.stderr?.toString() || "", code: e.status ?? 1 };
			}
		},
		async read(p) {
			try {
				return fs.readFileSync(p, "utf8");
			} catch {
				return null;
			}
		},
		async write(p, content) {
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, content);
		},
		async agent(req) {
			const p = req.prompt || "";
			if (req.agent === "general") return { ok: true, text: synthReply, usage: {} };
			if (p.includes("Module pass")) return { ok: true, text: moduleReply, usage: {} };
			if (p.includes("`access.go`")) return { ok: true, text: accessReply, usage: {} };
			if (p.includes("`stringsutil.go`")) return { ok: true, text: suReply, usage: {} };
			if (p.includes("`validate.go`")) return { ok: true, text: validateReply, usage: {} };
			return { ok: true, text: '```json\n{"proposals":[]}\n```', usage: {} };
		},
		async ask() {
			return { answers: [], cancelled: true, error: "no_ui" };
		},
	};
}

// ─── Run + verify ──────────────────────────────────────────────────────────────

async function main() {
	const argv = "access.go stringsutil.go validate.go --focus nesting";
	const c = makeC(argv);
	const reply = await run(c, argv);

	console.log("── /simplify " + argv + "\n");
	console.log(reply + "\n");

	const patchPath = path.join(HERE, "out", "simplify.patch");
	if (fs.existsSync(patchPath)) {
		console.log("── simplify.patch\n");
		console.log(fs.readFileSync(patchPath, "utf8"));

		// 1) The patch applies cleanly against the originals (read-only check).
		execSync(`git apply --check ${JSON.stringify(patchPath)}`, { cwd: HERE });
		console.log("✔ git apply --check passed (patch applies cleanly to the originals)\n");

		// 2) Apply to a throwaway copy and confirm it still compiles.
		const tmp = fs.mkdtempSync(path.join(require_os_tmpdir(), "simplify-demo-"));
		try {
			for (const f of ["go.mod", "access.go", "stringsutil.go", "validate.go"]) fs.copyFileSync(path.join(HERE, f), path.join(tmp, f));
			execSync(`git apply ${JSON.stringify(patchPath)}`, { cwd: tmp });
			execSync("go build ./...", { cwd: tmp });
			console.log("✔ patched copy compiles (`go build ./...`)\n");
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}

	console.log("Artifacts:");
	for (const f of ["report.md", "deck.html", "simplify.patch"]) {
		const p = path.join(HERE, "out", f);
		if (fs.existsSync(p)) console.log("  " + p);
	}
}

function require_os_tmpdir() {
	return process.env.TMPDIR || "/tmp";
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
