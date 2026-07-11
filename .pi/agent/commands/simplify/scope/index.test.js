import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeC } from "../../_shared/testkit.js";
import { classifyScope, hasPathSep, isGlob, isSourceFile, orderForWaves, resolveScope, scoreComplexity } from "./index.js";

test("isGlob / hasPathSep detection", () => {
	assert.equal(isGlob("src/**/*.ts"), true);
	assert.equal(isGlob("a[bc].js"), true);
	assert.equal(isGlob("src/foo.ts"), false);
	assert.equal(hasPathSep("src/foo.ts"), true);
	assert.equal(hasPathSep("PaymentService.charge"), false);
});

test("isSourceFile rejects vendor/binary/minified, accepts code", () => {
	assert.equal(isSourceFile("src/a.ts"), true);
	assert.equal(isSourceFile("node_modules/x/y.js"), false);
	assert.equal(isSourceFile("vendor/lib.go"), false);
	assert.equal(isSourceFile("assets/logo.png"), false);
	assert.equal(isSourceFile("dist/app.min.js"), false);
	assert.equal(isSourceFile("pkg.lock"), false);
});

test("scoreComplexity grows with size, nesting, and long runs", () => {
	const flat = "a\nb\nc\n";
	const nested = "func() {\n    if (x) {\n        if (y) {\n            deep()\n        }\n    }\n}\n";
	assert.ok(scoreComplexity(nested) > scoreComplexity(flat));
});

test("orderForWaves: explicit first, expanded messiest-first, capped to maxFiles", () => {
	const units = [
		{ path: "exp-a.ts", provenance: "expanded", complexity: 10 },
		{ path: "exp-b.ts", provenance: "expanded", complexity: 99 },
		{ path: "exp-c.ts", provenance: "expanded", complexity: 50 },
		{ path: "explicit.ts", provenance: "explicit" },
	];
	const ordered = orderForWaves(units, 3);
	assert.deepEqual(
		ordered.map((u) => u.path),
		["explicit.ts", "exp-b.ts", "exp-c.ts"],
	);
});

test("orderForWaves: explicit never dropped even past the cap", () => {
	const units = [
		{ path: "e1.ts", provenance: "explicit" },
		{ path: "e2.ts", provenance: "explicit" },
		{ path: "x.ts", provenance: "expanded", complexity: 5 },
	];
	const ordered = orderForWaves(units, 1);
	assert.deepEqual(
		ordered.map((u) => u.path),
		["e1.ts", "e2.ts"],
	);
});

test("classifyScope: glob, file, dir, symbol, invalid", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd.includes("git ls-files -- 'src/**/*.ts'")) return { stdout: "src/a.ts\nsrc/b.ts\n", code: 0, stderr: "" };
			if (cmd.includes("[ -f 'src/foo.ts' ]")) return { stdout: "file\n", code: 0, stderr: "" };
			if (cmd.includes("[ -f 'src' ]")) return { stdout: "dir\n", code: 0, stderr: "" };
			if (cmd.includes("git ls-files -- 'src'")) return { stdout: "src/a.ts\nsrc/logo.png\n", code: 0, stderr: "" };
			if (cmd.includes("[ -f 'PaymentService.charge' ]")) return { stdout: "none\n", code: 0, stderr: "" };
			if (cmd.includes("[ -f 'ghost/x.ts' ]")) return { stdout: "none\n", code: 0, stderr: "" };
			return { stdout: "", code: 1, stderr: "" };
		},
	});
	assert.deepEqual(await classifyScope(c, "src/**/*.ts"), { mode: "glob", glob: "src/**/*.ts", files: ["src/a.ts", "src/b.ts"] });
	assert.deepEqual(await classifyScope(c, "src/foo.ts"), { mode: "file", path: "src/foo.ts" });
	const dir = await classifyScope(c, "src");
	assert.equal(dir.mode, "dir");
	assert.deepEqual(dir.files, ["src/a.ts"]); // logo.png filtered out
	assert.deepEqual(await classifyScope(c, "PaymentService.charge"), { mode: "symbol", symbol: "PaymentService.charge" });
	assert.equal((await classifyScope(c, "ghost/x.ts")).mode, "invalid");
});

test("resolveScope: no tokens -> working-tree diff (expanded), tags provenance", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd.includes("rev-parse -q --verify HEAD")) return { stdout: "abc\n", code: 0, stderr: "" };
			if (cmd === "git diff --name-only HEAD") return { stdout: "a.ts\nb.ts\n", code: 0, stderr: "" };
			if (cmd.includes("ls-files --others")) return { stdout: "", code: 0, stderr: "" };
			return { stdout: "", code: 1, stderr: "" };
		},
		read: () => "x\ny\n",
	});
	const { units, expanded, explicit } = await resolveScope(c, [], {});
	assert.deepEqual(units.map((u) => u.path).sort(), ["a.ts", "b.ts"]);
	assert.equal(expanded.length, 2);
	assert.equal(explicit.length, 0);
	assert.ok(expanded.every((u) => Number.isFinite(u.complexity)));
});

test("resolveScope: explicit file token beats an expanded diff dupe", async () => {
	const c = fakeC({
		bash: (cmd) => {
			if (cmd.includes("rev-parse -q --verify HEAD")) return { stdout: "abc\n", code: 0, stderr: "" };
			if (cmd === "git diff --name-only HEAD") return { stdout: "a.ts\n", code: 0, stderr: "" };
			if (cmd.includes("ls-files --others")) return { stdout: "", code: 0, stderr: "" };
			if (cmd.includes("[ -f 'a.ts' ]")) return { stdout: "file\n", code: 0, stderr: "" };
			return { stdout: "", code: 1, stderr: "" };
		},
		read: () => "x\n",
	});
	// --diff present AND token a.ts named explicitly
	const { units, explicit } = await resolveScope(c, ["a.ts"], { diff: "" });
	assert.equal(units.length, 1);
	assert.equal(units[0].provenance, "explicit");
	assert.equal(explicit.length, 1);
});
