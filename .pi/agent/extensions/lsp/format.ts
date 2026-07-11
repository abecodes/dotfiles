/**
 * Output formatting for LSP results: snippet rendering, location dedup, glob filtering, symbol kind labels.
 *
 * Output target is the LLM, so prefer compact ASCII over decorative box characters.
 */
import { readFile } from "node:fs/promises";
import { relative, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Location, Position, Range } from "./manager.js";

/** LSP SymbolKind → short label */
export const SYMBOL_KIND: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "ctor",
  10: "enum",
  11: "interface",
  12: "func",
  13: "var",
  14: "const",
  15: "string",
  16: "number",
  17: "bool",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enumMember",
  23: "struct",
  24: "event",
  25: "operator",
  26: "typeParam",
};

export const SYMBOL_KIND_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(SYMBOL_KIND).map(([k, v]) => [v, Number(k)]),
);

export function kindLabel(k: number | undefined): string {
  if (k === undefined) return "?";
  return SYMBOL_KIND[k] ?? String(k);
}

/** Convert any path-ish input to an absolute path. Strips a leading @ (some models add it). */
export function toAbsPath(p: string, cwd: string): string {
  let s = p.startsWith("@") ? p.slice(1) : p;
  return isAbsolute(s) ? resolve(s) : resolve(cwd, s);
}

/** Format an absolute path relative to root, falling back to absolute if outside. */
export function formatPath(absPath: string, root: string): string {
  const rel = relative(root, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return absPath;
  return rel || ".";
}

/**
 * Convert 0-based LSP Position to user-visible 1-based "line:col".
 * We accept 1-based on the way in (see `oneBasedToLsp`) so this matches editor/grep conventions.
 */
export function lspToOneBased(p: Position): { line: number; character: number } {
  return { line: p.line + 1, character: p.character + 1 };
}

export function oneBasedToLsp(line: number, character: number): Position {
  return { line: Math.max(0, line - 1), character: Math.max(0, character - 1) };
}

export interface FilterOptions {
  /** Drop hits in *_test.* files. Default false (callers in tests are usually relevant). */
  excludeTests?: boolean;
  /** Drop hits under a `vendor/` directory. Default true. */
  excludeVendor?: boolean;
  /** Path globs that must match (relative to root). If empty, all paths pass. */
  includeGlobs?: string[];
  /** Path globs that must NOT match (relative to root). */
  excludeGlobs?: string[];
}

/** Tiny glob → regex: `**` = any, `*` = any except `/`, `?` = single non-`/`. */
export function globToRegex(g: string): RegExp {
  const escaped = g
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000DSTAR\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000DSTAR\u0000/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp("^" + escaped + "$");
}

export function pathMatchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(relPath));
}

export function passesFilters(absPath: string, root: string, opts: FilterOptions): boolean {
  const rel = formatPath(absPath, root);
  if (opts.excludeVendor !== false && /(^|\/)vendor\//.test("/" + rel)) return false;
  if (opts.excludeTests && /(^|\/)[^/]*_test\.[^/]+$/.test(rel)) return false;
  if (opts.includeGlobs && opts.includeGlobs.length > 0 && !pathMatchesAny(rel, opts.includeGlobs))
    return false;
  if (opts.excludeGlobs && opts.excludeGlobs.length > 0 && pathMatchesAny(rel, opts.excludeGlobs))
    return false;
  return true;
}

/** Locations dedup keyed on file:line:col. Some servers report duplicates. */
export function dedupLocations(locs: Location[]): Location[] {
  const seen = new Set<string>();
  const out: Location[] = [];
  for (const loc of locs) {
    const k = `${loc.uri}|${loc.range.start.line}:${loc.range.start.character}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(loc);
  }
  return out;
}

/** Convert LSP `Location | LocationLink | Location[]` to a plain `Location[]`. */
export function normalizeLocations(input: unknown): Location[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  const out: Location[] = [];
  for (const x of arr) {
    const v = x as { uri?: string; range?: Range; targetUri?: string; targetRange?: Range; targetSelectionRange?: Range };
    if (v.uri && v.range) {
      out.push({ uri: v.uri, range: v.range });
    } else if (v.targetUri && (v.targetSelectionRange ?? v.targetRange)) {
      out.push({ uri: v.targetUri, range: v.targetSelectionRange ?? v.targetRange! });
    }
  }
  return out;
}

/** Read a file once and reuse, since multiple results may live in the same file. */
export class FileSnippetReader {
  private cache = new Map<string, string[]>();

  async lines(absPath: string): Promise<string[]> {
    let lines = this.cache.get(absPath);
    if (!lines) {
      try {
        const text = await readFile(absPath, "utf8");
        lines = text.split(/\r?\n/);
      } catch {
        lines = [];
      }
      this.cache.set(absPath, lines);
    }
    return lines;
  }

  /** Render a snippet around (1-based) line with optional context, marking the match line. */
  async snippet(absPath: string, line1: number, contextLines: number): Promise<string> {
    const lines = await this.lines(absPath);
    if (lines.length === 0) return "";
    const ctx = Math.max(0, contextLines);
    const start = Math.max(1, line1 - ctx);
    const end = Math.min(lines.length, line1 + ctx);
    const widthOfMax = String(end).length;
    const out: string[] = [];
    for (let n = start; n <= end; n++) {
      const marker = n === line1 ? ">" : " ";
      const num = String(n).padStart(widthOfMax, " ");
      out.push(`${marker} ${num} | ${lines[n - 1] ?? ""}`);
    }
    return out.join("\n");
  }
}

/** Permissive input type — only `start` is read, so callers don't need to synthesize an `end`. */
export function formatLocation(
  loc: { uri: string; range: { start: Position } },
  root: string,
): { absPath: string; line: number; character: number; header: string } {
  const absPath = fileURLToPath(loc.uri);
  const { line, character } = lspToOneBased(loc.range.start);
  return { absPath, line, character, header: `${formatPath(absPath, root)}:${line}:${character}` };
}

/** Hover contents come in three shapes — flatten to a string. */
export function formatHoverContents(input: unknown): string {
  if (!input) return "";
  const arr = Array.isArray(input) ? input : [input];
  const parts: string[] = [];
  for (const c of arr) {
    if (typeof c === "string") parts.push(c);
    else if (c && typeof c === "object") {
      const v = c as { value?: string; language?: string; kind?: string };
      if (typeof v.value === "string") {
        if (v.language) parts.push("```" + v.language + "\n" + v.value + "\n```");
        else parts.push(v.value);
      }
    }
  }
  return parts.join("\n\n").trim();
}
