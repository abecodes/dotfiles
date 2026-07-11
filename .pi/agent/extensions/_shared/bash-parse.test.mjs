// Standalone tokenizer test harness for the shared bash parser.
//
// Usage (from anywhere):
//   node ~/.pi/agent/extensions/_shared/bash-parse.test.mjs
//
// The harness uses jiti, which ships inside the pi installation
// (@earendil-works/pi-coding-agent), to load the TypeScript source.
// No global tsx install required.
//
// Exit status:
//   0 = all assertions passed
//   1 = at least one assertion failed
//   2 = harness setup error (jiti not found)
//
// The parser primitives (decomposeBash, splitSegments, etc.) are exported
// from bash-parse.ts so this harness — and any pi extension that needs them —
// can import them directly. Pi never auto-loads bash-parse.ts as an extension
// because it lives under _shared/ and isn't named index.ts.

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, "bash-parse.ts");

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
	// Also try common Homebrew / system locations.
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
	console.error("Could not find jiti. Make sure @earendil-works/pi-coding-agent is installed (it ships jiti).");
	process.exit(2);
}

let mod;
try {
	const { createJiti } = await import(pathToFileURL(join(jitiDir, "lib/jiti.mjs")).href).catch(() =>
		import(pathToFileURL(join(jitiDir, "dist/jiti.mjs")).href),
	);
	const jiti = createJiti(import.meta.url, { interopDefault: true });
	mod = await jiti.import(pathResolve(sourcePath));
} catch (e) {
	console.error("Failed to load bash-parse.ts via jiti:");
	console.error(e);
	process.exit(2);
}

const { decomposeBash, stripHeredocs, stripComments, splitSegments, extractSubstitutions, stripSubstitutions } = mod;

for (const [name, value] of Object.entries({
	decomposeBash,
	stripHeredocs,
	stripComments,
	splitSegments,
	extractSubstitutions,
	stripSubstitutions,
})) {
	if (typeof value !== "function") {
		console.error(`Expected ${name} to be a function exported from bash-parse.ts; got ${typeof value}.`);
		process.exit(2);
	}
}

let pass = 0;
let fail = 0;
const failures = [];

/** Canonicalise an object's key order so structural compare is order-independent. */
function canon(v) {
	if (Array.isArray(v)) return v.map(canon);
	if (v && typeof v === "object") {
		const sorted = {};
		for (const k of Object.keys(v).sort()) sorted[k] = canon(v[k]);
		return sorted;
	}
	return v;
}

function assertEq(label, actual, expected) {
	const a = JSON.stringify(canon(actual));
	const e = JSON.stringify(canon(expected));
	if (a === e) {
		pass++;
	} else {
		fail++;
		failures.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
	}
}

function leafSummary(leaves) {
	return leaves.map((l) => ({ depth: l.depth, match: l.match, display: l.display }));
}

// --- splitSegments --------------------------------------------------------

assertEq("split: simple chain on ;",
	splitSegments("ls; pwd; echo hi"),
	["ls", " pwd", " echo hi"]);

assertEq("split: && and ||",
	splitSegments("a && b || c"),
	["a ", " b ", " c"]);

assertEq("split: pipe",
	splitSegments("a | b"),
	["a ", " b"]);

assertEq("split: ; inside single quotes is preserved",
	splitSegments("echo 'a; b'; ls"),
	["echo 'a; b'", " ls"]);

assertEq("split: ; inside double quotes is preserved",
	splitSegments('echo "a; b"; ls'),
	['echo "a; b"', " ls"]);

assertEq("split: do/done are separators (in is NOT a separator)",
	splitSegments("for x in a b; do echo $x; done"),
	["for x in a b", " echo $x"]);

assertEq("split: keyword that's actually an argument is preserved",
	splitSegments("echo done"),
	["echo done"]);

assertEq("split: 2>&1 redirect is not a background separator",
	splitSegments("go build ./... 2>&1 | tail -5"),
	["go build ./... 2>&1 ", " tail -5"]);

// --- extractSubstitutions -------------------------------------------------

assertEq("extract: $(...)",
	extractSubstitutions("echo $(date)"),
	["date"]);

assertEq("extract: backticks",
	extractSubstitutions("echo `date`"),
	["date"]);

assertEq("extract: nested $(...)",
	extractSubstitutions("echo $(foo $(bar) baz)"),
	["foo $(bar) baz"]);

assertEq("extract: process substitution <(...)",
	extractSubstitutions("diff <(cat a) <(cat b)"),
	["cat a", "cat b"]);

assertEq("extract: skips quoted",
	extractSubstitutions("echo '$(not-a-sub)'"),
	[]);

// --- stripSubstitutions ---------------------------------------------------

assertEq("strip: $(...) becomes empty",
	stripSubstitutions('echo "x: $(date)"'),
	'echo "x: "');

assertEq("strip: <(...) erased",
	stripSubstitutions("diff <(cat a) <(cat b)"),
	"diff  ");

// --- stripComments --------------------------------------------------------

assertEq("comment: leading-line comment is dropped, newline preserved",
	stripComments("# hello world\nls"),
	"\nls");

assertEq("comment: mid-chain comment between commands is dropped",
	stripComments("echo hi\n# explain\nls"),
	"echo hi\n\nls");

assertEq("comment: trailing comment after a command is dropped",
	stripComments("echo hi # bye\nls"),
	"echo hi \nls");

assertEq("comment: # inside single quotes is preserved",
	stripComments("echo '# not a comment'"),
	"echo '# not a comment'");

assertEq("comment: # inside double quotes is preserved",
	stripComments('echo "# not a comment"'),
	'echo "# not a comment"');

assertEq("comment: # in the middle of a token is preserved",
	stripComments("echo a#b"),
	"echo a#b");

assertEq("comment: ${var#prefix} parameter expansion is preserved",
	stripComments("echo ${PATH#/usr}"),
	"echo ${PATH#/usr}");

assertEq("comment: # after ; starts a comment",
	stripComments("ls;# trailing\npwd"),
	"ls;\npwd");

assertEq("comment: trailing comment with no newline drops to end of input",
	stripComments("echo hi # bye"),
	"echo hi ");

assertEq("comment: shebang-like first line is dropped",
	stripComments("#!/usr/bin/env bash\necho hi"),
	"\necho hi");

// --- stripHeredocs --------------------------------------------------------

assertEq("heredoc: simple",
	stripHeredocs("cat <<EOF\nhello\nEOF\necho done"),
	"cat <<EOF\necho done");

assertEq("heredoc: <<-EOF with tab indent",
	stripHeredocs("cat <<-EOF\n\thello\n\tEOF\necho done"),
	"cat <<-EOF\necho done");

assertEq("heredoc: quoted delim",
	stripHeredocs("cat <<'EOF'\n$(rm -rf /)\nEOF\necho done"),
	"cat <<'EOF'\necho done");

assertEq("heredoc: here-string <<< is left alone",
	stripHeredocs('grep foo <<<"data"'),
	'grep foo <<<"data"');

// --- decomposeBash --------------------------------------------------------

assertEq("decompose: trivial",
	leafSummary(decomposeBash("ls -la")),
	[{ depth: 0, match: "ls -la", display: "ls -la" }]);

assertEq("decompose: chain",
	leafSummary(decomposeBash("cd /tmp && ls")),
	[
		{ depth: 0, match: "cd /tmp", display: "cd /tmp" },
		{ depth: 0, match: "ls", display: "ls" },
	]);

assertEq("decompose: for loop drops head, keeps body",
	leafSummary(decomposeBash("for x in a b c; do echo $x; done")),
	[{ depth: 0, match: "echo $x", display: "echo $x" }]);

assertEq("decompose: $(...) recurses; outer leaf has substitution stripped",
	leafSummary(decomposeBash('echo "GOWORK: $(go env GOWORK)"')),
	[
		{ depth: 1, match: "go env GOWORK", display: "go env GOWORK" },
		{ depth: 0, match: 'echo "GOWORK: "', display: 'echo "GOWORK: "' },
	]);

assertEq("decompose: process substitution",
	leafSummary(decomposeBash("diff <(cat a) <(cat b)")),
	[
		{ depth: 1, match: "cat a", display: "cat a" },
		{ depth: 1, match: "cat b", display: "cat b" },
		{ depth: 0, match: "diff", display: "diff" },
	]);

assertEq("decompose: SUDO_ASKPASS prefix; sudo lifts to head",
	leafSummary(decomposeBash("SUDO_ASKPASS=foo sudo rm -rf /")),
	[
		{
			depth: 0,
			display: "SUDO_ASKPASS=foo sudo rm -rf /",
			match: "sudo rm -rf /",
		},
	]);

assertEq("decompose: time modifier stripped",
	leafSummary(decomposeBash("time go build")),
	[{ depth: 0, display: "time go build", match: "go build" }]);

assertEq("decompose: pipe with redirect",
	leafSummary(decomposeBash("go build ./... 2>&1 | tail -5")),
	[
		{ depth: 0, match: "go build ./... 2>&1", display: "go build ./... 2>&1" },
		{ depth: 0, match: "tail -5", display: "tail -5" },
	]);

assertEq("decompose: builtins skipped",
	leafSummary(decomposeBash(": && true && ls")),
	[{ depth: 0, match: "ls", display: "ls" }]);

assertEq("decompose: pure-assignment leaf is skipped (recursion already covered $())",
	leafSummary(decomposeBash("x=$(date)")),
	[{ depth: 1, match: "date", display: "date" }]);

assertEq("decompose: heredoc body never becomes leaves",
	leafSummary(decomposeBash("cat <<EOF\nrm -rf /\nEOF\necho done")),
	[
		{ depth: 0, match: "cat <<EOF", display: "cat <<EOF" },
		{ depth: 0, match: "echo done", display: "echo done" },
	]);

assertEq("decompose: comment-only line yields no leaf",
	leafSummary(decomposeBash("# explain\nls")),
	[{ depth: 0, match: "ls", display: "ls" }]);

assertEq("decompose: trailing comment is stripped from leaf",
	leafSummary(decomposeBash("echo hi # explain\nls")),
	[
		{ depth: 0, match: "echo hi", display: "echo hi" },
		{ depth: 0, match: "ls", display: "ls" },
	]);

assertEq("decompose: comment inside $(...) is stripped from inner leaf",
	leafSummary(decomposeBash("echo $(ls # inner\n)")),
	[
		{ depth: 1, match: "ls", display: "ls" },
		{ depth: 0, match: "echo", display: "echo" },
	]);

assertEq("decompose: real-world allow-list bug — # comment between commands",
	(() => {
		const input = [
			'find /tmp -name "tsc" 2>/dev/null | head -3',
			'echo "---"',
			'# Use the TS that ships with pi-coding-agent if any',
			'find /opt/homebrew/lib -maxdepth 4 -name "tsc" 2>/dev/null | head -3',
		].join("\n");
		const leaves = leafSummary(decomposeBash(input));
		// No leaf should be the bare comment line.
		return leaves.every((l) => !l.match.startsWith("#"));
	})(),
	true);

assertEq("decompose: CR is stripped",
	leafSummary(decomposeBash("ls\r\necho hi")),
	[
		{ depth: 0, match: "ls", display: "ls" },
		{ depth: 0, match: "echo hi", display: "echo hi" },
	]);

// --- extractSubstitutions: double-quoted-context bug regression ----------
// Bug: extractSubstitutions used to walk the whole string blindly, so a bare
// `(...)` group inside a double-quoted argument (e.g. `echo "foo (bar) baz"`)
// would be falsely extracted as a subshell body and recursed into, producing
// a phantom depth-1 leaf in the allow-list review.
assertEq("extractSubstitutions: bare (..) inside \"..\" is NOT a substitution",
	extractSubstitutions('echo "---PR body (truncated)---"'),
	[]);

assertEq("extractSubstitutions: bare (..) outside quotes IS a substitution",
	extractSubstitutions('echo a; (cd /tmp && ls)'),
	["cd /tmp && ls"]);

assertEq("extractSubstitutions: $(..) inside \"..\" still extracted",
	extractSubstitutions('echo "GOWORK: $(go env GOWORK)"'),
	["go env GOWORK"]);

assertEq("extractSubstitutions: backticks inside \"..\" still extracted",
	extractSubstitutions('echo "date: `date -u`"'),
	["date -u"]);

assertEq("extractSubstitutions: nested $( inside \"..\" containing bare ( does not leak",
	extractSubstitutions('echo "$(printf \'(literal)\')"'),
	["printf '(literal)'"]);

assertEq("extractSubstitutions: escaped quote inside \"..\" does not break out",
	extractSubstitutions('echo "a \\" (b) c" $(date)'),
	["date"]);

assertEq("decompose: bare (..) inside \"..\" yields a single top-level leaf",
	leafSummary(decomposeBash('echo "---PR body (truncated)---"')),
	[{ depth: 0, match: 'echo "---PR body (truncated)---"', display: 'echo "---PR body (truncated)---"' }]);

assertEq("decompose: real-world scout invocation with (truncated) marker",
	(() => {
		const input = [
			'TARGET=/tmp/foo wc -l $TARGET/.review/diff.patch',
			"grep -lE '\\.go$|^go\\.mod$|^go\\.sum$' $TARGET/.review/diff.patch && echo \"go-detected: yes\" || echo \"go-detected: no\"",
			'echo "---PR body (truncated)---"',
			'head -c 2000 $TARGET/.review/pr_body.md 2>/dev/null || head -c 2000 $TARGET/.review/log.txt',
		].join("\n");
		const leaves = leafSummary(decomposeBash(input));
		// No depth>0 leaf should exist — nothing in this command is a real
		// substitution. In particular `truncated` must not appear as a leaf.
		return leaves.every((l) => l.depth === 0) && !leaves.some((l) => l.match === "truncated");
	})(),
	true);

assertEq("decompose: $(..) inside \"..\" still recurses",
	leafSummary(decomposeBash('echo "GOWORK: $(go env GOWORK)"')),
	[
		{ depth: 1, match: "go env GOWORK", display: "go env GOWORK" },
		{ depth: 0, match: 'echo "GOWORK: "', display: 'echo "GOWORK: "' },
	]);

assertEq("decompose: nested deny inside $()",
	(() => {
		// Just check that the inner leaf shows up; verdict is a separate concern.
		const ls = leafSummary(decomposeBash('echo "$(rm -rf /)"'));
		return ls.some((l) => l.depth === 1 && l.match === "rm -rf /");
	})(),
	true);

// --- Arithmetic expansion `$((...))` is opaque, not a substitution -------
// Bug: `$((line - prev))` used to be parsed as `$( (line - prev) )` — a
// command substitution wrapping a subshell — so we'd emit a phantom inner
// leaf `line - prev` and erase the whole arithmetic from the outer leaf's
// display.
assertEq("extract: $((..)) is NOT a substitution",
	extractSubstitutions('echo "$((line - prev)) $label"'),
	[]);

assertEq("extract: $((..)) outside double quotes is NOT a substitution",
	extractSubstitutions('x=$((1 + 2)); echo $x'),
	[]);

assertEq("extract: $((..)) alongside real $(..) only extracts the real one",
	extractSubstitutions('echo $((1 + 2)) $(date)'),
	["date"]);

assertEq("strip: $((..)) inside \"..\" is kept verbatim",
	stripSubstitutions('echo "$((line - prev)) $label"'),
	'echo "$((line - prev)) $label"');

assertEq("strip: $((..)) at top level is kept verbatim",
	stripSubstitutions('echo $((1 + 2))'),
	'echo $((1 + 2))');

assertEq("decompose: $((..)) inside echo yields a single top-level leaf",
	leafSummary(decomposeBash('echo "$((line - prev)) $prev_label"')),
	[{ depth: 0, match: 'echo "$((line - prev)) $prev_label"', display: 'echo "$((line - prev)) $prev_label"' }]);

assertEq("decompose: $((..)) does not produce a phantom inner leaf",
	(() => {
		const leaves = leafSummary(decomposeBash('echo "$((line - prev)) $label"'));
		// All leaves at depth 0; no leaf is the bare arithmetic body.
		return leaves.every((l) => l.depth === 0) &&
			!leaves.some((l) => l.match.trim() === "line - prev");
	})(),
	true);

assertEq("decompose: $((..)) alongside real $(..) still recurses into the $(..)",
	leafSummary(decomposeBash('echo $((1 + 2)) $(date)')),
	[
		{ depth: 1, match: "date", display: "date" },
		{ depth: 0, match: "echo $((1 + 2))", display: "echo $((1 + 2))" },
	]);

// --- exec with no command (only fd redirections) is a no-op --------------
// `exec 3</tmp/x` and `exec 3<&-` apply redirections to the current shell;
// no command is run. After `exec` is stripped as a modifier the leaf would
// otherwise become a nonsense token like `3</tmp/x`, which can't sensibly
// match any rule pattern. decomposeBash now drops it.
assertEq("decompose: exec 3<file (open fd) yields no leaf",
	leafSummary(decomposeBash("exec 3</tmp/starts.txt")),
	[]);

assertEq("decompose: exec 3<&- (close fd) yields no leaf",
	leafSummary(decomposeBash("exec 3<&-")),
	[]);

assertEq("decompose: exec >log 2>&1 (redirect current shell stdout) yields no leaf",
	leafSummary(decomposeBash("exec >log 2>&1")),
	[]);

assertEq("decompose: exec node app.js (real exec replacement) keeps the command",
	leafSummary(decomposeBash("exec node app.js")),
	[{ depth: 0, match: "node app.js", display: "exec node app.js" }]);

assertEq("decompose: real-world while-loop with exec fd + arithmetic",
	(() => {
		const input = [
			'grep -n "^##" .review/impact.md | cut -d: -f1 > /tmp/starts.txt',
			'wc -l < .review/impact.md > /tmp/total.txt',
			'total=$(cat /tmp/total.txt)',
			'prev=0',
			'prev_label=""',
			'exec 3</tmp/starts.txt',
			'while IFS= read -r -u 3 line; do',
			'  if [[ -n "$prev_label" ]]; then',
			'    echo "$((line - prev)) $prev_label"',
			'  fi',
			'  prev=$line',
			'  prev_label=$(head -n "$line" .review/impact.md | tail -1)',
			'done',
			'if [[ -n "$prev_label" ]]; then',
			'  echo "$((total - prev + 1)) $prev_label"',
			'fi',
			'exec 3<&-',
		].join("\n");
		const leaves = leafSummary(decomposeBash(input));
		// No leaf should be a bare arithmetic body or a bare fd redirection.
		const bad = leaves.filter((l) => {
			const m = l.match.trim();
			return m === "line - prev" ||
				m === "total - prev + 1" ||
				/^\d*[<>]/.test(m);
		});
		return bad.length === 0;
	})(),
	true);

// --- Standalone arithmetic command `((expr))` --------------------------
// Bug: `((i++))`, `((counter += n))`, `if ((x > 0))`, `for ((i=0; i<5; i++))`
// used to emit phantom inner leaves like `i++`, `counter += n`, `x > 0`,
// `i<5`. Same root cause as `$((expr))`: extractSubstitutions saw `(` at
// command-start and recursed into the body. Fix: detect `((` at command-
// start and treat opaquely. The outer `((expr))` leaf itself is then
// dropped by decomposeBash because its match form starts with `((` (a
// memory-only side-effect, no command to gate).
assertEq("decompose: ((i++)) yields no leaves",
	leafSummary(decomposeBash("((i++))")),
	[]);

assertEq("decompose: ((counter += n)) yields no leaves",
	leafSummary(decomposeBash("((counter += n))")),
	[]);

assertEq("decompose: empty arithmetic (()) yields no leaves",
	leafSummary(decomposeBash("(())")),
	[]);

assertEq("decompose: if ((x > 0)) drops arithmetic, keeps body",
	leafSummary(decomposeBash("if ((x > 0)); then echo hi; fi")),
	[{ depth: 0, match: "echo hi", display: "echo hi" }]);

assertEq("decompose: C-style for ((i=0; i<5; i++)) drops head, keeps body",
	leafSummary(decomposeBash("for ((i=0; i<5; i++)); do echo $i; done")),
	[{ depth: 0, match: "echo $i", display: "echo $i" }]);

assertEq("decompose: ((i++)) && echo done keeps the rhs only",
	leafSummary(decomposeBash("((i++)) && echo done")),
	[{ depth: 0, match: "echo done", display: "echo done" }]);

// --- `!` pipeline negation modifier --------------------------------------
// Bug: `! grep -q foo file` used to leave `!` as the matchHead, so a
// `Bash(grep:*)` rule wouldn't match. Fix: `!` is in the modifier set and
// gets stripped like `time`/`nohup`/`exec`.
assertEq("decompose: ! grep … strips ! so grep matches normally",
	leafSummary(decomposeBash("! grep -q foo file && echo nope")),
	[
		{ depth: 0, match: "grep -q foo file", display: "! grep -q foo file" },
		{ depth: 0, match: "echo nope", display: "echo nope" },
	]);

assertEq("decompose: chained ! modifiers both stripped",
	leafSummary(decomposeBash("! cmd1 || ! cmd2")),
	[
		{ depth: 0, match: "cmd1", display: "! cmd1" },
		{ depth: 0, match: "cmd2", display: "! cmd2" },
	]);

// --- Brace groups `{ cmd; cmd; }` ----------------------------------------
// Bug: `{ ls; pwd; } | head -3` used to emit the brace group as a single
// leaf with head `{`, so `ls` and `pwd` escaped per-command rule matching.
// Fix: extractSubstitutions recurses into brace-group bodies (gated on
// whitespace after `{` to distinguish from `${var}` and `{a,b,c}`).
assertEq("decompose: brace group decomposes inner commands at depth+1",
	leafSummary(decomposeBash("{ ls; pwd; } | head -3")),
	[
		{ depth: 1, match: "ls", display: "ls" },
		{ depth: 1, match: "pwd", display: "pwd" },
		{ depth: 0, match: "head -3", display: "head -3" },
	]);

assertEq("decompose: nested brace groups decompose at increasing depth",
	leafSummary(decomposeBash("{ { ls; }; pwd; }")),
	[
		{ depth: 2, match: "ls", display: "ls" },
		{ depth: 1, match: "pwd", display: "pwd" },
	]);

assertEq("decompose: brace expansion {a,b,c} is NOT a brace group",
	leafSummary(decomposeBash("echo {a,b,c}")),
	[{ depth: 0, match: "echo {a,b,c}", display: "echo {a,b,c}" }]);

assertEq("decompose: parameter expansion ${HOME} is NOT a brace group",
	leafSummary(decomposeBash('echo "${HOME}/foo"')),
	[{ depth: 0, match: 'echo "${HOME}/foo"', display: 'echo "${HOME}/foo"' }]);

assertEq("decompose: brace group with parameter expansion inside still works",
	leafSummary(decomposeBash("{ echo ${HOME}; ls; }")),
	[
		{ depth: 1, match: "echo ${HOME}", display: "echo ${HOME}" },
		{ depth: 1, match: "ls", display: "ls" },
	]);

assertEq("decompose: quoted `{` inside brace group does not break balance",
	leafSummary(decomposeBash('{ echo "{not a brace}"; ls; }')),
	[
		{ depth: 1, match: 'echo "{not a brace}"', display: 'echo "{not a brace}"' },
		{ depth: 1, match: "ls", display: "ls" },
	]);

// --- Standalone test commands `[`/`[[` are no-ops ------------------------
// `[ -f x ]` and `[[ -n $x ]]` are read-only conditionals with no side
// effects; rule-gating them is pointless. Inner substitutions still get
// extracted and matched, so deny coverage on `[[ $(rm -rf /) ]]` is kept.
assertEq("decompose: [[ … ]] is a noop, only the rhs survives",
	leafSummary(decomposeBash("[[ -f /etc/hosts ]] && echo yes")),
	[{ depth: 0, match: "echo yes", display: "echo yes" }]);

assertEq("decompose: [ … ] is a noop, only the rhs survives",
	leafSummary(decomposeBash("[ -f /etc/hosts ] && echo yes")),
	[{ depth: 0, match: "echo yes", display: "echo yes" }]);

assertEq("decompose: [[ $(rm -rf /) ]] still extracts the deny-worthy substitution",
	(() => {
		const leaves = leafSummary(decomposeBash('[[ "$(rm -rf /)" ]] && echo yes'));
		return leaves.some((l) => l.depth === 1 && l.match === "rm -rf /") &&
			leaves.some((l) => l.depth === 0 && l.match === "echo yes");
	})(),
	true);

// --- The two real-world examples from the original conversation -----------

const example1 = [
	"cd ~/Repos/moderation_pipeline",
	"for svc in moderation-skelly-service moderation-admin-service moderation-assignment-service moderation-content-service moderation-moderator-service",
	"do",
	'  echo "=== $svc ==="',
	'  cd "~/Repos/moderation_pipeline/$svc"',
	'  echo "GOWORK: $(go env GOWORK)"',
	"  go build ./... 2>&1 | tail -5",
	'  echo "build exit: $?"',
	"done",
].join("\n");

const ex1Heads = leafSummary(decomposeBash(example1)).map((l) => l.match.split(/\s+/).slice(0, 2).join(" "));
assertEq("real-world: example 1 has go env and go build leaves",
	ex1Heads.includes("go env") && ex1Heads.includes("go build"),
	true);

const example2 = [
	"cd ~/Repos/moderation_pipeline",
	"go work use ./moderation-skelly-service/framework 2>&1",
	'echo "---"',
	"cat go.work",
	'echo "---"',
	"cd moderation-skelly-service && go env GOWORK",
	'cd ../moderation-admin-service && echo "from admin: $(go env GOWORK)"',
].join("\n");

const ex2Heads = leafSummary(decomposeBash(example2)).map((l) => l.match.split(/\s+/).slice(0, 2).join(" "));
assertEq("real-world: example 2 has go work and go env leaves",
	ex2Heads.includes("go work") && ex2Heads.includes("go env"),
	true);

// --- Report ---------------------------------------------------------------

console.log(`\nbash-parse tokenizer tests: ${pass} passed, ${fail} failed.\n`);
if (failures.length > 0) {
	for (const f of failures) console.log(f);
	process.exit(1);
}
process.exit(0);
