/**
 * Tool registrations. Each tool resolves a language from the file (or explicit `language`),
 * spawns/reuses the LSP server, ensures the file is opened, executes the request, and renders
 * a token-efficient string result.
 *
 * In-session cache:
 *   - Keyed on (tool, language, root, absPath, contentHash, position OR query).
 *   - Invalidated when the built-in `edit`/`write` tool finishes a mutation,
 *     and inline by `lsp_edit_symbol` / `lsp_rename_symbol` after their writes.
 *
 * Position resolution:
 *   - All tools that take a position accept either {line, character} (1-based) OR {symbol}.
 *   - {symbol} resolves via documentSymbol; supports "Type.Method" dotted paths.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type CatalogEntry,
  type LanguageConfig,
  type LspManager,
  type LspServer,
  type Position,
  CATALOG,
  catalogLanguageForExtension,
  catalogLanguages,
  findCatalogByLanguage,
  getAllLanguageIds,
  languageById,
  languageForPath,
  languagesConfigPath,
  languagesConfigTemplate,
  reloadLanguageRegistry,
  resolveBinary,
  writeActiveLanguageEntry,
} from "./manager.js";
import {
  FileSnippetReader,
  type FilterOptions,
  dedupLocations,
  formatHoverContents,
  formatLocation,
  formatPath,
  kindLabel,
  lspToOneBased,
  normalizeLocations,
  oneBasedToLsp,
  passesFilters,
  SYMBOL_KIND_BY_NAME,
  toAbsPath,
} from "./format.js";

/**
 * Build a one-line description of currently registered language ids. Computed
 * lazily because tool descriptions are read at registration time and we want
 * to reflect any user entries from languages.json.
 */
function knownLanguagesDescription(): string {
  const ids = getAllLanguageIds();
  if (ids.length === 0) return "none registered yet";
  return ids.sort().join(", ");
}

// --------------------------------------------------------------------------------------
// Install flow (used by `lsp_install` tool and inline by every path-based lsp_* tool)
//
// Inputs:  language id (e.g. "python"), optional preferred command (skip the picker)
// Effects: prompts user, possibly runs install command, writes languages.json,
//          reloads the registry.
// Output:  the LanguageConfig now active, or an error message.
// --------------------------------------------------------------------------------------

interface InstallResult {
  lang?: LanguageConfig;
  error?: string;
  cancelled?: boolean;
}

function installCandidateLabel(entry: CatalogEntry, onPath: string | null): string {
  const status = onPath ? "✅ installed" : "⚠️  not installed";
  const args = entry.args && entry.args.length > 0 ? ` ${entry.args.join(" ")}` : "";
  return `${status}  ${entry.command}${args}  — ${entry.installCommand}`;
}

/**
 * Pick a catalog entry for `language`, prompting the user when there's more
 * than one option (per design: "always prompt when multiple"). When there's
 * just one entry, return it without a prompt. When the catalog has nothing,
 * return undefined and let the caller emit a useful error.
 */
async function pickCatalogEntry(
  ctx: ExtensionContext,
  language: string,
  preferredCommand: string | undefined,
): Promise<{ entry?: CatalogEntry; cancelled?: boolean; error?: string }> {
  const candidates = findCatalogByLanguage(language);
  if (candidates.length === 0) {
    return {
      error:
        `No catalog entry for language "${language}". Known catalog languages: ${catalogLanguages().sort().join(", ") || "(none)"}.\n\n` +
        `To register a custom LSP, edit ${languagesConfigPath()} directly.`,
    };
  }

  // Explicit command override skips the picker.
  if (preferredCommand) {
    const exact = candidates.find((c) => c.command === preferredCommand);
    if (exact) return { entry: exact };
    return {
      error:
        `Command "${preferredCommand}" isn't a known catalog entry for language "${language}". ` +
        `Available: ${candidates.map((c) => c.command).join(", ")}.`,
    };
  }

  // Single candidate: silent pick (still asked to confirm install if missing).
  if (candidates.length === 1) return { entry: candidates[0] };

  if (!ctx.hasUI) {
    return {
      error:
        `${candidates.length} LSP candidates for "${language}" but no UI is available to pick. ` +
        `Re-run with an explicit command (one of: ${candidates.map((c) => c.command).join(", ")}).`,
    };
  }

  // Build labels with PATH status for each candidate (cheap; ~one execFile per candidate).
  const labels: string[] = [];
  const map = new Map<string, CatalogEntry>();
  for (const c of candidates) {
    const onPath = await resolveBinary({
      id: c.language,
      extensions: c.extensions,
      command: c.command,
      args: c.args,
      installCommand: c.installCommand,
      installNotes: c.installNotes,
      fallbackPaths: c.fallbackPaths,
    });
    const lbl = installCandidateLabel(c, onPath);
    labels.push(lbl);
    map.set(lbl, c);
  }

  const choice = await ctx.ui.select(
    `Pick an LSP for ${language}:`,
    labels,
  );
  if (!choice) return { cancelled: true };
  const entry = map.get(choice);
  if (!entry) return { cancelled: true };
  return { entry };
}

/**
 * Run the install flow for a language. Always prompts to pick (when there are
 * multiple catalog entries) and to install (when the picked binary is missing).
 * On success, writes the entry to languages.json and reloads the registry.
 */
async function runInstallFlow(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  language: string,
  preferredCommand: string | undefined,
): Promise<InstallResult> {
  const pick = await pickCatalogEntry(ctx, language, preferredCommand);
  if (pick.cancelled) return { cancelled: true };
  if (pick.error) return { error: pick.error };
  const entry = pick.entry!;

  // Build a transient LanguageConfig view so we can reuse `resolveBinary`.
  const transient: LanguageConfig = {
    id: entry.language,
    extensions: entry.extensions,
    command: entry.command,
    args: entry.args,
    installCommand: entry.installCommand,
    installNotes: entry.installNotes,
    fallbackPaths: entry.fallbackPaths,
  };

  let bin = await resolveBinary(transient);

  if (!bin) {
    if (!ctx.hasUI) {
      return {
        error:
          `${entry.command} is not installed and no UI is available to confirm an install. ` +
          `Run manually: \`${entry.installCommand}\`${entry.installNotes ? `\n${entry.installNotes}` : ""}`,
      };
    }
    const ok = await ctx.ui.confirm(
      `Install ${entry.command}?`,
      `${entry.command} is required for the "${entry.language}" LSP but isn't on your PATH.\n\n` +
        `Run:\n  ${entry.installCommand}` +
        (entry.installNotes ? `\n\n${entry.installNotes}` : ""),
    );
    if (!ok) return { cancelled: true };

    ctx.ui.notify(`Installing ${entry.command}\u2026`, "info");
    const result = await pi.exec("sh", ["-c", entry.installCommand], { signal: ctx.signal });
    if (result.code !== 0) {
      const tail = (result.stderr || result.stdout || "").trim().slice(-500);
      return {
        error: `Install failed (exit ${result.code}). Try manually: \`${entry.installCommand}\`\n${tail}`,
      };
    }
    ctx.ui.notify(`Installed ${entry.command}`, "info");
    bin = await resolveBinary(transient);
    if (!bin) {
      return {
        error:
          `Install reported success but ${entry.command} still isn't on PATH. ` +
          `You may need to update PATH (e.g. add $(go env GOPATH)/bin) and retry.`,
      };
    }
  }

  // Persist to languages.json.
  try {
    writeActiveLanguageEntry(entry.language, {
      extensions: entry.extensions,
      command: entry.command,
      args: entry.args,
      installCommand: entry.installCommand,
      installNotes: entry.installNotes,
      languageIdMap: entry.languageIdMap,
    });
  } catch (e) {
    return { error: `Failed to write languages.json: ${(e as Error).message}` };
  }
  ctx.ui.notify(
    `Added "${entry.language}" → ${entry.command} to ${languagesConfigPath()}`,
    "info",
  );

  const lang = languageById(entry.language);
  if (!lang) {
    return {
      error:
        `Wrote languages.json but couldn't reload the entry for "${entry.language}". Try /lsp reload.`,
    };
  }
  return { lang };
}

/**
 * Resolve a language for a file path, auto-installing via `runInstallFlow` if
 * the active registry has no entry for the path's extension. Returns either a
 * LanguageConfig or a fully-formed error result the caller can return as-is.
 */
async function resolveLanguageForPath(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  path: string,
): Promise<{ lang?: LanguageConfig; errorResult?: ReturnType<typeof errorResult> }> {
  const direct = languageForPath(path);
  if (direct) return { lang: direct };

  const ext = path.toLowerCase().match(/\.[^./\\]+$/)?.[0] ?? "";
  const catalogLang = ext ? catalogLanguageForExtension(ext) : undefined;

  if (!catalogLang) {
    // No active entry, no catalog suggestion — surface the JSON-template hint.
    const lines: string[] = [];
    if (ext) {
      lines.push(`No LSP registered for ${ext} files, and the catalog has no recommendation for that extension.`);
    } else {
      lines.push(`Cannot determine a language for ${path} — no extension on the path.`);
    }
    lines.push(`Catalog languages: ${catalogLanguages().sort().join(", ") || "(none)"}.`);
    lines.push(`Active registry: ${knownLanguagesDescription()}.`);
    lines.push("");
    lines.push(`To add a custom LSP, edit ${languagesConfigPath()}:`);
    lines.push("");
    lines.push(languagesConfigTemplate(ext || ".foo"));
    return { errorResult: errorResult(lines.join("\n")) };
  }

  // Auto-trigger the install flow inline.
  const installed = await runInstallFlow(pi, ctx, catalogLang, undefined);
  if (installed.lang) return { lang: installed.lang };
  if (installed.cancelled) {
    return {
      errorResult: errorResult(
        `No LSP active for ${ext} files and install was cancelled. ` +
          `Run \`lsp_install\` with language="${catalogLang}" when ready.`,
      ),
    };
  }
  return { errorResult: errorResult(installed.error ?? "Install flow failed.") };
}

/**
 * Resolve a language by id (for tools that take an explicit `language` arg).
 * Auto-installs if the id isn't in the active registry but is in the catalog.
 */
async function resolveLanguageById(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  id: string,
): Promise<{ lang?: LanguageConfig; errorResult?: ReturnType<typeof errorResult> }> {
  const direct = languageById(id);
  if (direct) return { lang: direct };

  if (findCatalogByLanguage(id).length === 0) {
    return {
      errorResult: errorResult(
        `No active or catalog entry for language "${id}". ` +
          `Catalog languages: ${catalogLanguages().sort().join(", ") || "(none)"}. ` +
          `Active registry: ${knownLanguagesDescription()}. ` +
          `Edit ${languagesConfigPath()} to add a custom entry.`,
      ),
    };
  }

  const installed = await runInstallFlow(pi, ctx, id, undefined);
  if (installed.lang) return { lang: installed.lang };
  if (installed.cancelled) {
    return {
      errorResult: errorResult(`Install was cancelled; "${id}" remains unregistered.`),
    };
  }
  return { errorResult: errorResult(installed.error ?? "Install flow failed.") };
}

interface AcquireResult {
  server?: LspServer;
  error?: string;
}

/** In-session cache. Cleared on file edit. Map<key, value>. */
class SessionCache {
  private store = new Map<string, string>();
  /** Per-file index so we can invalidate efficiently. */
  private byFile = new Map<string, Set<string>>();

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string, files: string[]): void {
    this.store.set(key, value);
    for (const f of files) {
      let s = this.byFile.get(f);
      if (!s) {
        s = new Set();
        this.byFile.set(f, s);
      }
      s.add(key);
    }
  }

  invalidateFile(absPath: string): void {
    const keys = this.byFile.get(absPath);
    if (!keys) return;
    for (const k of keys) this.store.delete(k);
    this.byFile.delete(absPath);
  }

  clear(): void {
    this.store.clear();
    this.byFile.clear();
  }
}

/**
 * Spawn (or reuse) the LSP server for `lang`. Assumes the language has
 * already been added to the active registry and its binary is reachable —
 * the auto-install flow runs earlier, in `resolveLanguageForPath` /
 * `resolveLanguageById`. If we get here and the binary still isn't on PATH
 * (e.g. the user manually edited languages.json with a non-existent command),
 * we surface a clear error pointing at the install command from the entry.
 */
async function acquireServer(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  manager: LspManager,
  lang: LanguageConfig,
  workspaceRoot: string,
): Promise<AcquireResult> {
  void pi;
  void ctx;
  const server = await manager.getOrSpawn(lang, workspaceRoot);
  if (server) return { server };

  const notes = lang.installNotes ? `\n${lang.installNotes}` : "";
  return {
    error:
      `${lang.command} (registered for "${lang.id}") is not on PATH. ` +
      `Install with: \`${lang.installCommand}\`${notes}\n\n` +
      `Or call \`lsp_install\` with language="${lang.id}" to re-run the install flow.`,
  };
}

/**
 * Recursively find a symbol by name in a documentSymbol response.
 *
 * Tries two strategies in order:
 *   1. Literal-name match (recursing into children). Handles LSPs that return
 *      methods as flat top-level symbols with names like `(Repository).Store`
 *      (gopls), `Foo::bar` (rust-analyzer), etc. — the dotted/colon form is
 *      part of the *name itself*, not a nesting path.
 *   2. Dotted-path traversal (`A.B.C`). Handles LSPs that return nested
 *      hierarchies, e.g. typescript-language-server with a class `A` whose
 *      method `B` is a child symbol.
 *
 * Doing literal-match first means callers don't need to know the LSP's naming
 * convention up front — if their literal target appears anywhere in the tree
 * we'll find it, otherwise we fall back to walking dot segments.
 */
function findSymbol(syms: unknown, target: string): { range: { start: Position } } | null {
  const r = findSymbolRanges(syms, target);
  if (!r) return null;
  return { range: r.selectionRange };
}

/**
 * Like `findSymbol`, but returns BOTH ranges:
 *   - `selectionRange`: just the identifier (best for cursor placement / rename anchor).
 *   - `fullRange`: the full symbol extent (best for replacing whole bodies).
 *
 * When the LSP only returns flat `SymbolInformation` (single `location.range`),
 * both fields point at that same range.
 */
function findSymbolRanges(
  syms: unknown,
  target: string,
): {
  fullRange: { start: Position; end: Position };
  selectionRange: { start: Position; end: Position };
} | null {
  if (!Array.isArray(syms)) return null;

  // 1. Literal-name match anywhere in the symbol tree.
  for (const s of syms as Array<{
    name?: string;
    selectionRange?: { start: Position; end: Position };
    location?: { range: { start: Position; end: Position } };
    range?: { start: Position; end: Position };
    children?: unknown;
  }>) {
    if (s.name === target) {
      const fullRange = s.range ?? s.location?.range ?? s.selectionRange;
      const selectionRange = s.selectionRange ?? s.location?.range ?? s.range;
      if (fullRange && selectionRange) return { fullRange, selectionRange };
    }
    if (s.children) {
      const found = findSymbolRanges(s.children, target);
      if (found) return found;
    }
  }

  // 2. Dotted-path traversal for nested symbols.
  if (target.includes(".")) {
    const [head, ...rest] = target.split(".");
    const tail = rest.join(".");
    for (const s of syms as Array<{ name?: string; children?: unknown }>) {
      if (s.name === head && s.children) {
        const found = findSymbolRanges(s.children, tail);
        if (found) return found;
      }
    }
  }

  return null;
}

/**
 * Convert a (line, character) LSP position into a JS string offset.
 *
 * Note: LSP `character` is in UTF-16 code units by default, which matches JS
 * string indexing. Files containing characters outside the BMP could in theory
 * disagree, but in practice (source code) this is fine.
 */
function offsetForPosition(text: string, line: number, character: number): number {
  let offset = 0;
  let curLine = 0;
  while (curLine < line) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
    curLine++;
  }
  return Math.min(offset + character, text.length);
}

interface LspTextEdit {
  range: { start: Position; end: Position };
  newText: string;
}

/** Apply a list of TextEdits to a string, in reverse order so earlier offsets stay valid. */
function applyTextEdits(text: string, edits: LspTextEdit[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  let out = text;
  for (const e of sorted) {
    const start = offsetForPosition(out, e.range.start.line, e.range.start.character);
    const end = offsetForPosition(out, e.range.end.line, e.range.end.character);
    out = out.slice(0, start) + e.newText + out.slice(end);
  }
  return out;
}

/** Write `newText` to `absPath` and invalidate every cached view of it. */
async function writeAndInvalidate(
  absPath: string,
  newText: string,
  cache: SessionCache,
  manager: LspManager,
): Promise<void> {
  await writeFile(absPath, newText, "utf8");
  cache.invalidateFile(absPath);
  manager.forEach((s) => s.invalidateFile(absPath));
}

interface WorkspaceEditLike {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<
    | { textDocument: { uri: string; version?: number }; edits: LspTextEdit[] }
    | { kind: string }
  >;
}

/**
 * Apply a WorkspaceEdit returned by `textDocument/rename` (or any other LSP
 * request that yields one). Skips file create/rename/delete operations — we
 * only handle TextEdits, which is sufficient for rename across existing files.
 */
async function applyWorkspaceEdit(
  edit: WorkspaceEditLike,
  cache: SessionCache,
  manager: LspManager,
): Promise<{ filesChanged: Array<{ path: string; hunks: number }>; totalEdits: number }> {
  const fileEdits = new Map<string, LspTextEdit[]>();
  if (edit.documentChanges) {
    for (const dc of edit.documentChanges) {
      if (!("textDocument" in dc)) continue; // skip create/rename/delete ops
      const path = fileURLToPath(dc.textDocument.uri);
      const existing = fileEdits.get(path) ?? [];
      existing.push(...dc.edits);
      fileEdits.set(path, existing);
    }
  } else if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      fileEdits.set(fileURLToPath(uri), edits);
    }
  }

  const filesChanged: Array<{ path: string; hunks: number }> = [];
  let totalEdits = 0;
  for (const [path, edits] of fileEdits) {
    const text = await readFile(path, "utf8");
    const newText = applyTextEdits(text, edits);
    await writeAndInvalidate(path, newText, cache, manager);
    filesChanged.push({ path, hunks: edits.length });
    totalEdits += edits.length;
  }
  return { filesChanged, totalEdits };
}

/** Compact post-edit diagnostic summary. Errors only, no surrounding code snippets. */
async function summarizeDiagnostics(
  server: LspServer,
  absPath: string,
  root: string,
): Promise<string> {
  // gopls (and others) publish a *clearing* `publishDiagnostics: []` event
  // immediately after `didChange`, then re-emit the real diagnostics once
  // analysis completes. `waitForDiagnostics` resolves on the first event,
  // which would falsely report "no errors". Wait for the first event, then
  // poll until the published set stays stable for ~500ms.
  await server.waitForDiagnostics(absPath, 3000);
  let lastSerialized = JSON.stringify(server.getDiagnostics(absPath));
  let stableSince = Date.now();
  const settleDeadline = Date.now() + 2000;
  while (Date.now() < settleDeadline) {
    await new Promise((r) => setTimeout(r, 100));
    const curSerialized = JSON.stringify(server.getDiagnostics(absPath));
    if (curSerialized !== lastSerialized) {
      lastSerialized = curSerialized;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 500) {
      break;
    }
  }
  const diags = server.getDiagnostics(absPath);
  const errors = diags.filter((d) => (d.severity ?? 1) === 1);
  if (errors.length === 0) return `✓ ${formatPath(absPath, root)}: no errors`;
  const lines: string[] = [`⚠ ${formatPath(absPath, root)}: ${errors.length} error(s)`];
  for (const d of errors.slice(0, 20)) {
    const oneBased = lspToOneBased(d.range.start);
    lines.push(`  L${oneBased.line}:${oneBased.character}  ${d.message}`);
  }
  if (errors.length > 20) lines.push(`  ... ${errors.length - 20} more`);
  return lines.join("\n");
}

/** Resolve a position from {line,character} OR {symbol}. */
async function resolvePosition(
  server: LspServer,
  absPath: string,
  args: { line?: number; character?: number; symbol?: string },
): Promise<{ position: Position } | { error: string }> {
  if (args.symbol) {
    const result = await server.request<unknown>("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(absPath).toString() },
    });
    const found = findSymbol(result, args.symbol);
    if (!found) {
      return { error: `Symbol "${args.symbol}" not found in ${absPath}.` };
    }
    return { position: found.range.start };
  }
  if (typeof args.line === "number" && typeof args.character === "number") {
    return { position: oneBasedToLsp(args.line, args.character) };
  }
  if (typeof args.line === "number") {
    // Line-only: anchor at column 1. Useful when caller has a grep hit but not a column.
    return { position: oneBasedToLsp(args.line, 1) };
  }
  return { error: "Provide either {line, character} (1-based) or {symbol}." };
}

function workspaceRootFor(ctx: ExtensionContext, override?: string): string {
  if (override && override.length > 0) return toAbsPath(override, ctx.cwd);
  return ctx.cwd;
}

// (legacy `languageFor` helper removed — path-based tools now go through
// `resolveLanguageForPath`, which auto-installs from the catalog when the
// active registry has no entry, and id-based tools use `resolveLanguageById`.)

/** Build a stable cache key. `extra` distinguishes per-tool params (positions, queries, filters). */
async function cacheKey(
  tool: string,
  lang: LanguageConfig,
  root: string,
  absPath: string | null,
  extra: string,
): Promise<{ key: string; files: string[] }> {
  if (!absPath) {
    return { key: `${tool}|${lang.id}|${root}|${extra}`, files: [] };
  }
  let hash = "0";
  try {
    const text = await readFile(absPath, "utf8");
    hash = await import("node:crypto").then((c) =>
      c.createHash("sha1").update(text).digest("hex").slice(0, 12),
    );
  } catch {
    /* missing file → key without hash; cache won't hit anyway */
  }
  return { key: `${tool}|${lang.id}|${root}|${absPath}|${hash}|${extra}`, files: [absPath] };
}

export function registerTools(
  pi: ExtensionAPI,
  manager: LspManager,
  cache: SessionCache,
): void {
  manager.onServerDeath = () => cache.clear();

  // Hang protection lives at the server layer:
  //   - manager.ts INIT_TIMEOUT_MS guards `initialize` (kills the proc on stall).
  //   - manager.ts REQUEST_TIMEOUT_MS guards every JSON-RPC request.
  //   - waitForDiagnostics has its own 3s deadline.
  // Both timeouts produce thrown errors with a "common cause" hint, so any
  // stuck lsp_* tool now fails fast with a clear message instead of hanging.
  // We deliberately do NOT add a tool-level Promise.race here — it would
  // duplicate work, and there is no realistic hang scenario the server-layer
  // guards don't already cover.

  // ── Common parameter shapes ─────────────────────────────────────────────────

  const positionShape = {
    path: Type.String({ description: "File path (relative to cwd or absolute)." }),
    line: Type.Optional(
      Type.Number({ description: "1-based line. Use line+character OR symbol." }),
    ),
    character: Type.Optional(Type.Number({ description: "1-based column." })),
    symbol: Type.Optional(
      Type.String({
        description:
          'Symbol name to locate via documentSymbols. Supports dotted paths like "Runner.Run". Use this OR line+character.',
      }),
    ),
    workspaceRoot: Type.Optional(
      Type.String({
        description:
          "Override the workspace root for this call. Default is the agent's cwd. Useful for cross-repo lookups without restarting pi.",
      }),
    ),
  };

  const filterShape = {
    excludeTests: Type.Optional(
      Type.Boolean({ description: "Drop hits in *_test.* files. Default false." }),
    ),
    excludeVendor: Type.Optional(
      Type.Boolean({ description: "Drop hits under vendor/. Default true." }),
    ),
    includeGlobs: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Path globs (relative to root) that must match. Example: ["framework/**"].',
      }),
    ),
    excludeGlobs: Type.Optional(
      Type.Array(Type.String(), {
        description: "Path globs (relative to root) to exclude.",
      }),
    ),
    maxResults: Type.Optional(
      Type.Number({ description: "Cap result count. Default 100." }),
    ),
    contextLines: Type.Optional(
      Type.Number({ description: "Lines of code shown around each hit. Default 1." }),
    ),
  };

  // ── lsp_hover ───────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "lsp_hover",
    label: "LSP Hover",
    description:
      "Get type signature + doc for a symbol at a position via LSP. Replaces reading whole files just to learn one func/type's shape. Accepts {path, line, character} (1-based) or {path, symbol}. Requires a project root marker (tsconfig.json/package.json/go.mod/Cargo.toml/pyproject.toml/.git) at-or-above the path — without one, the server hangs on initialize.",
    promptSnippet:
      "Symbol type/signature/docs at a position. Cheap way to learn a func/type without reading the whole file.",
    parameters: Type.Object({ ...positionShape }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const langRes = await resolveLanguageForPath(pi, ctx, params.path);
      if (langRes.errorResult) return langRes.errorResult;
      const lang = langRes.lang!;
      const root = workspaceRootFor(ctx, params.workspaceRoot);
      const absPath = toAbsPath(params.path, root);

      const acq = await acquireServer(pi, ctx, manager, lang, root);
      if (!acq.server) return errorResult(acq.error!);
      const server = acq.server;

      await server.ensureOpen(absPath);
      const posRes = await resolvePosition(server, absPath, params);
      if ("error" in posRes) return errorResult(posRes.error);
      const position = posRes.position;

      const ck = await cacheKey(
        "hover",
        lang,
        root,
        absPath,
        `${position.line}:${position.character}|${params.symbol ?? ""}`,
      );
      const cached = cache.get(ck.key);
      if (cached) return textResultWithHint(server, cached);

      const result = (await server.request<unknown>("textDocument/hover", {
        textDocument: { uri: pathToFileURL(absPath).toString() },
        position,
      })) as { contents?: unknown; range?: { start: Position } } | null;

      const out: string[] = [];
      const where = `${formatPath(absPath, root)}:${(params.symbol ? "" : `${params.line ?? "?"}:${params.character ?? "?"}`)}`;
      out.push(where);
      if (!result || !result.contents) {
        out.push("(no hover info)");
      } else {
        out.push(formatHoverContents(result.contents));
      }
      const text = out.join("\n");
      cache.set(ck.key, text, ck.files);
      return textResultWithHint(server, text);
    },
  });

  // ── lsp_references / lsp_definition / lsp_implementations ──────────────────

  for (const tool of [
    {
      name: "lsp_references",
      label: "LSP References",
      method: "textDocument/references",
      paramsExtra: { context: { includeDeclaration: true } },
      headerVerb: "references",
      snippet: "Find all references to the symbol at a position. Semantic, not textual.",
    },
    {
      name: "lsp_definition",
      label: "LSP Definition",
      method: "textDocument/definition",
      paramsExtra: {},
      headerVerb: "definition",
      snippet: "Jump to the definition of a symbol. Resolves into deps and stdlib.",
    },
    {
      name: "lsp_implementations",
      label: "LSP Implementations",
      method: "textDocument/implementation",
      paramsExtra: {},
      headerVerb: "implementations",
      snippet: "List concrete implementations of an interface/trait method.",
    },
  ] as const) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: `${tool.snippet} Accepts {path, line, character} (1-based) or {path, symbol}. Requires a project root marker (tsconfig.json/package.json/go.mod/Cargo.toml/pyproject.toml/.git) at-or-above the path — without one, the server hangs on initialize.`,
      promptSnippet: tool.snippet,
      parameters: Type.Object({ ...positionShape, ...filterShape }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const langRes = await resolveLanguageForPath(pi, ctx, params.path);
        if (langRes.errorResult) return langRes.errorResult;
        const lang = langRes.lang!;
        const root = workspaceRootFor(ctx, params.workspaceRoot);
        const absPath = toAbsPath(params.path, root);
        const acq = await acquireServer(pi, ctx, manager, lang, root);
        if (!acq.server) return errorResult(acq.error!);
        const server = acq.server;

        await server.ensureOpen(absPath);
        const posRes = await resolvePosition(server, absPath, params);
        if ("error" in posRes) return errorResult(posRes.error);
        const position = posRes.position;

        const filterKey = JSON.stringify({
          t: params.excludeTests,
          v: params.excludeVendor,
          i: params.includeGlobs,
          x: params.excludeGlobs,
          m: params.maxResults,
          c: params.contextLines,
        });
        const ck = await cacheKey(
          tool.name,
          lang,
          root,
          absPath,
          `${position.line}:${position.character}|${params.symbol ?? ""}|${filterKey}`,
        );
        const cached = cache.get(ck.key);
        if (cached) return textResultWithHint(server, cached);

        const reqParams = {
          textDocument: { uri: pathToFileURL(absPath).toString() },
          position,
          ...tool.paramsExtra,
        };
        const raw = await server.request<unknown>(tool.method, reqParams);
        const locs = dedupLocations(normalizeLocations(raw));

        const filters: FilterOptions = {
          excludeTests: params.excludeTests,
          excludeVendor: params.excludeVendor,
          includeGlobs: params.includeGlobs,
          excludeGlobs: params.excludeGlobs,
        };
        const filtered = locs.filter((l) => {
          try {
            const abs = formatLocation(l, root).absPath;
            return passesFilters(abs, root, filters);
          } catch {
            return false;
          }
        });

        const cap = params.maxResults ?? 100;
        const truncated = filtered.length > cap;
        const shown = filtered.slice(0, cap);
        const ctxLines = params.contextLines ?? 1;
        const reader = new FileSnippetReader();

        const sections: string[] = [];
        sections.push(
          `Found ${filtered.length} ${tool.headerVerb}${
            locs.length !== filtered.length ? ` (${locs.length - filtered.length} filtered out)` : ""
          }${truncated ? `, showing first ${cap}` : ""}.`,
        );

        for (const loc of shown) {
          const fmt = formatLocation(loc, root);
          sections.push("");
          sections.push(fmt.header);
          if (ctxLines >= 0) {
            const snip = await reader.snippet(fmt.absPath, fmt.line, ctxLines);
            if (snip) sections.push(snip);
          }
        }

        const text = sections.join("\n");
        cache.set(ck.key, text, ck.files);
        return textResultWithHint(server, text);
      },
    });
  }

  // ── lsp_workspace_symbols ──────────────────────────────────────────────────

  pi.registerTool({
    name: "lsp_workspace_symbols",
    label: "LSP Workspace Symbols",
    description:
      "Search for symbols across the workspace by name. Faster and more precise than `rg \"^func \"`. Requires a project root marker (tsconfig.json/package.json/go.mod/Cargo.toml/pyproject.toml/.git) at the workspace root — without one, the server hangs on initialize.",
    promptSnippet: "Find symbols by name across the workspace (semantic, faster than rg for symbol lookup).",
    parameters: Type.Object({
      query: Type.String({ description: "Symbol name (or substring) to search for." }),
      language: Type.Optional(
        Type.String({
          description:
            "Language id of the LSP to query (e.g. go, typescript, python). Currently registered: " +
            knownLanguagesDescription() +
            ". Add new ids in ~/.pi/agent/extensions/lsp/languages.json.",
        }),
      ),
      kindFilter: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Filter by kind. Allowed: func, method, type, struct, interface, class, var, const, field, enum, package, namespace, module.',
        }),
      ),
      excludeTests: Type.Optional(Type.Boolean()),
      excludeVendor: Type.Optional(Type.Boolean()),
      includeGlobs: Type.Optional(Type.Array(Type.String())),
      excludeGlobs: Type.Optional(Type.Array(Type.String())),
      maxResults: Type.Optional(Type.Number({ description: "Default 100." })),
      workspaceRoot: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const idToResolve = params.language ?? "go";
      const langRes = await resolveLanguageById(pi, ctx, idToResolve);
      if (langRes.errorResult) return langRes.errorResult;
      const lang = langRes.lang!;
      const root = workspaceRootFor(ctx, params.workspaceRoot);
      const acq = await acquireServer(pi, ctx, manager, lang, root);
      if (!acq.server) return errorResult(acq.error!);
      const server = acq.server;

      const filterKey = JSON.stringify({
        l: lang.id,
        k: params.kindFilter,
        t: params.excludeTests,
        v: params.excludeVendor,
        i: params.includeGlobs,
        x: params.excludeGlobs,
        m: params.maxResults,
      });
      const ck = await cacheKey(
        "workspace_symbols",
        lang,
        root,
        null,
        `${params.query}|${filterKey}`,
      );
      const cached = cache.get(ck.key);
      if (cached) return textResultWithHint(server, cached);

      const raw = (await server.request<unknown>("workspace/symbol", {
        query: params.query,
      })) as Array<{
        name: string;
        kind?: number;
        location: { uri: string; range: { start: Position } };
        containerName?: string;
      }> | null;

      if (!raw || raw.length === 0) {
        return textResultWithHint(server, `No symbols matching "${params.query}".`);
      }

      const kindIds =
        params.kindFilter && params.kindFilter.length > 0
          ? new Set(
              params.kindFilter
                .map((k: string) => SYMBOL_KIND_BY_NAME[k])
                .filter((n: number | undefined): n is number => typeof n === "number"),
            )
          : null;

      const filters: FilterOptions = {
        excludeTests: params.excludeTests,
        excludeVendor: params.excludeVendor,
        includeGlobs: params.includeGlobs,
        excludeGlobs: params.excludeGlobs,
      };

      const filtered = raw.filter((s) => {
        if (kindIds && (s.kind === undefined || !kindIds.has(s.kind))) return false;
        try {
          const abs = formatLocation({ uri: s.location.uri, range: s.location.range }, root).absPath;
          return passesFilters(abs, root, filters);
        } catch {
          return false;
        }
      });

      const cap = params.maxResults ?? 100;
      const shown = filtered.slice(0, cap);
      const lines: string[] = [];
      lines.push(
        `Found ${filtered.length} symbol${filtered.length === 1 ? "" : "s"} matching "${params.query}"${
          raw.length !== filtered.length ? ` (${raw.length - filtered.length} filtered out)` : ""
        }${filtered.length > cap ? `, showing first ${cap}` : ""}.`,
      );
      lines.push("");
      // Compute column widths.
      const rows = shown.map((s) => {
        const fmt = formatLocation({ uri: s.location.uri, range: s.location.range }, root);
        const container = s.containerName ? ` [${s.containerName}]` : "";
        return { loc: fmt.header, kind: kindLabel(s.kind), name: s.name, container };
      });
      const locW = Math.max(0, ...rows.map((r) => r.loc.length));
      const kindW = Math.max(0, ...rows.map((r) => r.kind.length));
      for (const r of rows) {
        lines.push(`${r.loc.padEnd(locW)}  ${r.kind.padEnd(kindW)}  ${r.name}${r.container}`);
      }

      const text = lines.join("\n");
      cache.set(ck.key, text, ck.files);
      return textResultWithHint(server, text);
    },
  });

  // ── lsp_document_symbols ───────────────────────────────────────────────────

  pi.registerTool({
    name: "lsp_document_symbols",
    label: "LSP Document Symbols",
    description:
      "Outline a single file's symbols without reading its body. Requires a project root marker (tsconfig.json/package.json/go.mod/Cargo.toml/pyproject.toml/.git) at-or-above the path — without one, the server hangs on initialize.",
    promptSnippet: "Outline a single file's top-level symbols without reading the body.",
    parameters: Type.Object({
      path: Type.String(),
      kindFilter: Type.Optional(Type.Array(Type.String())),
      workspaceRoot: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const langRes = await resolveLanguageForPath(pi, ctx, params.path);
      if (langRes.errorResult) return langRes.errorResult;
      const lang = langRes.lang!;
      const root = workspaceRootFor(ctx, params.workspaceRoot);
      const absPath = toAbsPath(params.path, root);
      const acq = await acquireServer(pi, ctx, manager, lang, root);
      if (!acq.server) return errorResult(acq.error!);
      const server = acq.server;

      await server.ensureOpen(absPath);
      const ck = await cacheKey(
        "document_symbols",
        lang,
        root,
        absPath,
        JSON.stringify({ k: params.kindFilter }),
      );
      const cached = cache.get(ck.key);
      if (cached) return textResultWithHint(server, cached);

      const raw = await server.request<unknown>("textDocument/documentSymbol", {
        textDocument: { uri: pathToFileURL(absPath).toString() },
      });

      const kindIds =
        params.kindFilter && params.kindFilter.length > 0
          ? new Set(
              params.kindFilter
                .map((k: string) => SYMBOL_KIND_BY_NAME[k])
                .filter((n: number | undefined): n is number => typeof n === "number"),
            )
          : null;

      // documentSymbol can return DocumentSymbol[] (hierarchical) or SymbolInformation[] (flat).
      const flat: Array<{ name: string; kind?: number; line: number; container?: string }> = [];
      const visit = (
        nodes: unknown,
        container: string,
      ) => {
        if (!Array.isArray(nodes)) return;
        for (const n of nodes as Array<{
          name: string;
          kind?: number;
          range?: { start: Position };
          selectionRange?: { start: Position };
          location?: { range: { start: Position } };
          children?: unknown;
          containerName?: string;
        }>) {
          const start = (n.selectionRange ?? n.range ?? n.location?.range)?.start;
          const line = start ? lspToOneBased(start).line : 0;
          flat.push({
            name: n.name,
            kind: n.kind,
            line,
            container: container || n.containerName,
          });
          if (n.children) visit(n.children, container ? `${container}.${n.name}` : n.name);
        }
      };
      visit(raw, "");

      const filtered = kindIds
        ? flat.filter((s) => s.kind !== undefined && kindIds.has(s.kind))
        : flat;

      if (filtered.length === 0) {
        return textResultWithHint(server, `${formatPath(absPath, root)}: no matching symbols.`);
      }

      const lines: string[] = [];
      lines.push(`${formatPath(absPath, root)} (${filtered.length} symbols):`);
      lines.push("");
      const rows = filtered.map((s) => ({
        line: String(s.line),
        kind: kindLabel(s.kind),
        name: s.name,
        container: s.container ? ` [${s.container}]` : "",
      }));
      const lineW = Math.max(0, ...rows.map((r) => r.line.length));
      const kindW = Math.max(0, ...rows.map((r) => r.kind.length));
      for (const r of rows) {
        lines.push(`  ${r.line.padStart(lineW)}  ${r.kind.padEnd(kindW)}  ${r.name}${r.container}`);
      }
      const text = lines.join("\n");
      cache.set(ck.key, text, ck.files);
      return textResultWithHint(server, text);
    },
  });

  // ── lsp_diagnostics ────────────────────────────────────────────────────────

  pi.registerTool({
    name: "lsp_diagnostics",
    label: "LSP Diagnostics",
    description:
      "Return current LSP diagnostics for a single file. Useful for narrow file-level inspection without running the full build. Requires a project root marker (tsconfig.json/package.json/go.mod/Cargo.toml/pyproject.toml/.git) at-or-above the path — without one, the server hangs on initialize.",
    promptSnippet:
      "File-level diagnostics from the LSP. Narrow scope alternative to running `go build`/`go vet`.",
    parameters: Type.Object({
      path: Type.String(),
      severityMin: Type.Optional(
        StringEnum(["error", "warning", "info", "hint"] as const, {
          description: "Minimum severity to report. Default error.",
        }),
      ),
      contextLines: Type.Optional(Type.Number({ description: "Lines around each diagnostic. Default 1." })),
      workspaceRoot: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const langRes = await resolveLanguageForPath(pi, ctx, params.path);
      if (langRes.errorResult) return langRes.errorResult;
      const lang = langRes.lang!;
      const root = workspaceRootFor(ctx, params.workspaceRoot);
      const absPath = toAbsPath(params.path, root);
      const acq = await acquireServer(pi, ctx, manager, lang, root);
      if (!acq.server) return errorResult(acq.error!);
      const server = acq.server;

      await server.ensureOpen(absPath);
      const diags = await server.waitForDiagnostics(absPath, 3000);

      const sevMap: Record<string, number> = { error: 1, warning: 2, info: 3, hint: 4 };
      const sevName: Record<number, string> = { 1: "ERROR", 2: "WARN ", 3: "INFO ", 4: "HINT " };
      const minSev = sevMap[params.severityMin ?? "error"];

      const filtered = diags.filter((d) => (d.severity ?? 1) <= minSev);
      const ctxLines = params.contextLines ?? 1;

      if (filtered.length === 0) {
        return textResultWithHint(
          server,
          `${formatPath(absPath, root)}: no diagnostics${
            diags.length > 0 ? ` at severity >= ${params.severityMin ?? "error"} (${diags.length} suppressed)` : ""
          }.`,
        );
      }

      const reader = new FileSnippetReader();
      const lines: string[] = [];
      lines.push(
        `${formatPath(absPath, root)} (${filtered.length} diagnostic${filtered.length === 1 ? "" : "s"}):`,
      );
      for (const d of filtered) {
        const oneBased = lspToOneBased(d.range.start);
        const tag = sevName[d.severity ?? 1] ?? "?    ";
        const src = d.source ? `  (${d.source}${d.code !== undefined ? ` ${d.code}` : ""})` : "";
        lines.push("");
        lines.push(`${tag} ${oneBased.line}:${oneBased.character}  ${d.message}${src}`);
        if (ctxLines >= 0) {
          const snip = await reader.snippet(absPath, oneBased.line, ctxLines);
          if (snip) lines.push(snip);
        }
      }
      return textResultWithHint(server, lines.join("\n"));
    },
  });

  // ── lsp_peek_symbol ────────────────────────────────────────────────────────

  pi.registerTool({
    name: "lsp_peek_symbol",
    label: "LSP Peek Symbol",
    description:
      "Return the current source body of a symbol (function/method/type), resolved via LSP documentSymbols. Cheap diff base before calling lsp_edit_symbol \u2014 you only ship the new body, not the old one. Accepts a dotted path like \"Runner.Run\". Requires a project root marker (tsconfig.json/package.json/go.mod/Cargo.toml/pyproject.toml/.git) at-or-above the path.",
    promptSnippet:
      "Read a symbol's current body without echoing the whole file. Pair with lsp_edit_symbol.",
    parameters: Type.Object({
      path: Type.String({ description: "File path (relative to cwd or absolute)." }),
      symbol: Type.String({
        description:
          'Symbol name (supports dotted paths like "Runner.Run"). Resolved via documentSymbols.',
      }),
      workspaceRoot: Type.Optional(
        Type.String({ description: "Override the workspace root for this call." }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const langRes = await resolveLanguageForPath(pi, ctx, params.path);
      if (langRes.errorResult) return langRes.errorResult;
      const lang = langRes.lang!;
      const root = workspaceRootFor(ctx, params.workspaceRoot);
      const absPath = toAbsPath(params.path, root);

      const acq = await acquireServer(pi, ctx, manager, lang, root);
      if (!acq.server) return errorResult(acq.error!);
      const server = acq.server;

      await server.ensureOpen(absPath);
      const result = await server.request<unknown>("textDocument/documentSymbol", {
        textDocument: { uri: pathToFileURL(absPath).toString() },
      });
      const found = findSymbolRanges(result, params.symbol);
      if (!found) {
        return errorResult(`Symbol "${params.symbol}" not found in ${formatPath(absPath, root)}.`);
      }

      const text = await readFile(absPath, "utf8");
      const start = offsetForPosition(text, found.fullRange.start.line, found.fullRange.start.character);
      const end = offsetForPosition(text, found.fullRange.end.line, found.fullRange.end.character);
      const body = text.slice(start, end);
      const startOne = lspToOneBased(found.fullRange.start);
      const endOne = lspToOneBased(found.fullRange.end);
      const header = `${formatPath(absPath, root)}:${startOne.line}-${endOne.line} (symbol "${params.symbol}")`;
      return textResultWithHint(server, `${header}\n${body}`);
    },
  });

  // ── lsp_edit_symbol ────────────────────────────────────────────────────────

  pi.registerTool({
    name: "lsp_edit_symbol",
    label: "LSP Edit Symbol",
    description:
      "Replace a symbol's full source range (resolved via LSP documentSymbols) with `newBody`. You ship only the new text \u2014 no `oldText` echo, no whitespace fragility. The replaced range covers the entire symbol declaration including signature/header. After writing, the file is re-synced to the LSP and (by default) errors are reported. `newBody` must be syntactically valid; if it isn't, the file is left in the broken state and the diagnostics will say so. Use plain `edit` for tiny in-body tweaks where rewriting the whole symbol is overkill.",
    promptSnippet:
      "Symbol-anchored whole-body replacement. No oldText needed. Auto-runs diagnostics.",
    parameters: Type.Object({
      path: Type.String({ description: "File path (relative to cwd or absolute)." }),
      symbol: Type.String({
        description:
          'Symbol to replace (supports dotted paths like "Runner.Run"). Resolved via documentSymbols.',
      }),
      newBody: Type.String({
        description:
          "New source for the symbol, including its signature/declaration line. Must end without a trailing newline if the surrounding file doesn't expect one.",
      }),
      runDiagnostics: Type.Optional(
        Type.Boolean({
          description:
            "Run lsp_diagnostics on the file after writing and include the summary in the result. Default true.",
        }),
      ),
      workspaceRoot: Type.Optional(
        Type.String({ description: "Override the workspace root for this call." }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const langRes = await resolveLanguageForPath(pi, ctx, params.path);
      if (langRes.errorResult) return langRes.errorResult;
      const lang = langRes.lang!;
      const root = workspaceRootFor(ctx, params.workspaceRoot);
      const absPath = toAbsPath(params.path, root);

      const acq = await acquireServer(pi, ctx, manager, lang, root);
      if (!acq.server) return errorResult(acq.error!);
      const server = acq.server;

      await server.ensureOpen(absPath);
      const symResult = await server.request<unknown>("textDocument/documentSymbol", {
        textDocument: { uri: pathToFileURL(absPath).toString() },
      });
      const found = findSymbolRanges(symResult, params.symbol);
      if (!found) {
        return errorResult(`Symbol "${params.symbol}" not found in ${formatPath(absPath, root)}.`);
      }

      const text = await readFile(absPath, "utf8");
      const start = offsetForPosition(text, found.fullRange.start.line, found.fullRange.start.character);
      const end = offsetForPosition(text, found.fullRange.end.line, found.fullRange.end.character);
      const newText = text.slice(0, start) + params.newBody + text.slice(end);
      await writeAndInvalidate(absPath, newText, cache, manager);

      const startOne = lspToOneBased(found.fullRange.start);
      const endOne = lspToOneBased(found.fullRange.end);
      const oldLines = end > start ? text.slice(start, end).split("\n").length : 0;
      const newLines = params.newBody.length > 0 ? params.newBody.split("\n").length : 0;
      const header = `✓ wrote ${formatPath(absPath, root)} (replaced L${startOne.line}-${endOne.line}, ${oldLines}→${newLines} lines)`;

      if (params.runDiagnostics === false) {
        return textResultWithHint(server, header);
      }

      // Re-sync the new content to the LSP and wait for fresh diagnostics.
      await server.ensureOpen(absPath);
      const diagSummary = await summarizeDiagnostics(server, absPath, root);
      return textResultWithHint(server, `${header}\n${diagSummary}`);
    },
  });

  // ── lsp_rename_symbol ──────────────────────────────────────────────────────

  pi.registerTool({
    name: "lsp_rename_symbol",
    label: "LSP Rename Symbol",
    description:
      "Workspace-wide rename via `textDocument/rename`. The LSP returns a WorkspaceEdit covering every reference; we apply it directly across all touched files (write + invalidate caches per file). Catches usages a textual grep would miss (struct embeds, interface implementations, generics) and avoids touching unrelated string matches. Set `dryRun: true` to preview the affected files without writing. Diagnostics are run on the origin file by default.",
    promptSnippet:
      "Workspace-wide rename. Applies LSP WorkspaceEdit across all files at once.",
    parameters: Type.Object({
      path: Type.String({ description: "File path containing the symbol (relative or absolute)." }),
      symbol: Type.String({
        description:
          'Symbol to rename (supports dotted paths like "Runner.Run"). Resolved via documentSymbols; rename is anchored at the identifier.',
      }),
      newName: Type.String({ description: "New identifier name." }),
      dryRun: Type.Optional(
        Type.Boolean({
          description:
            "If true, return the planned file list without writing anything. Default false.",
        }),
      ),
      runDiagnostics: Type.Optional(
        Type.Boolean({
          description: "Run lsp_diagnostics on the origin file after rename. Default true.",
        }),
      ),
      workspaceRoot: Type.Optional(
        Type.String({ description: "Override the workspace root for this call." }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const langRes = await resolveLanguageForPath(pi, ctx, params.path);
      if (langRes.errorResult) return langRes.errorResult;
      const lang = langRes.lang!;
      const root = workspaceRootFor(ctx, params.workspaceRoot);
      const absPath = toAbsPath(params.path, root);

      const acq = await acquireServer(pi, ctx, manager, lang, root);
      if (!acq.server) return errorResult(acq.error!);
      const server = acq.server;

      await server.ensureOpen(absPath);
      const symResult = await server.request<unknown>("textDocument/documentSymbol", {
        textDocument: { uri: pathToFileURL(absPath).toString() },
      });
      const found = findSymbolRanges(symResult, params.symbol);
      if (!found) {
        return errorResult(`Symbol "${params.symbol}" not found in ${formatPath(absPath, root)}.`);
      }

      const wsEdit = (await server.request<WorkspaceEditLike | null>("textDocument/rename", {
        textDocument: { uri: pathToFileURL(absPath).toString() },
        position: found.selectionRange.start,
        newName: params.newName,
      })) ?? {};

      // Pre-compute affected file list for both dryRun and the result summary.
      const affected = new Map<string, number>();
      if (wsEdit.documentChanges) {
        for (const dc of wsEdit.documentChanges) {
          if (!("textDocument" in dc)) continue;
          const path = fileURLToPath(dc.textDocument.uri);
          affected.set(path, (affected.get(path) ?? 0) + dc.edits.length);
        }
      } else if (wsEdit.changes) {
        for (const [uri, edits] of Object.entries(wsEdit.changes)) {
          affected.set(fileURLToPath(uri), edits.length);
        }
      }

      if (affected.size === 0) {
        return errorResult(
          `LSP returned no edits for rename "${params.symbol}" → "${params.newName}". ` +
            `Either the symbol can't be renamed at this position, or the LSP doesn't support textDocument/rename.`,
        );
      }

      if (params.dryRun) {
        const lines: string[] = [`(dry run) would rename "${params.symbol}" → "${params.newName}":`];
        for (const [path, hunks] of [...affected].sort()) {
          lines.push(`  ${formatPath(path, root)}  (${hunks} edit${hunks === 1 ? "" : "s"})`);
        }
        return textResultWithHint(server, lines.join("\n"));
      }

      const applied = await applyWorkspaceEdit(wsEdit, cache, manager);
      const lines: string[] = [
        `✓ renamed "${params.symbol}" → "${params.newName}" across ${applied.filesChanged.length} file(s), ${applied.totalEdits} edit(s):`,
      ];
      for (const f of applied.filesChanged.sort((a, b) => a.path.localeCompare(b.path))) {
        lines.push(`  ${formatPath(f.path, root)}  (${f.hunks} edit${f.hunks === 1 ? "" : "s"})`);
      }

      if (params.runDiagnostics !== false) {
        await server.ensureOpen(absPath);
        lines.push("");
        lines.push(await summarizeDiagnostics(server, absPath, root));
      }

      return textResultWithHint(server, lines.join("\n"));
    },
  });

  // ── lsp_install ───────────────────────────────────────────────────────────────
  // Add a language to the active LSP registry. If the chosen LSP isn't on PATH,
  // prompts to install it (yes/no) and runs the install command. Persists the
  // entry to languages.json on success.

  pi.registerTool({
    name: "lsp_install",
    label: "LSP Install",
    description:
      "Add a language to the active LSP config (~/.pi/agent/extensions/lsp/languages.json). Picks an LSP from the catalog (prompting when there are multiple options for that language), installs the binary if missing (with your confirmation), and writes the entry. After this completes, lsp_* tools can use the language.",
    promptSnippet:
      "Register an LSP for a language. Resolves a catalog entry, installs if needed, writes languages.json.",
    parameters: Type.Object({
      language: Type.String({
        description:
          "Language id to register (e.g. \"python\", \"go\", \"typescript\"). Catalog languages: " +
          (catalogLanguages().sort().join(", ") || "(empty)") +
          ". For an unknown id you should edit languages.json directly with a custom entry.",
      }),
      command: Type.Optional(
        Type.String({
          description:
            "Optional explicit catalog command to use (e.g. \"pylsp\" instead of \"pyright-langserver\"). When omitted, the user is prompted if the language has multiple catalog entries.",
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await runInstallFlow(pi, ctx, params.language, params.command);
      if (result.lang) {
        const lines: string[] = [];
        lines.push(`✅ Registered "${result.lang.id}" → ${result.lang.command}` +
          (result.lang.args && result.lang.args.length > 0 ? ` ${result.lang.args.join(" ")}` : ""));
        lines.push(`Extensions: ${result.lang.extensions.join(" ")}`);
        lines.push(`Persisted to: ${languagesConfigPath()}`);
        return textResult(lines.join("\n"));
      }
      if (result.cancelled) {
        return errorResult(
          `Install for "${params.language}" was cancelled. Re-run lsp_install when ready.`,
        );
      }
      return errorResult(result.error ?? "Install flow failed.");
    },
  });

  // ── lsp_scan ─────────────────────────────────────────────────────────────────
  // Walk the catalog, find every binary already on PATH, and offer to add
  // each (or all at once) to the active registry. The fast path to a working
  // setup when you already have several LSPs installed locally.

  pi.registerTool({
    name: "lsp_scan",
    label: "LSP Scan",
    description:
      "Scan PATH for every LSP listed in the catalog and offer to add the ones already installed to languages.json. No installs are performed; this is the zero-friction first-run command.",
    promptSnippet: "Find LSPs already installed locally and add them to the active LSP config.",
    parameters: Type.Object({
      autoAdd: Type.Optional(
        Type.Boolean({
          description:
            "If true, add every locally-installed catalog entry without prompting per-entry. Default false.",
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const found: Array<{ entry: CatalogEntry; binary: string }> = [];
      for (const entry of CATALOG) {
        const bin = await resolveBinary({
          id: entry.language,
          extensions: entry.extensions,
          command: entry.command,
          args: entry.args,
          installCommand: entry.installCommand,
          installNotes: entry.installNotes,
          fallbackPaths: entry.fallbackPaths,
        });
        if (bin) found.push({ entry, binary: bin });
      }

      if (found.length === 0) {
        return textResult(
          `No catalog LSPs found on PATH. Catalog languages: ${catalogLanguages().sort().join(", ") || "(empty)"}.`,
        );
      }

      // De-dupe per language: prefer the catalog's first entry per language
      // (closest to "recommended default") that's actually installed.
      const perLang = new Map<string, { entry: CatalogEntry; binary: string }>();
      for (const f of found) {
        if (!perLang.has(f.entry.language)) perLang.set(f.entry.language, f);
      }
      const picks = [...perLang.values()];

      // Filter out languages that are already in the active registry with the
      // same command, so re-running scan is a no-op once configured.
      const fresh = picks.filter((p) => {
        const existing = languageById(p.entry.language);
        return !(existing && existing.command === p.entry.command);
      });

      if (fresh.length === 0) {
        const lines = [`All ${picks.length} locally-installed catalog LSPs are already in your active config.`];
        for (const p of picks) lines.push(`  ✓ ${p.entry.language.padEnd(14)} ${p.entry.command}  (${p.binary})`);
        return textResult(lines.join("\n"));
      }

      const overview = fresh
        .map((p) => `  ${p.entry.language.padEnd(14)} ${p.entry.command.padEnd(28)} ${p.binary}`)
        .join("\n");

      let confirmAdd = !!params.autoAdd;
      if (!confirmAdd) {
        if (!ctx.hasUI) {
          return textResult(
            `Found ${fresh.length} locally-installed LSP(s) not yet in active config:\n${overview}\n\nRe-run with autoAdd=true to add them all, or call lsp_install per language.`,
          );
        }
        confirmAdd = await ctx.ui.confirm(
          `Add ${fresh.length} LSP(s) to active config?`,
          `These were found on PATH but aren't yet registered:\n\n${overview}\n\nThey'll be written to ${languagesConfigPath()}.`,
        );
      }
      if (!confirmAdd) {
        return errorResult("User declined to add scan results.");
      }

      const written: string[] = [];
      for (const p of fresh) {
        try {
          writeActiveLanguageEntry(p.entry.language, {
            extensions: p.entry.extensions,
            command: p.entry.command,
            args: p.entry.args,
            installCommand: p.entry.installCommand,
            installNotes: p.entry.installNotes,
            languageIdMap: p.entry.languageIdMap,
          });
          written.push(`${p.entry.language} → ${p.entry.command}`);
        } catch (e) {
          return errorResult(
            `Wrote ${written.length} entries before failing on "${p.entry.language}": ${(e as Error).message}`,
          );
        }
      }
      reloadLanguageRegistry();
      return textResult(
        `✅ Added ${written.length} LSP(s) to ${languagesConfigPath()}:\n${written.map((w) => `  • ${w}`).join("\n")}`,
      );
    },
  });
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

/**
 * Wrap a successful tool result with the server's one-shot workspace hint, if any.
 * Centralized so every tool surfaces the hint identically without per-tool plumbing.
 */
function textResultWithHint(server: LspServer, text: string) {
  const hint = server.consumeWorkspaceHint();
  if (!hint) return textResult(text);
  return textResult(`[lsp workspace hint] ${hint}\n\n${text}`);
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: {},
    isError: true,
  };
}

export type { SessionCache };
export { SessionCache as SessionCacheImpl };
