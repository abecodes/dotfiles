/**
 * bash-parse — shared bash decomposition primitives.
 *
 * Extracted from the allow-list extension. Current consumers:
 *   - allow-list  (per-leaf rule matching)
 *
 * History note: this lives in _shared/ rather than inside allow-list/
 * because an earlier design pass intended lean-ctx to consume it too
 * (per-leaf raw-mode detection for binary-output commands). That use
 * case was dropped after we worked out lean-ctx's actual failure model:
 * compression only ever touches the FINAL stdout of the entire shell
 * command (pipes and substitutions are internal to the inner shell and
 * never reach lean-ctx's capture buffer), so per-leaf inspection doesn't
 * help — the only thing that matters is whether the rightmost command
 * of the outermost pipeline writes binary to stdout, and that's handled
 * by the manual `raw: true` parameter on the bash tool.
 *
 * The module was kept here rather than re-inlined into allow-list because:
 *   1. allow-list/index.ts is materially cleaner without 700 lines of
 *      tokenizer at its core.
 *   2. The 34-assertion test suite (bash-parse.test.mjs) runs from this
 *      location and gives a fast, isolated way to verify parser changes
 *      without booting the rest of allow-list.
 *   3. If a future extension genuinely needs bash decomposition, the
 *      primitive is sitting here ready to import — but don't add a
 *      "planned consumer" line above without an actual import landing
 *      in the same change.
 *
 * NOT loaded by pi as an extension. Pi auto-discovers
 *   ~/.pi/agent/extensions/*.ts
 *   ~/.pi/agent/extensions/*\/index.ts
 * This file is at ~/.pi/agent/extensions/_shared/bash-parse.ts and matches
 * neither pattern, so it sits as a plain module that other extensions import.
 *
 * Tokenizer caveats (intentional):
 *   - heredocs are erased by stripHeredocs() before splitSegments runs.
 *   - `#` comments are erased by stripComments() before splitSegments runs.
 *     A `#` is treated as a comment start only when it's at a token-start
 *     position (start of input, or preceded by whitespace / `;` / `&` / `|` /
 *     `(` / `)` / newline), and never inside single/double quotes, backticks,
 *     or after a backslash. This matches bash's own rule for token-position
 *     comments and leaves things like `${var#prefix}` and `echo a#b` alone.
 *   - here-strings (`<<<`) are left intact (they're a single-token value).
 *   - process substitution `<(...)` / `>(...)` is recognised and recursed into.
 *   - eval, complex case-pattern arms, and exotic redirect forms are not
 *     handled perfectly. On any tokenizer failure decomposeBash falls back to
 *     emitting the whole input as a single leaf so the caller can still match
 *     a permission rule against it.
 */

// --------------------------------------------------------------------------------------
// Public types
// --------------------------------------------------------------------------------------

export interface BashLeaf {
	/** Original cleaned segment (substitutions removed) — used in user-facing prompts. */
	display: string;
	/** Match form: leading `VAR=val` assignments and modifier words removed.
	 * This is what allow-list runs against rules, so `SUDO_USER=root sudo cmd`
	 * matches `Bash(sudo:*)` and `time go build` matches `Bash(go build:*)`. */
	match: string;
	/** 0 = top-level, >0 = inside $(...) / `...` / subshell / process substitution. */
	depth: number;
}

// --------------------------------------------------------------------------------------
// Shared shell-vocabulary tables
// --------------------------------------------------------------------------------------

/** Block keywords that act as command-position separators inside a control-flow
 * construct. `in` is intentionally NOT here — it's part of the construct head
 * (`for x in a b c`), and splitting on it would lose the head entirely. The
 * construct head as a whole is dropped via SHELL_CONSTRUCT_HEADS. */
export const SHELL_BLOCK_KEYWORDS = new Set([
	"do",
	"done",
	"then",
	"else",
	"elif",
	"fi",
	"esac",
]);

/** Heads that introduce a control-flow construct. The construct head itself is
 * not a command we want to match; its body (after `do` / `then`) is split off
 * by the keyword separator logic. */
export const SHELL_CONSTRUCT_HEADS = new Set([
	"for",
	"while",
	"until",
	"if",
	"case",
	"select",
]);

/** Pure shell builtins that are pervasive in agent-generated chains. We treat
 * them as no-ops so users don't have to keep approving `:`, `[[ … ]]` etc.
 * — the existing rule format still wins if the user explicitly denies them.
 *
 * `[` and `[[` are test commands: read-only conditional evaluation with no
 * side effects. Any command substitution inside them (e.g. `[[ $(cmd) ]]`)
 * is still extracted by extractSubstitutions and matched against rules at
 * depth+1, so making the outer test a no-op doesn't lose deny coverage. */
export const SHELL_BUILTIN_NOOPS = new Set([
	":",
	"true",
	"false",
	"shift",
	"break",
	"continue",
	"return",
	"exit",
	"unset",
	"export",
	"declare",
	"local",
	"readonly",
	"set",
	"trap",
	"[",
	"[[",
]);

/** Tools whose first argument is conventionally a subcommand. Callers that want
 * to suggest a default rule pattern use a two-token form (`Bash(go build:*)`)
 * for these and a single-token form (`Bash(cd:*)`) for everything else. */
export const KNOWN_MULTI_SUBCOMMAND_TOOLS = new Set([
	"go",
	"git",
	"npm",
	"npx",
	"yarn",
	"pnpm",
	"bun",
	"docker",
	"docker-compose",
	"kubectl",
	"helm",
	"terraform",
	"tofu",
	"ansible",
	"brew",
	"apt",
	"apt-get",
	"dpkg",
	"yum",
	"dnf",
	"pacman",
	"snap",
	"flatpak",
	"gcloud",
	"aws",
	"az",
	"cargo",
	"rustup",
	"pip",
	"pip3",
	"pipx",
	"poetry",
	"uv",
	"mvn",
	"gradle",
	"dotnet",
	"ng",
	"vue",
	"nest",
	"rails",
	"bundle",
	"gem",
	"composer",
	"php",
	"artisan",
	"systemctl",
	"service",
	"journalctl",
	"git-lfs",
	"gh",
	"glab",
	"hub",
	"jj",
	"hg",
	"svn",
	"make",
	"just",
	"task",
]);

// --------------------------------------------------------------------------------------
// Trivial tokenisers
// --------------------------------------------------------------------------------------

export function tokenize(cmd: string): string[] {
	return cmd.trim().split(/\s+/).filter(Boolean);
}

/** Return the first whitespace-/operator-delimited token of `s`, empty if none. */
export function firstToken(s: string): string {
	const m = s.trim().match(/^[^\s;|&()]+/);
	return m ? m[0]! : "";
}

// --------------------------------------------------------------------------------------
// Bracket / quote walker
// --------------------------------------------------------------------------------------

/** Find the matching close bracket for an `open` at index `start`, respecting
 * single/double quotes, backslash escapes, and `$(..)` nesting inside double
 * quotes. Returns the index of the matching close, or -1 if not found. */
export function matchBalanced(
	text: string,
	start: number,
	open: string,
	close: string,
): number {
	let depth = 0;
	let i = start;
	const n = text.length;
	while (i < n) {
		const ch = text[i]!;
		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			if (end < 0) return -1;
			i = end + 1;
			continue;
		}
		if (ch === '"') {
			let j = i + 1;
			while (j < n) {
				const c = text[j]!;
				if (c === "\\" && j + 1 < n) {
					j += 2;
					continue;
				}
				if (c === "$" && text[j + 1] === "(") {
					const inner = matchBalanced(text, j + 1, "(", ")");
					if (inner > 0) {
						j = inner + 1;
						continue;
					}
				}
				if (c === '"') break;
				j++;
			}
			i = j + 1;
			continue;
		}
		if (ch === "\\" && i + 1 < n) {
			i += 2;
			continue;
		}
		if (ch === open) depth++;
		else if (ch === close) {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	return -1;
}

// --------------------------------------------------------------------------------------
// Heredoc handling
// --------------------------------------------------------------------------------------

/**
 * Erase heredoc bodies so the surrounding text can be tokenised as commands.
 *
 * Recognises `<<DELIM`, `<< DELIM`, `<<-DELIM` (tab-stripped close), and
 * quoted forms like `<<'EOF'` / `<<"EOF"`. The preamble (everything up to and
 * including the delimiter word) is preserved so the host command still gets
 * matched against rules. Here-strings (`<<<`) and unterminated heredocs are
 * left intact.
 */
export function stripHeredocs(text: string): string {
	let out = "";
	let i = 0;
	const n = text.length;
	while (i < n) {
		const ch = text[i]!;

		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			if (end < 0) {
				out += text.slice(i);
				break;
			}
			out += text.slice(i, end + 1);
			i = end + 1;
			continue;
		}
		if (ch === '"') {
			let j = i + 1;
			while (j < n) {
				const c = text[j]!;
				if (c === "\\" && j + 1 < n) {
					j += 2;
					continue;
				}
				if (c === '"') break;
				j++;
			}
			out += text.slice(i, Math.min(j + 1, n));
			i = j + 1;
			continue;
		}
		if (ch === "\\" && i + 1 < n) {
			out += text.slice(i, i + 2);
			i += 2;
			continue;
		}

		// Detect << / <<- ; bail out for <<< (here-string).
		if (ch === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
			let p = i + 2;
			let stripTabs = false;
			if (text[p] === "-") {
				stripTabs = true;
				p++;
			}
			while (p < n && (text[p] === " " || text[p] === "\t")) p++;
			let quoteChar: string | null = null;
			if (text[p] === "'" || text[p] === '"') {
				quoteChar = text[p]!;
				p++;
			}
			const delimStart = p;
			while (p < n && /[\w-]/.test(text[p]!)) p++;
			const delim = text.slice(delimStart, p);
			let preambleEnd = p;
			if (quoteChar) {
				if (text[p] === quoteChar) {
					p++;
					preambleEnd = p;
				} else {
					// Mismatched quote → not a real heredoc, emit `<<` and move on.
					out += text.slice(i, i + 2);
					i += 2;
					continue;
				}
			}
			if (!delim) {
				out += text.slice(i, i + 2);
				i += 2;
				continue;
			}

			// Find newline ending the host command line.
			const nlIdx = text.indexOf("\n", preambleEnd);
			if (nlIdx < 0) {
				// Heredoc with no body content (or input ends before newline).
				out += text.slice(i);
				i = n;
				break;
			}

			// Walk forward line-by-line until we find the closing delimiter.
			let lineStart = nlIdx + 1;
			let bodyEnd = -1;
			while (lineStart < n) {
				let lineEnd = text.indexOf("\n", lineStart);
				if (lineEnd < 0) lineEnd = n;
				let line = text.slice(lineStart, lineEnd);
				if (stripTabs) line = line.replace(/^\t+/, "");
				if (line === delim) {
					bodyEnd = lineEnd;
					break;
				}
				if (lineEnd >= n) break;
				lineStart = lineEnd + 1;
			}

			// Emit preamble (up through the delim word). Preserve the trailing
			// newline so the next command on a fresh line still parses.
			out += text.slice(i, preambleEnd);
			out += "\n";
			if (bodyEnd > 0) {
				i = Math.min(bodyEnd + 1, n);
			} else {
				// Unterminated heredoc → drop the rest entirely.
				i = n;
			}
			continue;
		}

		out += ch;
		i++;
	}
	return out;
}

// --------------------------------------------------------------------------------------
// Comment stripping
// --------------------------------------------------------------------------------------

/**
 * Erase `# comment` runs (up to but not including the next newline) so the
 * surrounding text can be tokenised as commands.
 *
 * `#` only starts a comment when it appears at a token-start position — i.e.
 * the previous character is start-of-input, whitespace, a newline, or one of
 * the unquoted control operators `; & | ( )`. This is bash's own rule and
 * matches what users mean when they paste a script with leading-`#` comment
 * lines into a single shell call. Inside single quotes, double quotes, or
 * backticks `#` is left alone, so things like `echo "#hi"` and `${var#pre}`
 * stay intact.
 *
 * Run AFTER stripHeredocs so we don't accidentally treat heredoc body lines
 * that begin with `#` as comments. The closing newline is preserved so
 * splitSegments still sees the line break as a command separator.
 */
export function stripComments(text: string): string {
	let out = "";
	let i = 0;
	const n = text.length;
	// Treat start-of-input as a token-start position (same as just after a
	// newline) so a leading `# foo` line is recognised as a comment.
	let prev = "\n";
	while (i < n) {
		const ch = text[i]!;

		// single-quoted: literal until the next '
		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			if (end < 0) {
				out += text.slice(i);
				break;
			}
			out += text.slice(i, end + 1);
			prev = "'";
			i = end + 1;
			continue;
		}

		// double-quoted: copy through verbatim. We deliberately do NOT recurse
		// into `$(..)` here — that's handled later by extractSubstitutions, and
		// each recursion in decomposeBash re-runs stripComments on the body.
		if (ch === '"') {
			let j = i + 1;
			while (j < n) {
				const c = text[j]!;
				if (c === "\\" && j + 1 < n) {
					j += 2;
					continue;
				}
				if (c === '"') break;
				j++;
			}
			const end = j < n ? j : n - 1;
			out += text.slice(i, end + 1);
			prev = '"';
			i = end + 1;
			continue;
		}

		// backtick: opaque (extractSubstitutions handles the body separately).
		if (ch === "`") {
			const end = text.indexOf("`", i + 1);
			if (end < 0) {
				out += text.slice(i);
				break;
			}
			out += text.slice(i, end + 1);
			prev = "`";
			i = end + 1;
			continue;
		}

		// backslash escape: copy the escape and the escaped char unchanged.
		if (ch === "\\" && i + 1 < n) {
			out += text.slice(i, i + 2);
			prev = text[i + 1]!;
			i += 2;
			continue;
		}

		// Comment starts only at token-start position.
		if (ch === "#" && /[\s;|&()]/.test(prev)) {
			const nl = text.indexOf("\n", i);
			if (nl < 0) {
				// Comment runs to end of input — drop the rest entirely.
				i = n;
				break;
			}
			// Preserve the terminating newline so splitSegments still sees the
			// command boundary it provides.
			i = nl;
			continue;
		}

		out += ch;
		prev = ch;
		i++;
	}
	return out;
}

// --------------------------------------------------------------------------------------
// Top-level segment splitter
// --------------------------------------------------------------------------------------

/**
 * Split shell text on top-level operators (`;`, `&&`, `||`, `|`, `&`, newline)
 * and on the bare block keywords (`do`/`done`/`then`/`else`/`elif`/`fi`/`esac`),
 * while respecting quotes, escapes, and bracket nesting.
 */
export function splitSegments(text: string): string[] {
	const out: string[] = [];
	let buf = "";
	let i = 0;
	const n = text.length;
	const push = () => {
		if (buf.trim()) out.push(buf);
		buf = "";
	};

	while (i < n) {
		const ch = text[i]!;

		// single-quoted: literal until the next '
		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			if (end < 0) {
				buf += text.slice(i);
				break;
			}
			buf += text.slice(i, end + 1);
			i = end + 1;
			continue;
		}

		// double-quoted: respect escapes, $(..) nesting
		if (ch === '"') {
			let j = i + 1;
			while (j < n) {
				const c = text[j]!;
				if (c === "\\" && j + 1 < n) {
					j += 2;
					continue;
				}
				if (c === "$" && text[j + 1] === "(") {
					const close = matchBalanced(text, j + 1, "(", ")");
					if (close > 0) {
						j = close + 1;
						continue;
					}
				}
				if (c === '"') break;
				j++;
			}
			const end = j < n ? j : n - 1;
			buf += text.slice(i, end + 1);
			i = end + 1;
			continue;
		}

		if (ch === "\\" && i + 1 < n) {
			buf += text.slice(i, i + 2);
			i += 2;
			continue;
		}

		// $(...) - keep as opaque; extractSubstitutions handles recursion later.
		if (ch === "$" && text[i + 1] === "(") {
			const close = matchBalanced(text, i + 1, "(", ")");
			if (close > 0) {
				buf += text.slice(i, close + 1);
				i = close + 1;
				continue;
			}
		}

		// `...` backtick substitution
		if (ch === "`") {
			const end = text.indexOf("`", i + 1);
			if (end < 0) {
				buf += text.slice(i);
				break;
			}
			buf += text.slice(i, end + 1);
			i = end + 1;
			continue;
		}

		// Process substitution: <(...) and >(...). The ( must immediately follow
		// the redirect char with no space; that's the only way bash accepts it.
		if ((ch === "<" || ch === ">") && text[i + 1] === "(") {
			const close = matchBalanced(text, i + 1, "(", ")");
			if (close > 0) {
				buf += text.slice(i, close + 1);
				i = close + 1;
				continue;
			}
		}

		// (...) subshell — only treat as a balanced group at a position where a
		// command can start (after whitespace or an operator); otherwise it's
		// likely a glob/grouping inside an argument and we let it fall through.
		if (ch === "(") {
			const prev = i === 0 ? " " : text[i - 1]!;
			if (/[\s;&|]/.test(prev)) {
				const close = matchBalanced(text, i, "(", ")");
				if (close > 0) {
					buf += text.slice(i, close + 1);
					i = close + 1;
					continue;
				}
			}
		}

		// {...} brace group
		if (ch === "{") {
			const prev = i === 0 ? " " : text[i - 1]!;
			if (/[\s;&|]/.test(prev)) {
				const close = matchBalanced(text, i, "{", "}");
				if (close > 0) {
					buf += text.slice(i, close + 1);
					i = close + 1;
					continue;
				}
			}
		}

		// operators
		if (ch === ";" || ch === "\n") {
			push();
			i++;
			continue;
		}
		if (ch === "&" && text[i + 1] === "&") {
			push();
			i += 2;
			continue;
		}
		if (ch === "|" && text[i + 1] === "|") {
			push();
			i += 2;
			continue;
		}
		if (ch === "|") {
			push();
			i++;
			continue;
		}
		if (ch === "&") {
			// `&` is the background operator UNLESS it's part of a fd redirect like
			// `2>&1`, `>&2`, `<&-`. In those cases the previous char is `>` or `<`
			// and the `&` is just glue.
			const prevCh = i === 0 ? "" : text[i - 1]!;
			if (prevCh === ">" || prevCh === "<") {
				buf += ch;
				i++;
				continue;
			}
			push();
			i++;
			continue;
		}

		// Keyword separators (`do`, `done`, `then`, `else`, `elif`, `fi`, `esac`)
		// only act as separators when they appear in command-start position — i.e.
		// the buffer so far is empty/whitespace-only. Otherwise `echo done` would
		// drop the `done` argument from the leaf.
		if (/[A-Za-z]/.test(ch) && buf.trim() === "") {
			const prev = i === 0 ? " " : text[i - 1]!;
			if (!/\w/.test(prev)) {
				let j = i;
				while (j < n && /\w/.test(text[j]!)) j++;
				const word = text.slice(i, j);
				if (SHELL_BLOCK_KEYWORDS.has(word)) {
					const next = j < n ? text[j]! : " ";
					if (!/\w/.test(next)) {
						push();
						i = j;
						continue;
					}
				}
			}
		}

		buf += ch;
		i++;
	}
	push();
	return out;
}

// --------------------------------------------------------------------------------------
// Substitution extraction / erasure
// --------------------------------------------------------------------------------------

/** Extract every $(...) / `...` / (...) / <(...) / >(...) substitution body in `text`. */
export function extractSubstitutions(text: string): string[] {
	const out: string[] = [];
	let i = 0;
	const n = text.length;
	while (i < n) {
		const ch = text[i]!;
		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			i = end < 0 ? n : end + 1;
			continue;
		}
		// Double-quoted: $(..) and backticks still expand inside, but bare
		// `(...)` does NOT — bash treats it as literal text. We mirror the
		// matching arm in stripSubstitutions; without this, something like
		// `echo "foo (bar) baz"` would be mis-decomposed and `bar` would be
		// emitted as a depth-1 subshell leaf.
		if (ch === '"') {
			let j = i + 1;
			while (j < n && text[j] !== '"') {
				const c = text[j]!;
				if (c === "\\" && j + 1 < n) {
					j += 2;
					continue;
				}
				if (c === "$" && text[j + 1] === "(") {
					// Arithmetic expansion `$((expr))` is opaque — not a command
					// substitution. Skip without recursing so we don't emit a phantom
					// leaf for the expression body.
					if (text[j + 2] === "(") {
						const close = matchBalanced(text, j + 1, "(", ")");
						if (close > 0) {
							j = close + 1;
							continue;
						}
					}
					const close = matchBalanced(text, j + 1, "(", ")");
					if (close > 0) {
						out.push(text.slice(j + 2, close));
						j = close + 1;
						continue;
					}
				}
				if (c === "`") {
					const end = text.indexOf("`", j + 1);
					if (end > 0) {
						out.push(text.slice(j + 1, end));
						j = end + 1;
						continue;
					}
				}
				j++;
			}
			i = j < n ? j + 1 : n;
			continue;
		}
		if (ch === "\\" && i + 1 < n) {
			i += 2;
			continue;
		}
		if (ch === "$" && text[i + 1] === "(") {
			// Arithmetic expansion `$((expr))` is opaque — not a command
			// substitution. Skip without recursing.
			if (text[i + 2] === "(") {
				const close = matchBalanced(text, i + 1, "(", ")");
				if (close > 0) {
					i = close + 1;
					continue;
				}
			}
			const close = matchBalanced(text, i + 1, "(", ")");
			if (close > 0) {
				out.push(text.slice(i + 2, close));
				i = close + 1;
				continue;
			}
		}
		if (ch === "`") {
			const end = text.indexOf("`", i + 1);
			if (end > 0) {
				out.push(text.slice(i + 1, end));
				i = end + 1;
				continue;
			}
		}
		// Process substitution: <(...) and >(...).
		if ((ch === "<" || ch === ">") && text[i + 1] === "(") {
			const close = matchBalanced(text, i + 1, "(", ")");
			if (close > 0) {
				out.push(text.slice(i + 2, close));
				i = close + 1;
				continue;
			}
		}
		if (ch === "(") {
			const prev = i === 0 ? " " : text[i - 1]!;
			if (/[\s;&|]/.test(prev)) {
				// Arithmetic command `((expr))` — opaque, not a subshell. Skip
				// without recursing so we don't emit a phantom inner leaf for the
				// expression body (e.g. `i++` in `for ((i=0; i<5; i++))`).
				if (text[i + 1] === "(") {
					const close = matchBalanced(text, i, "(", ")");
					if (close > 0) {
						i = close + 1;
						continue;
					}
				}
				const close = matchBalanced(text, i, "(", ")");
				if (close > 0) {
					out.push(text.slice(i + 1, close));
					i = close + 1;
					continue;
				}
			}
		}
		// Brace group `{ cmd; cmd; }` — runs in the current shell, but for rule
		// matching we want to see each inner command as its own leaf. Distinct
		// from parameter expansion `${var}` (preceded by `$`) and brace
		// expansion `{a,b,c}` (no whitespace after `{`); the prev-char and
		// next-char checks gate on bash's actual brace-group syntax.
		if (ch === "{") {
			const prev = i === 0 ? " " : text[i - 1]!;
			const next = text[i + 1] || "";
			if (/[\s;&|]/.test(prev) && /\s/.test(next)) {
				const close = matchBalanced(text, i, "{", "}");
				if (close > 0) {
					out.push(text.slice(i + 1, close));
					i = close + 1;
					continue;
				}
			}
		}
		i++;
	}
	return out;
}

/** Erase every $(...) / `...` / (...) / { …; } block from `text`, keeping the surrounding text intact. */
export function stripSubstitutions(text: string): string {
	let out = "";
	let i = 0;
	const n = text.length;
	while (i < n) {
		const ch = text[i]!;
		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			if (end < 0) {
				out += text.slice(i);
				break;
			}
			out += text.slice(i, end + 1);
			i = end + 1;
			continue;
		}
		if (ch === '"') {
			let j = i + 1;
			out += '"';
			while (j < n && text[j] !== '"') {
				const c = text[j]!;
				if (c === "\\" && j + 1 < n) {
					out += text.slice(j, j + 2);
					j += 2;
					continue;
				}
				if (c === "$" && text[j + 1] === "(") {
					// Arithmetic expansion `$((expr))` — keep verbatim so the
					// surrounding leaf still shows the expression to the user.
					if (text[j + 2] === "(") {
						const close = matchBalanced(text, j + 1, "(", ")");
						if (close > 0) {
							out += text.slice(j, close + 1);
							j = close + 1;
							continue;
						}
					}
					const close = matchBalanced(text, j + 1, "(", ")");
					if (close > 0) {
						j = close + 1;
						continue;
					}
				}
				if (c === "`") {
					const end = text.indexOf("`", j + 1);
					if (end > 0) {
						j = end + 1;
						continue;
					}
				}
				out += c;
				j++;
			}
			if (j < n) {
				out += '"';
				j++;
			}
			i = j;
			continue;
		}
		if (ch === "\\" && i + 1 < n) {
			out += text.slice(i, i + 2);
			i += 2;
			continue;
		}
		if (ch === "$" && text[i + 1] === "(") {
			// Arithmetic expansion `$((expr))` — keep verbatim, do NOT erase.
			if (text[i + 2] === "(") {
				const close = matchBalanced(text, i + 1, "(", ")");
				if (close > 0) {
					out += text.slice(i, close + 1);
					i = close + 1;
					continue;
				}
			}
			const close = matchBalanced(text, i + 1, "(", ")");
			if (close > 0) {
				i = close + 1;
				continue;
			}
		}
		if (ch === "`") {
			const end = text.indexOf("`", i + 1);
			if (end > 0) {
				i = end + 1;
				continue;
			}
		}
		// Process substitution: <(...) and >(...). Erase entirely — we already
		// recursed into the body, and a trailing redirect char like `<` or `>` on
		// the surviving leaf would confuse rule matching.
		if ((ch === "<" || ch === ">") && text[i + 1] === "(") {
			const close = matchBalanced(text, i + 1, "(", ")");
			if (close > 0) {
				i = close + 1;
				continue;
			}
		}
		if (ch === "(") {
			const prev = i === 0 ? " " : text[i - 1]!;
			if (/[\s;&|]/.test(prev)) {
				// Arithmetic command `((expr))` — keep verbatim so the leaf still
				// shows the expression to the user. (decomposeBash will then
				// recognise the `((` head as a noop and drop the leaf entirely.)
				if (text[i + 1] === "(") {
					const close = matchBalanced(text, i, "(", ")");
					if (close > 0) {
						out += text.slice(i, close + 1);
						i = close + 1;
						continue;
					}
				}
				const close = matchBalanced(text, i, "(", ")");
				if (close > 0) {
					i = close + 1;
					continue;
				}
			}
		}
		// Brace group `{ cmd; cmd; }` — erase entirely. extractSubstitutions has
		// already recursed into the body so each inner command is at depth+1; a
		// trailing `{ … }` literal on the surviving outer leaf would only confuse
		// rule matching. Same prev/next gating as extractSubstitutions to avoid
		// touching `${var}` and `{a,b,c}`.
		if (ch === "{") {
			const prev = i === 0 ? " " : text[i - 1]!;
			const next = text[i + 1] || "";
			if (/[\s;&|]/.test(prev) && /\s/.test(next)) {
				const close = matchBalanced(text, i, "{", "}");
				if (close > 0) {
					i = close + 1;
					continue;
				}
			}
		}
		out += ch;
		i++;
	}
	return out;
}

// --------------------------------------------------------------------------------------
// Cleaners used by decomposeBash
// --------------------------------------------------------------------------------------

/** Strip leading `VAR=val` assignments and modifier words (`time`, `nohup`, `sudo -E`, etc.). */
export function stripLeadingAssignmentsAndModifiers(s: string): string {
	let rest = s.trim();
	// `!` is bash's pipeline-negation modifier (`! grep -q foo` succeeds when
	// grep doesn't match). Strip it so the underlying command still matches
	// its rule pattern.
	const MODIFIERS = new Set(["time", "nohup", "exec", "command", "builtin", "!"]);
	let changed = true;
	while (changed) {
		changed = false;
		const assign = rest.match(/^[A-Za-z_][\w]*=\S*\s+/);
		if (assign) {
			rest = rest.slice(assign[0].length);
			changed = true;
			continue;
		}
		const head = firstToken(rest);
		if (MODIFIERS.has(head)) {
			rest = rest.slice(head.length).trimStart();
			changed = true;
		}
	}
	return rest;
}

export function isPureAssignments(s: string): boolean {
	const trimmed = s.trim();
	if (!trimmed) return true;
	return /^([A-Za-z_][\w]*=\S*\s*)+$/.test(trimmed);
}

// --------------------------------------------------------------------------------------
// decomposeBash — top-level entry point
// --------------------------------------------------------------------------------------

/**
 * Decompose a single Bash command into a flat list of "leaf" simple commands.
 *
 * A bash call often contains a chain joined by `;`, `&&`, `||`, `|`, `&` or
 * newlines, plus control flow and command substitutions. decomposeBash walks
 * the text and returns each leaf as a {display, match, depth} record:
 *   - display: the cleaned segment shown to the user (substitutions removed).
 *   - match:   leading assignments and modifier words (time/nohup/etc.) stripped,
 *              suitable for matching against a permission rule like `Bash(go build:*)`.
 *   - depth:   0 at top level, >0 inside $(...) / `...` / (..) / <(..)
 *
 * Tokenizer caveats apply (see top-of-file comment). On any decomposition
 * failure the call falls back to emitting the whole input as one leaf.
 */
export function decomposeBash(input: string): BashLeaf[] {
	const preprocessed = stripHeredocs(input.replace(/\r/g, ""));
	const out: BashLeaf[] = [];
	walk(preprocessed, 0);
	return out;

	function walk(text: string, depth: number): void {
		// Strip `#` comments at every depth so substitution bodies extracted
		// later (e.g. `$(ls #foo)`) get the same treatment as the top level.
		// stripComments is quote-aware and idempotent, so re-running it on the
		// already-cleaned top-level text is safe.
		let cleanedInput: string;
		try {
			cleanedInput = stripComments(text);
		} catch {
			cleanedInput = text;
		}
		let segments: string[];
		try {
			segments = splitSegments(cleanedInput);
		} catch {
			// Tokenizer gave up — record the whole text as one leaf.
			const trimmed = text.trim();
			out.push({ display: trimmed, match: trimmed, depth });
			return;
		}
		for (const seg of segments) {
			const trimmed = seg.trim();
			if (!trimmed) continue;
			if (SHELL_BLOCK_KEYWORDS.has(trimmed)) continue;

			// Recurse into substitutions found anywhere in the segment.
			for (const inner of extractSubstitutions(trimmed)) {
				if (inner.trim()) walk(inner, depth + 1);
			}

			const head = firstToken(trimmed);
			if (SHELL_CONSTRUCT_HEADS.has(head)) {
				// Skip the construct head itself (e.g. `for svc in a b c`). Its
				// body is reached via the `do`/`then` keyword splits.
				continue;
			}

			const cleaned = stripSubstitutions(trimmed).trim();
			if (!cleaned) continue;

			// Skip lines that are only assignments after stripping substitutions
			// (e.g. `x=$(cmd)` becomes `x=` once $(cmd) has been recursed into).
			if (isPureAssignments(cleaned)) continue;

			const matchForm = stripLeadingAssignmentsAndModifiers(cleaned);
			const matchHead = firstToken(matchForm);
			if (matchHead && SHELL_BUILTIN_NOOPS.has(matchHead)) continue;
			// Pure fd-redirection leaves (e.g. `exec 3</tmp/x`, `exec 3<&-`,
			// `exec >log 2>&1`) survive as something like `3</tmp/x` after
			// `exec` is stripped as a modifier. They aren't commands — just
			// redirections applied to the current shell — so skip them rather
			// than asking the user to allow a nonsense token.
			if (matchHead && /^\d*[<>]/.test(matchHead)) continue;
			// Arithmetic command `((expr))` — firstToken is empty (the `(`
			// regex-class excludes `(`), so the head-based noop check above
			// can't catch it. Memory-only side effects (variable arithmetic);
			// skip rather than asking the user to allow a synthetic head.
			if (matchForm.startsWith("((")) continue;

			out.push({ display: cleaned, match: matchForm || cleaned, depth });
		}
	}
}
