/**
 * self-healing-edit
 * =================
 *
 * A drop-in replacement for the built-in `edit` tool that turns *blind*
 * match failures into either (a) a successful edit recovered by normalized
 * matching, or (b) a self-describing failure that carries the current bytes of
 * the target region with line numbers — so the retry needs no separate `read`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The built-in `edit` is a string-replace: `oldText` must match the file
 * byte-for-byte. It already tolerates smart quotes, unicode dashes, and
 * trailing whitespace, but it still fails hard on:
 *
 *   1. Literal `\n` corruption — a file that contains the two characters
 *      backslash+`n` instead of real newlines (a classic artifact of writing
 *      a big HTML/JSON blob with escaped newlines). The model sends real
 *      newlines in `oldText`; nothing matches; every retry has to hand-escape
 *      `\\n`, which spirals.
 *   2. Indentation drift — the remembered `oldText` is right except the
 *      leading whitespace differs from disk.
 *   3. Staleness — `oldText` was correct earlier but the file moved on, so the
 *      model burns a full re-read just to reconstruct a new `oldText`.
 *   4. Ambiguity — `oldText` occurs more than once; the bare "not found" /
 *      "appears N times" gives no locations to disambiguate with.
 *
 * The shared root cause is that the failure is *opaque*. The single biggest
 * win is not "more forgiving matching" — it's making every failure
 * **self-describing**.
 *
 * DESIGN
 * ------
 * This extension WRAPS the built-in tool instead of reimplementing it:
 *
 *   - Happy path: delegate straight to `createEditToolDefinition(...).execute`.
 *     Identical write logic, identical `EditToolDetails { diff, patch,
 *     firstChangedLine }`, identical TUI rendering (we inherit the built-in's
 *     renderCall/renderResult/renderShell by spreading the definition).
 *   - Only when the built-in throws do we enter recovery.
 *
 * Recovery runs a resolution pipeline per edit, stopping at the first stage
 * that yields exactly ONE match:
 *
 *   Stage 0 — exact substring on freshly-read content. Catches the
 *             "file changed and now matches" staleness case for free.
 *   Stage A — escape/EOL-normalized. Treats literal `\n`/`\t`/`\r` and CRLF as
 *             equivalent to real newline/tab. Fixes the corruption case AND
 *             CRLF mismatches. Uses a char→original index map so we can still
 *             recover the EXACT on-disk bytes of the matched region.
 *   Stage B — line-anchored. Compares lines with leading/trailing whitespace
 *             stripped. Fixes indentation drift.
 *
 * When every edit resolves to a UNIQUE, NON-OVERLAPPING region we rewrite each
 * `oldText` to the exact current bytes of that region and re-invoke the
 * built-in. So the actual mutation + diff/patch generation is always done by
 * the real tool — we never silently hand-roll a write. The result content gets
 * a one-line note so the recovery is visible, and the real diff is shown.
 *
 * SAFETY
 * ------
 *   - Auto-apply ONLY on a unique match. A stage that finds >1 match is
 *     reported as ambiguous; we never guess.
 *   - Near-miss (zero matches) NEVER edits. It only reports the closest region.
 *   - We do not wrap the recovery read in `withFileMutationQueue`; the built-in
 *     acquires that lock itself for the write, and re-entering it here would
 *     deadlock on the same path.
 *
 * SCOPE
 * -----
 * This file implements the "self-healing matcher + rich failures" tier and
 * keeps the built-in's exact parameter schema (`{ path, edits[] }`), so it is a
 * pure reliability upgrade with no new API to learn. See the big
 * "HOW TO EXTEND" block at the bottom for concrete code to add line-range and
 * symbol-scoped addressing modes on top of this.
 *
 * Placement: ~/.pi/agent/extensions/self-healing-edit.ts  (hot-reload: /reload)
 */

import {
  createEditToolDefinition,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Max bytes of any single `oldText` echoed back in a failure message. */
const MAX_OLDTEXT_ECHO = 1200;
/** Max lines of a near-miss region echoed back in a failure message. */
const MAX_REGION_LINES = 40;
/** Hard cap on the whole error string handed to the model. */
const MAX_ERROR_BYTES = 12_000;

// ---------------------------------------------------------------------------
// Pure matching helpers (no IO)
// ---------------------------------------------------------------------------

type Edit = { oldText: string; newText: string };

/** Normalize CRLF/CR to LF. Mirrors the built-in's pre-match normalization. */
function toLF(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Escape/EOL-normalize `s`, returning the normalized string plus per-char index
 * maps back into the ORIGINAL string. `starts[k]`/`ends[k]` are the original
 * [start, end) span that produced normalized char `k`. This lets us locate a
 * region in normalized space and then slice the verbatim original bytes.
 *
 * Rules:
 *   - real CRLF / CR            → "\n"
 *   - literal backslash + n|r   → "\n"   (the corruption case)
 *   - literal backslash + t     → "\t"
 *   - everything else           → itself
 */
function normalizeEscapesWithMap(s: string): {
  norm: string;
  starts: number[];
  ends: number[];
} {
  const norm: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === "\r") {
      const len = s[i + 1] === "\n" ? 2 : 1;
      norm.push("\n");
      starts.push(i);
      ends.push(i + len);
      i += len;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      const d = s[i + 1];
      if (d === "n" || d === "r") {
        norm.push("\n");
        starts.push(i);
        ends.push(i + 2);
        i += 2;
        continue;
      }
      if (d === "t") {
        norm.push("\t");
        starts.push(i);
        ends.push(i + 2);
        i += 2;
        continue;
      }
    }
    norm.push(c);
    starts.push(i);
    ends.push(i + 1);
    i += 1;
  }
  return { norm: norm.join(""), starts, ends };
}

/** All non-overlapping start indices of `needle` in `hay`. */
function findAll(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + needle.length;
  }
  return out;
}

/** Split into lines, tracking the [start, contentEnd) byte span of each line. */
function indexLines(s: string): {
  lines: string[];
  starts: number[];
  ends: number[];
} {
  const lines: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || s[i] === "\n") {
      lines.push(s.slice(start, i));
      starts.push(start);
      ends.push(i); // exclusive, excludes the newline itself
      start = i + 1;
    }
  }
  return { lines, starts, ends };
}

type Resolution =
  | { kind: "unique"; oldText: string; start: number; end: number; line: number; via: string }
  | { kind: "ambiguous"; via: string; lines: number[] }
  | { kind: "none" };

/**
 * Resolve a single `oldText` against `haystack` (already LF-normalized — the
 * same space the built-in matches in). Returns the EXACT haystack bytes of the
 * matched region so the caller can hand them back to the built-in verbatim.
 */
function resolveEdit(haystack: string, rawOldText: string): Resolution {
  const oldLF = toLF(rawOldText);

  // Stage 0: exact.
  {
    const hits = findAll(haystack, oldLF);
    if (hits.length === 1) {
      const start = hits[0];
      const end = start + oldLF.length;
      return { kind: "unique", oldText: haystack.slice(start, end), start, end, line: lineOf(haystack, start), via: "exact" };
    }
    if (hits.length > 1) {
      return { kind: "ambiguous", via: "exact", lines: hits.map((h) => lineOf(haystack, h)) };
    }
  }

  // Stage A: escape/EOL-normalized, with index map back to original bytes.
  {
    const H = normalizeEscapesWithMap(haystack);
    const needle = normalizeEscapesWithMap(oldLF).norm;
    const hits = findAll(H.norm, needle);
    if (hits.length === 1 && needle.length > 0) {
      const j = hits[0];
      const start = H.starts[j];
      const end = H.ends[j + needle.length - 1];
      return { kind: "unique", oldText: haystack.slice(start, end), start, end, line: lineOf(haystack, start), via: "escape-normalized" };
    }
    if (hits.length > 1) {
      return { kind: "ambiguous", via: "escape-normalized", lines: hits.map((j) => lineOf(haystack, H.starts[j])) };
    }
  }

  // Stage B: line-anchored (leading/trailing whitespace ignored per line).
  {
    const hay = indexLines(haystack);
    const hayTrim = hay.lines.map((l) => l.trim());
    let needleLines = normalizeEscapesWithMap(oldLF).norm.split("\n").map((l) => l.trim());
    // Drop leading/trailing blank lines from the needle block.
    while (needleLines.length && needleLines[0] === "") needleLines.shift();
    while (needleLines.length && needleLines[needleLines.length - 1] === "") needleLines.pop();
    const m = needleLines.length;
    if (m > 0) {
      const matches: number[] = [];
      for (let i = 0; i + m <= hayTrim.length; i++) {
        let ok = true;
        for (let k = 0; k < m; k++) {
          if (hayTrim[i + k] !== needleLines[k]) {
            ok = false;
            break;
          }
        }
        if (ok) matches.push(i);
      }
      if (matches.length === 1) {
        const i = matches[0];
        const start = hay.starts[i];
        const end = hay.ends[i + m - 1];
        return { kind: "unique", oldText: haystack.slice(start, end), start, end, line: i + 1, via: "line-anchored" };
      }
      if (matches.length > 1) {
        return { kind: "ambiguous", via: "line-anchored", lines: matches.map((i) => i + 1) };
      }
    }
  }

  return { kind: "none" };
}

/** 1-based line number of byte offset `idx` in `s`. */
function lineOf(s: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < s.length; i++) {
    if (s[i] === "\n") line++;
  }
  return line;
}

/**
 * Best near-miss window for an unresolved needle: slide a window the size of
 * the needle's line count over the haystack and score by position-wise
 * trimmed-line equality. Returns the 0-based start line and the window size.
 */
function bestNearMiss(haystack: string, rawOldText: string): { start: number; size: number } | null {
  const hay = indexLines(haystack);
  const hayTrim = hay.lines.map((l) => l.trim());
  const needle = normalizeEscapesWithMap(toLF(rawOldText)).norm.split("\n").map((l) => l.trim());
  const m = Math.max(1, Math.min(needle.length, hayTrim.length));
  if (hayTrim.length === 0) return null;
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i + m <= hayTrim.length; i++) {
    let score = 0;
    for (let k = 0; k < m; k++) {
      if (needle[k] !== undefined && hayTrim[i + k] === needle[k]) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return null;
  return { start: best, size: m };
}

// ---------------------------------------------------------------------------
// Failure formatting
// ---------------------------------------------------------------------------

function echoOldText(oldText: string): string {
  const t = truncateHead(oldText, { maxLines: 30, maxBytes: MAX_OLDTEXT_ECHO });
  return t.content + (t.truncated ? "\n… (oldText truncated)" : "");
}

function numberedRegion(haystack: string, startLine0: number, size: number): string {
  const hay = indexLines(haystack);
  const from = Math.max(0, startLine0);
  const to = Math.min(hay.lines.length, from + Math.min(size, MAX_REGION_LINES));
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    out.push(`${String(i + 1).padStart(5)} | ${hay.lines[i]}`);
  }
  if (from + size > to) out.push("      | … (region truncated)");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

type RecoveryOutcome =
  | { ok: true; edits: Edit[]; note: string }
  | { ok: false; message: string };

async function attemptRecovery(
  input: { path: string; edits: Edit[] },
  ctx: ExtensionContext,
  originalError: unknown,
): Promise<RecoveryOutcome> {
  const path = input.path;
  const abs = isAbsolute(path) ? path : resolve(ctx.cwd, path);

  let haystack: string;
  try {
    const buf = await readFile(abs);
    // Strip a UTF-8 BOM and normalize EOL to mirror the built-in's match space.
    const raw = buf.toString("utf-8").replace(/^\uFEFF/, "");
    haystack = toLF(raw);
  } catch {
    // Not a match problem (missing/unreadable file). Surface the real error.
    return { ok: false, message: String(originalError instanceof Error ? originalError.message : originalError) };
  }

  const edits = Array.isArray(input.edits) ? input.edits : [];
  const resolved: Edit[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const problems: string[] = [];

  for (let e = 0; e < edits.length; e++) {
    const edit = edits[e];
    const r = resolveEdit(haystack, edit.oldText);

    if (r.kind === "unique") {
      // Guard: the exact recovered bytes must be unique on disk, else the
      // built-in's own uniqueness check would reject the retry.
      if (findAll(haystack, r.oldText).length !== 1) {
        problems.push(
          `edits[${e}]: recovered a region at line ${r.line} (via ${r.via}) but its exact bytes occur multiple times — add surrounding context to disambiguate.`,
        );
        continue;
      }
      resolved.push({ oldText: r.oldText, newText: edit.newText });
      spans.push({ start: r.start, end: r.end });
      continue;
    }

    if (r.kind === "ambiguous") {
      const where = r.lines.slice(0, 10).map((l) => `line ${l}`).join(", ");
      problems.push(
        `edits[${e}]: oldText matches ${r.lines.length} locations (${r.via}) — ${where}. ` +
          `Add a few surrounding lines so it is unique. Searched:\n${echoOldText(edit.oldText)}`,
      );
      continue;
    }

    // No match anywhere — show the closest region with line numbers.
    const near = bestNearMiss(haystack, edit.oldText);
    const region = near ? numberedRegion(haystack, near.start, near.size) : "(file is empty)";
    problems.push(
      `edits[${e}]: oldText not found (tried exact, escape/EOL-normalized, and line-anchored matching). ` +
        `Closest region on disk${near ? ` (around line ${near.start + 1})` : ""}:\n${region}\n` +
        `Your oldText was:\n${echoOldText(edit.oldText)}`,
    );
  }

  // Overlap check among recovered spans.
  if (problems.length === 0) {
    const ordered = spans.map((s, i) => ({ ...s, i })).sort((a, b) => a.start - b.start);
    for (let k = 1; k < ordered.length; k++) {
      if (ordered[k].start < ordered[k - 1].end) {
        problems.push(
          `edits[${ordered[k - 1].i}] and edits[${ordered[k].i}] resolve to overlapping regions. ` +
            `Merge them into a single edit.`,
        );
        break;
      }
    }
  }

  if (problems.length > 0) {
    const header =
      `Edit failed and could not be auto-recovered for ${path}. ` +
      `${edits.length - problems.length}/${edits.length} block(s) resolved cleanly. Details:\n\n`;
    const body = problems.join("\n\n");
    const full = header + body;
    return { ok: false, message: truncateHead(full, { maxLines: 400, maxBytes: MAX_ERROR_BYTES }).content };
  }

  const vias = resolved.length;
  return {
    ok: true,
    edits: resolved,
    note: `[self-healing edit] recovered ${vias} block(s) via normalized matching; verify the diff above is correct.`,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // A definition bound to process.cwd() purely to harvest the built-in's render
  // slots, parameter schema, prepareArguments shim, and renderShell. The actual
  // execute always re-creates a definition bound to the live ctx.cwd.
  const template = createEditToolDefinition(process.cwd()) as any;

  pi.registerTool({
    ...template,
    description:
      template.description +
      " On failure this tool does not just report 'not found': it retries with " +
      "escape/EOL-normalized and line-anchored matching, and if it still cannot " +
      "find a unique match it returns the closest region on disk WITH LINE NUMBERS " +
      "so you can correct oldText without re-reading the file.",
    promptGuidelines: [
      ...(template.promptGuidelines ?? []),
      "When edit fails, read the returned 'closest region on disk' (it includes line numbers and current bytes) and correct oldText from that instead of issuing a separate read.",
    ],
    async execute(
      toolCallId: string,
      input: { path: string; edits: Edit[] },
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const real = createEditToolDefinition(ctx.cwd) as any;
      try {
        return await real.execute(toolCallId, input, signal, onUpdate, ctx);
      } catch (originalError) {
        if (signal?.aborted) throw originalError;

        const outcome = await attemptRecovery(input, ctx, originalError);
        if (!outcome.ok) {
          throw new Error(outcome.message);
        }

        const result = await real.execute(
          toolCallId,
          { path: input.path, edits: outcome.edits },
          signal,
          onUpdate,
          ctx,
        );
        return {
          ...result,
          content: [...result.content, { type: "text", text: outcome.note }],
        };
      }
    },
  });
}

/* ===========================================================================
 * HOW TO EXTEND — line-range and symbol-scoped addressing modes
 * ===========================================================================
 *
 * The tier above keeps the built-in schema `{ path, edits: [{oldText, newText}] }`
 * untouched, so it is a pure reliability upgrade. The next tier ADDS structural
 * addressing modes that sidestep text matching entirely — the cleanest answer
 * to staleness, because there is no `oldText` to go stale.
 *
 * Because the built-in schema is `additionalProperties: false`, you cannot just
 * pass extra fields through `...template`. You must declare your OWN schema. The
 * pattern: keep `oldText/newText` edits AS the common case, and add optional
 * structural fields. Below are working sketches.
 *
 * ---------------------------------------------------------------------------
 * 1) LINE-RANGE MODE  — `{ path, startLine, endLine, newText, expectedFirstLine? }`
 * ---------------------------------------------------------------------------
 * No matching at all: replace lines [startLine, endLine] (1-based, inclusive)
 * with `newText`. Pairs with pi's line-numbered `read` output. The optional
 * `expectedFirstLine` is a STALENESS GUARD: if the current first line of the
 * range does not equal what the caller expected, refuse instead of clobbering.
 *
 *   import { Type } from "typebox";
 *
 *   const schema = Type.Object({
 *     path: Type.String(),
 *     // ... keep the array form too (Type.Optional(Type.Array(...)))
 *     startLine: Type.Optional(Type.Integer({ minimum: 1 })),
 *     endLine: Type.Optional(Type.Integer({ minimum: 1 })),
 *     newText: Type.Optional(Type.String()),
 *     expectedFirstLine: Type.Optional(Type.String()),
 *   }, { additionalProperties: false });
 *
 *   async function lineRangeEdit(abs, p, ctx) {
 *     return withFileMutationQueue(abs, async () => {       // exported by pi
 *       const raw = (await readFile(abs, "utf-8")).replace(/^\uFEFF/, "");
 *       const lines = toLF(raw).split("\n");
 *       const a = p.startLine - 1, b = p.endLine - 1;
 *       if (a < 0 || b >= lines.length || a > b) throw new Error(`bad range`);
 *       if (p.expectedFirstLine !== undefined &&
 *           lines[a].trim() !== p.expectedFirstLine.trim()) {
 *         throw new Error(
 *           `Stale range: line ${p.startLine} is now "${lines[a]}", ` +
 *           `expected "${p.expectedFirstLine}". Re-read and retry.`);
 *       }
 *       const before = lines.slice(0, a), after = lines.slice(b + 1);
 *       const next = [...before, ...p.newText.split("\n"), ...after].join("\n");
 *       await writeFile(abs, next, "utf-8");
 *       // Reuse the built-in for the diff: easiest is to synthesize an
 *       // oldText = the exact sliced bytes and delegate, so you inherit the
 *       // EditToolDetails {diff, patch} shape and rendering for free:
 *       //   const oldText = lines.slice(a, b + 1).join("\n");
 *       //   return real.execute(id, { path, edits: [{ oldText, newText }] }, ...)
 *       // (delegate BEFORE writing yourself; do not double-write.)
 *     });
 *   }
 *
 * Routing: in execute(), if `startLine` is present, take the line-range path;
 * otherwise fall through to the matcher above. Document both in `description`.
 *
 * ---------------------------------------------------------------------------
 * 2) SYMBOL-SCOPED MODE  — `{ path, withinSymbol, oldText, newText }`
 * ---------------------------------------------------------------------------
 * Restrict the match search to one function/class body. Ambiguity collapses
 * (the search space is one symbol) and the staleness blast-radius is one
 * symbol. This is the missing middle between a tiny string edit and
 * `lsp_edit_symbol`'s whole-body replacement.
 *
 * Extensions have no direct LSP handle, so resolve the symbol range one of:
 *
 *   (a) Cheap + dependency-free: regex for the declaration line, then
 *       brace-match forward to the matching `}` to get [start, end). Good
 *       enough for C-family / JS / TS / Go. Then run resolveEdit() on
 *       `haystack.slice(start, end)` and offset the returned span back.
 *
 *   (b) Precise: shell out to the same machinery the lsp_* tools use. From an
 *       extension you can spawn a helper, e.g.
 *         const { stdout } = await pi.exec("your-lsp-symbol-range",
 *                                          [abs, symbolName], { signal });
 *       parse {startLine,endLine}, then constrain the search to that slice.
 *
 *   Sketch for (a):
 *     function symbolSlice(haystack, name) {
 *       const decl = new RegExp(`(?:^|\\n)[^\\n]*\\b${escapeRe(name)}\\b[^\\n]*\\{`);
 *       const m = decl.exec(haystack);
 *       if (!m) return null;
 *       let depth = 0, i = haystack.indexOf("{", m.index);
 *       const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
 *       for (; i < haystack.length; i++) {
 *         if (haystack[i] === "{") depth++;
 *         else if (haystack[i] === "}" && --depth === 0) return { start, end: i + 1 };
 *       }
 *       return null;
 *     }
 *
 *   Then: const sub = symbolSlice(haystack, p.withinSymbol);
 *         const r = resolveEdit(haystack.slice(sub.start, sub.end), p.oldText);
 *         // add sub.start to r.start/r.end before building the verbatim oldText.
 *
 * In all extension modes, keep the invariant from the tier above: the actual
 * WRITE and the diff/patch generation should still go through the built-in
 * (delegate with a synthesized exact `oldText`) so `EditToolDetails` and TUI
 * rendering stay identical. The structural modes only decide WHICH bytes to
 * replace; they should not own the write.
 * =========================================================================== */
