/**
 * LSP server lifecycle: spawn, initialize, didOpen/didChange, idle timeout, crash recovery, shutdown.
 *
 * One LspServer per (language, workspaceRoot). Manager dedupes spawns and reaps idle/crashed servers.
 *
 * No vendored LSP type definitions — we use minimal inline shapes and rely on the JSON-RPC layer.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, access, readdir } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

export interface LanguageConfig {
  /** Pi-internal id. Also the default LSP languageId for didOpen unless `languageIdFor` overrides per-file. */
  id: string;
  /** File extensions (with leading dot) handled by this server */
  extensions: string[];
  /** Binary name to spawn */
  command: string;
  /** Args passed to the binary */
  args?: string[];
  /** Human-readable install command shown to the user */
  installCommand: string;
  /** Notes shown alongside the install command (e.g. non-mac alternatives) */
  installNotes?: string;
  /** Extra paths to check if `command -v` fails (resolved at lookup time) */
  fallbackPaths?: () => Promise<string[]>;
  /**
   * Optional per-file LSP languageId. Defaults to `id` for every file.
   * Used by servers that handle multiple flavours under one binary, e.g.
   * typescript-language-server expects "typescript" / "typescriptreact" /
   * "javascript" / "javascriptreact" depending on the file extension.
   */
  languageIdFor?: (absPath: string) => string;
  /**
   * Optional probe run once per (language, workspaceRoot) on first spawn.
   * Return a one-line hint string to surface on the first tool result, or null for none.
   * Use this to flag misconfigured workspaces (e.g. Go monorepo without go.work).
   * Must be cheap — it runs synchronously before the first request.
   */
  probeWorkspace?: (workspaceRoot: string) => Promise<string | null>;
  /**
   * Server-specific initialization options (LSP `initialize.initializationOptions`).
   * For gopls, e.g. { buildFlags: ["-tags=integration"] } so build-tagged files
   * (integration tests etc.) are included in references / diagnostics / symbols.
   * Forwarded verbatim to the server.
   */
  initializationOptions?: Record<string, unknown>;
}

/**
 * Generic helper for the common case: "root has no project marker but has N children that do, and no workspace marker".
 * Returns counts so each language can format its own hint.
 */
export async function detectMonorepoLayout(
  workspaceRoot: string,
  projectMarkers: string[],
  workspaceMarkers: string[],
): Promise<{
  hasProjectMarkerAtRoot: boolean;
  hasWorkspaceMarkerAtRoot: boolean;
  childrenWithProjectMarker: string[];
}> {
  const has = async (p: string) => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  };
  let hasProjectMarkerAtRoot = false;
  for (const m of projectMarkers) {
    if (await has(join(workspaceRoot, m))) {
      hasProjectMarkerAtRoot = true;
      break;
    }
  }
  let hasWorkspaceMarkerAtRoot = false;
  for (const m of workspaceMarkers) {
    if (await has(join(workspaceRoot, m))) {
      hasWorkspaceMarkerAtRoot = true;
      break;
    }
  }
  const children: string[] = [];
  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    entries = await readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    /* unreadable; treat as empty */
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "vendor") continue;
    for (const m of projectMarkers) {
      if (await has(join(workspaceRoot, e.name, m))) {
        children.push(e.name);
        break;
      }
    }
  }
  return { hasProjectMarkerAtRoot, hasWorkspaceMarkerAtRoot, childrenWithProjectMarker: children };
}

// --------------------------------------------------------------------------------------
// Language registry & catalog
//
// Two distinct things:
//   1. CATALOG — the recommendation database. Hardcoded here. Multiple entries
//      per language are allowed (e.g. python: pyright, pylsp, basedpyright).
//      The CATALOG is *not* the active registry: it's only consulted by the
//      `lsp_install` flow to figure out which binary to install for a given
//      language id, and which function-typed niceties (probeWorkspace,
//      languageIdMap, fallbackPaths) to attach when an entry is added.
//   2. ACTIVE REGISTRY — the user's `~/.pi/agent/extensions/lsp/languages.json`.
//      This is the truth: only languages listed here are usable by `lsp_*`
//      tools. Empty by default. Modified through `lsp_install` (or by hand).
//
// Resolution is purely by file extension. There is no closed list of
// supported languages anywhere in the extension — if you don't like the
// catalog's recommendations for python, you can hand-edit languages.json with
// any binary you want.
// --------------------------------------------------------------------------------------

/**
 * One LSP recommendation. The catalog can hold several entries per `language`,
 * representing alternative LSPs the user can pick from at install time.
 */
export interface CatalogEntry {
  language: string;
  command: string;
  args?: string[];
  extensions: string[];
  installCommand: string;
  installNotes?: string;
  fallbackPaths?: () => Promise<string[]>;
  /** Per-extension languageId override (e.g. ".tsx" → "typescriptreact"). */
  languageIdMap?: Record<string, string>;
  probeWorkspace?: (workspaceRoot: string) => Promise<string | null>;
}

export const CATALOG: CatalogEntry[] = [
  // ---- Go ----
  {
    language: "go",
    command: "gopls",
    extensions: [".go"],
    installCommand: "go install golang.org/x/tools/gopls@latest",
    installNotes: "Requires Go on PATH. Binary lands in $(go env GOPATH)/bin.",
    fallbackPaths: async () => {
      const home = process.env.HOME ?? "";
      const out: string[] = [];
      if (process.env.GOPATH) out.push(`${process.env.GOPATH}/bin/gopls`);
      if (home) out.push(`${home}/go/bin/gopls`);
      return out;
    },
    probeWorkspace: async (root) => {
      const layout = await detectMonorepoLayout(root, ["go.mod"], ["go.work"]);
      if (
        !layout.hasProjectMarkerAtRoot &&
        !layout.hasWorkspaceMarkerAtRoot &&
        layout.childrenWithProjectMarker.length >= 2
      ) {
        const list = layout.childrenWithProjectMarker.slice(0, 5).join(", ");
        const more =
          layout.childrenWithProjectMarker.length > 5
            ? `, +${layout.childrenWithProjectMarker.length - 5} more`
            : "";
        return `Workspace root has no go.mod and no go.work, but ${layout.childrenWithProjectMarker.length} sub-modules (${list}${more}). Cross-module references will resolve via the module cache, not local sources. To unify them, run \`go work init && go work use\` for each module dir at the root.`;
      }
      return null;
    },
  },

  // ---- Lua ----
  {
    language: "lua",
    command: "lua-language-server",
    extensions: [".lua"],
    installCommand: "brew install lua-language-server",
    installNotes:
      "Non-mac: download a release from https://github.com/LuaLS/lua-language-server/releases and put `lua-language-server` on PATH.",
  },

  // ---- Zig ----
  {
    language: "zig",
    command: "zls",
    extensions: [".zig", ".zon"],
    installCommand: "brew install zls",
    installNotes:
      "Non-mac: download a release from https://github.com/zigtools/zls/releases or build from source.",
  },

  // ---- TypeScript / JavaScript ----
  {
    language: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    installCommand: "npm install -g typescript typescript-language-server",
    installNotes:
      "Or: brew install typescript-language-server. The `typescript` package must be reachable too.",
    languageIdMap: {
      ".tsx": "typescriptreact",
      ".jsx": "javascriptreact",
      ".js": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
    },
    fallbackPaths: async () => {
      const home = process.env.HOME ?? "";
      const out: string[] = [
        "/opt/homebrew/bin/typescript-language-server",
        "/usr/local/bin/typescript-language-server",
      ];
      if (home) out.push(`${home}/.npm-global/bin/typescript-language-server`);
      return out;
    },
    probeWorkspace: async (root) => {
      const layout = await detectMonorepoLayout(
        root,
        ["tsconfig.json", "jsconfig.json", "package.json"],
        ["pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json"],
      );
      if (
        !layout.hasProjectMarkerAtRoot &&
        !layout.hasWorkspaceMarkerAtRoot &&
        layout.childrenWithProjectMarker.length >= 2
      ) {
        const list = layout.childrenWithProjectMarker.slice(0, 5).join(", ");
        const more =
          layout.childrenWithProjectMarker.length > 5
            ? `, +${layout.childrenWithProjectMarker.length - 5} more`
            : "";
        return `Workspace root has no tsconfig.json/package.json but ${layout.childrenWithProjectMarker.length} sub-projects do (${list}${more}). typescript-language-server will treat each subdir as an isolated project; cross-project go-to-definition / find-references may not traverse. Consider opening the relevant subdir directly via workspaceRoot.`;
      }
      if (!layout.hasProjectMarkerAtRoot && !layout.hasWorkspaceMarkerAtRoot) {
        return `No tsconfig.json/jsconfig.json/package.json at workspace root. typescript-language-server will use an inferred config; cross-file resolution may be incomplete.`;
      }
      return null;
    },
  },

  // ---- Python (multiple options) ----
  {
    language: "python",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
    installCommand: "npm install -g pyright",
    installNotes: "Microsoft's Pyright. Static-analysis focused, very fast.",
  },
  {
    language: "python",
    command: "basedpyright-langserver",
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
    installCommand: "npm install -g basedpyright",
    installNotes: "Community fork of pyright with extra checks and stricter defaults.",
  },
  {
    language: "python",
    command: "pylsp",
    extensions: [".py", ".pyi"],
    installCommand: "pip install python-lsp-server",
    installNotes: "python-lsp-server. Plugin-friendly; supports Jedi, pylint, ruff, etc. via plugins.",
  },

  // ---- Rust ----
  {
    language: "rust",
    command: "rust-analyzer",
    extensions: [".rs"],
    installCommand: "rustup component add rust-analyzer",
    installNotes: "Or: brew install rust-analyzer / nix-env -iA nixpkgs.rust-analyzer.",
  },

  // ---- C / C++ / Objective-C ----
  {
    language: "c",
    command: "clangd",
    extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".c++", ".hpp", ".hh", ".hxx", ".h++", ".m", ".mm"],
    installCommand: "brew install llvm",
    installNotes:
      "clangd ships inside LLVM. Linux: `apt install clangd` / `dnf install clang-tools-extra`. macOS often has it under Xcode — try `xcrun --find clangd`.",
    fallbackPaths: async () => {
      const out = [
        "/opt/homebrew/opt/llvm/bin/clangd",
        "/usr/local/opt/llvm/bin/clangd",
      ];
      try {
        const { execFile } = await import("node:child_process");
        const xcrun = await new Promise<string | null>((res) => {
          execFile("xcrun", ["--find", "clangd"], (err, stdout) => {
            res(err ? null : stdout.trim() || null);
          });
        });
        if (xcrun) out.push(xcrun);
      } catch {
        /* ignore */
      }
      return out;
    },
  },

  // ---- Bash ----
  {
    language: "bash",
    command: "bash-language-server",
    args: ["start"],
    extensions: [".sh", ".bash", ".zsh"],
    installCommand: "npm install -g bash-language-server",
  },

];


// ---- Active registry (languages.json) -------------------------------------------------

/**
 * Path to the user-editable language config file. Honours PI_LSP_LANGUAGES_PATH
 * for tests / non-default setups; otherwise lives next to permission.json under
 * PI_CODING_AGENT_DIR (default `~/.pi/agent`) so it travels with other agent
 * config.
 */
export function languagesConfigPath(): string {
  if (process.env.PI_LSP_LANGUAGES_PATH) return process.env.PI_LSP_LANGUAGES_PATH;
  const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(root, "extensions", "lsp", "languages.json");
}

/** JSON-safe view of LanguageConfig. Function fields cannot be expressed in JSON. */
interface UserLanguageEntry {
  extensions?: unknown;
  command?: unknown;
  args?: unknown;
  installCommand?: unknown;
  installNotes?: unknown;
  /** Optional per-extension languageId map; matches CatalogEntry.languageIdMap. */
  languageIdMap?: unknown;
  /** Server-specific LSP initialization options forwarded verbatim. */
  initializationOptions?: unknown;
}

let _registry: Record<string, LanguageConfig> | null = null;
let _registryConfigError: string | undefined;
let _userEntryCount = 0;

/**
 * Locate a catalog entry whose `command` matches. Used to inherit function-typed
 * niceties (probeWorkspace, fallbackPaths, languageIdMap) when a user entry's
 * command name matches a known catalog binary. The user is free to point
 * `command` at something the catalog doesn't know — in that case there's just
 * no inherited behaviour, which is fine.
 */
function findCatalogByCommand(command: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.command === command);
}

/** All catalog entries advertised for a given language id. Order = preference. */
export function findCatalogByLanguage(language: string): CatalogEntry[] {
  return CATALOG.filter((e) => e.language === language);
}

/** All distinct language ids present in the catalog. */
export function catalogLanguages(): string[] {
  const out = new Set<string>();
  for (const e of CATALOG) out.add(e.language);
  return [...out];
}

/**
 * Best-effort language id for a file extension via the catalog. Returns the
 * language of the first catalog entry that lists `ext` (catalogs are
 * deterministic, so this is stable). Used by `lsp_*` tools to figure out
 * which language to feed to the install flow when the active registry doesn't
 * have an entry for the file's extension.
 */
export function catalogLanguageForExtension(extOrPath: string): string | undefined {
  const lower = extOrPath.toLowerCase();
  for (const e of CATALOG) {
    for (const x of e.extensions) {
      if (lower === x.toLowerCase() || lower.endsWith(x.toLowerCase())) return e.language;
    }
  }
  return undefined;
}

function makeLanguageIdFor(
  map: Record<string, string> | undefined,
  fallback: string,
): ((p: string) => string) | undefined {
  if (!map || Object.keys(map).length === 0) return undefined;
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lowered[k.toLowerCase()] = v;
  return (absPath: string) => {
    const lower = absPath.toLowerCase();
    for (const [ext, id] of Object.entries(lowered)) {
      if (lower.endsWith(ext)) return id;
    }
    return fallback;
  };
}

function parseUserEntry(
  id: string,
  entry: UserLanguageEntry,
  errors: string[],
): LanguageConfig | null {
  if (!entry || typeof entry !== "object") {
    errors.push(`languages.json: "${id}" is not an object`);
    return null;
  }
  const extensions = Array.isArray(entry.extensions)
    ? entry.extensions.filter((x): x is string => typeof x === "string")
    : undefined;
  const command = typeof entry.command === "string" ? entry.command : undefined;
  if (!extensions || extensions.length === 0) {
    errors.push(`languages.json: "${id}" missing "extensions" array`);
    return null;
  }
  if (!command) {
    errors.push(`languages.json: "${id}" missing "command"`);
    return null;
  }
  const args = Array.isArray(entry.args)
    ? entry.args.filter((x): x is string => typeof x === "string")
    : undefined;
  const installCommand =
    typeof entry.installCommand === "string"
      ? entry.installCommand
      : `# add an installCommand for "${id}" in ${languagesConfigPath()}`;
  const installNotes =
    typeof entry.installNotes === "string" ? entry.installNotes : undefined;

  // Inherit function-typed niceties when the command matches a catalog entry.
  const catalog = findCatalogByCommand(command);

  // languageIdMap: prefer the user's explicit map, else inherit from catalog.
  let langIdMap: Record<string, string> | undefined;
  if (entry.languageIdMap && typeof entry.languageIdMap === "object" && !Array.isArray(entry.languageIdMap)) {
    langIdMap = {};
    for (const [k, v] of Object.entries(entry.languageIdMap as Record<string, unknown>)) {
      if (typeof v === "string") langIdMap[k] = v;
    }
  } else if (catalog?.languageIdMap) {
    langIdMap = catalog.languageIdMap;
  }

  // initializationOptions: forwarded as-is when it's a plain object.
  let initOpts: Record<string, unknown> | undefined;
  if (
    entry.initializationOptions &&
    typeof entry.initializationOptions === "object" &&
    !Array.isArray(entry.initializationOptions)
  ) {
    initOpts = entry.initializationOptions as Record<string, unknown>;
  }

  return {
    id,
    extensions,
    command,
    args: args ?? catalog?.args,
    installCommand,
    installNotes: installNotes ?? catalog?.installNotes,
    fallbackPaths: catalog?.fallbackPaths,
    languageIdFor: makeLanguageIdFor(langIdMap, id),
    probeWorkspace: catalog?.probeWorkspace,
    initializationOptions: initOpts,
  };
}

function loadRegistry(): Record<string, LanguageConfig> {
  if (_registry) return _registry;
  const merged: Record<string, LanguageConfig> = {};
  const errors: string[] = [];
  _userEntryCount = 0;

  const cfgPath = languagesConfigPath();
  if (existsSync(cfgPath)) {
    try {
      const raw = readFileSync(cfgPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, UserLanguageEntry>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [id, entry] of Object.entries(parsed)) {
          const cfg = parseUserEntry(id, entry, errors);
          if (cfg) {
            merged[id] = cfg;
            _userEntryCount++;
          }
        }
      } else {
        errors.push("languages.json: top-level value must be an object");
      }
    } catch (e) {
      errors.push(`languages.json: ${(e as Error).message}`);
    }
  }

  _registryConfigError = errors.length > 0 ? errors.join("; ") : undefined;
  _registry = merged;
  return _registry;
}

/** Force the registry to be re-read on next access. */
export function reloadLanguageRegistry(): void {
  _registry = null;
  _registryConfigError = undefined;
  _userEntryCount = 0;
}

/** Errors encountered the last time languages.json was parsed, or undefined if clean. */
export function getLanguagesConfigError(): string | undefined {
  loadRegistry();
  return _registryConfigError;
}

/** Number of entries currently active. Same as Object.keys(getAllLanguages()).length. */
export function getUserLanguageCount(): number {
  loadRegistry();
  return _userEntryCount;
}

/** All registered language ids. */
export function getAllLanguageIds(): string[] {
  return Object.keys(loadRegistry());
}

/** All registered language entries. Caller must not mutate. */
export function getAllLanguages(): Record<string, LanguageConfig> {
  return loadRegistry();
}

export function languageForPath(filePath: string): LanguageConfig | undefined {
  const registry = loadRegistry();
  const lower = filePath.toLowerCase();
  for (const lang of Object.values(registry)) {
    for (const ext of lang.extensions) {
      if (lower.endsWith(ext)) return lang;
    }
  }
  return undefined;
}

export function languageById(id: string): LanguageConfig | undefined {
  return loadRegistry()[id];
}

// ---- Mutating the active registry from `lsp_install` ----------------------------------

/**
 * Persist a language entry to languages.json. If `id` already exists, it's
 * replaced. Other entries are preserved verbatim so hand-written keys/comments
 * survive in-place.
 *
 * The on-disk format is the JSON-safe subset of LanguageConfig. Function-typed
 * niceties are not written; they're re-applied via the catalog at load time.
 */
export function writeActiveLanguageEntry(
  id: string,
  entry: { extensions: string[]; command: string; args?: string[]; installCommand?: string; installNotes?: string; languageIdMap?: Record<string, string> },
): void {
  const cfgPath = languagesConfigPath();
  let existing: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    try {
      const raw = readFileSync(cfgPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt file: don't blow away user's work — instead, write a sibling and let them merge.
      // Simplest safe behaviour: throw so the caller can surface a clear error.
      throw new Error(`Refusing to overwrite ${cfgPath}: existing file isn't valid JSON. Fix or delete it manually.`);
    }
  }
  // Build the JSON-friendly view of the entry.
  const writeable: Record<string, unknown> = {
    extensions: entry.extensions,
    command: entry.command,
  };
  if (entry.args && entry.args.length > 0) writeable.args = entry.args;
  if (entry.installCommand) writeable.installCommand = entry.installCommand;
  if (entry.installNotes) writeable.installNotes = entry.installNotes;
  if (entry.languageIdMap && Object.keys(entry.languageIdMap).length > 0) {
    writeable.languageIdMap = entry.languageIdMap;
  }
  existing[id] = writeable;
  // Pretty-print, sorted by key for determinism.
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(existing).sort()) ordered[k] = existing[k];
  // Use sync fs to keep the call signature non-async; persisting languages.json
  // is rare (only on `lsp_install` and friends), and the file is small.
  mkdirSync(join(cfgPath, ".."), { recursive: true });
  writeFileSync(cfgPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  reloadLanguageRegistry();
}

/** Remove a language id from languages.json. No-op if not present. */
export function removeActiveLanguageEntry(id: string): boolean {
  const cfgPath = languagesConfigPath();
  if (!existsSync(cfgPath)) return false;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (!(id in parsed)) return false;
  delete parsed[id];
  writeFileSync(cfgPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  reloadLanguageRegistry();
  return true;
}

/** Render a copy-pasteable JSON template for a missing extension. */
export function languagesConfigTemplate(extension: string): string {
  const id = (extension.replace(/^\./, "").toLowerCase() || "yourlang").replace(/[^a-z0-9_-]/g, "");
  const example = {
    [id || "yourlang"]: {
      extensions: [extension.startsWith(".") ? extension : `.${extension}`],
      command: "your-language-server",
      args: ["--stdio"],
      installCommand: "brew install your-language-server",
      installNotes: "optional human-readable notes",
    },
  };
  return JSON.stringify(example, null, 2);
}

export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface Location {
  uri: string;
  range: Range;
}
export interface Diagnostic {
  range: Range;
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}

const IDLE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
/**
 * How long we'll wait for an LSP server to reply to `initialize`.
 * If it doesn't, the server is killed and `initPromise` rejects with a clear
 * error so callers (request / ensureOpen) fail fast instead of hanging.
 * Common reason for hangs: the target file is outside any project root
 * (no tsconfig.json/package.json/Cargo.toml/etc.) and the server tries to
 * synthesise a workspace it never actually finishes setting up.
 */
const INIT_TIMEOUT_MS = 15 * 1000;

/** Hash that's stable across runs and cheap. Not cryptographic. */
function hashContent(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + s.length.toString(36);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a binary to an absolute path or `null` if missing.
 * Tries `command -v` first, then language-specific fallback paths.
 */
export async function resolveBinary(lang: LanguageConfig): Promise<string | null> {
  // Try PATH
  try {
    const { execFile } = await import("node:child_process");
    const path = await new Promise<string | null>((resolveP) => {
      execFile("sh", ["-c", `command -v ${lang.command}`], (err, stdout) => {
        if (err) resolveP(null);
        else resolveP(stdout.trim() || null);
      });
    });
    if (path) return path;
  } catch {
    /* ignore */
  }
  // Try fallback paths
  const fallbacks = (await lang.fallbackPaths?.()) ?? [];
  for (const p of fallbacks) {
    if (await exists(p)) return p;
  }
  return null;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class LspServer {
  private readonly proc: ChildProcess;
  private readonly conn: MessageConnection;
  private readonly initPromise: Promise<void>;
  /** Tracks open documents and their last-synced content hash. */
  private readonly openFiles = new Map<string, { version: number; hash: string }>();
  private readonly diagnostics = new Map<string, Diagnostic[]>();
  /** Dispatched on every `textDocument/publishDiagnostics`. */
  private readonly diagListeners = new Set<(absPath: string, diags: Diagnostic[]) => void>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private dead = false;
  private shuttingDown = false;
  /** Captured stderr tail for crash diagnostics. */
  private stderrTail = "";
  /** One-shot workspace setup hint, surfaced on the first tool result then cleared. */
  private pendingWorkspaceHint: string | null = null;

  constructor(
    public readonly lang: LanguageConfig,
    public readonly workspaceRoot: string,
    public readonly binary: string,
    private readonly onDeath: (s: LspServer) => void,
  ) {
    this.proc = spawn(binary, lang.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: workspaceRoot,
      env: { ...process.env },
    });
    this.proc.on("error", () => {
      this.markDead();
    });
    this.proc.on("exit", () => {
      this.markDead();
    });
    this.proc.stderr?.on("data", (b: Buffer) => {
      this.stderrTail = (this.stderrTail + b.toString()).slice(-4096);
    });

    this.conn = createMessageConnection(
      new StreamMessageReader(this.proc.stdout!),
      new StreamMessageWriter(this.proc.stdin!),
    );

    // Single dispatch handler — vscode-jsonrpc onNotification only keeps the latest registered.
    this.conn.onNotification("textDocument/publishDiagnostics", (params: unknown) => {
      const p = params as { uri?: string; diagnostics?: Diagnostic[] } | undefined;
      if (!p?.uri) return;
      let abs: string;
      try {
        abs = fileURLToPath(p.uri);
      } catch {
        return;
      }
      const diags = p.diagnostics ?? [];
      this.diagnostics.set(abs, diags);
      for (const l of this.diagListeners) l(abs, diags);
    });
    // Silence chatty notifications.
    this.conn.onNotification("$/progress", () => {});
    this.conn.onNotification("window/logMessage", () => {});
    this.conn.onNotification("window/showMessage", () => {});
    this.conn.onNotification("telemetry/event", () => {});
    // Stub server-side requests we don't implement so the server doesn't hang.
    this.conn.onRequest("window/workDoneProgress/create", () => null);
    this.conn.onRequest("client/registerCapability", () => null);
    // Stub: we don't supply per-section settings. Returning null per item is
    // "no setting configured", which servers handle gracefully.
    this.conn.onRequest("workspace/configuration", (params: unknown) => {
      const items =
        (params as { items?: unknown[] } | undefined)?.items ?? [];
      return items.map(() => null);
    });

    this.conn.listen();
    this.initPromise = Promise.race([
      this.initialize(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          // Kill the proc so it doesn't linger; markDead will fire via the
          // `exit` listener and `onDeath` will clear it from the manager cache.
          try {
            this.proc.kill();
          } catch {
            /* ignore */
          }
          reject(
            new Error(
              `LSP server '${this.lang.id}' did not respond to 'initialize' within ${INIT_TIMEOUT_MS}ms ` +
                `(workspace root: ${this.workspaceRoot}). Server terminated. ` +
                `Common cause: target file is outside any project root (no tsconfig.json/package.json/etc.).`,
            ),
          );
        }, INIT_TIMEOUT_MS),
      ),
    ]);
    // Swallow the unhandled-rejection that vscode-jsonrpc would otherwise see;
    // every awaiter of initPromise still gets the rejection through their own await.
    this.initPromise.catch(() => {});
    this.resetIdle();
  }

  private async initialize(): Promise<void> {
    const rootUri = pathToFileURL(this.workspaceRoot + sep).toString();
    await this.conn.sendRequest("initialize", {
      processId: process.pid,
      clientInfo: { name: "pi-lsp", version: "0.1.0" },
      rootUri,
      rootPath: this.workspaceRoot,
      workspaceFolders: [{ uri: rootUri, name: this.workspaceRoot }],
      ...(this.lang.initializationOptions
        ? { initializationOptions: this.lang.initializationOptions }
        : {}),
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: false },
          references: {},
          implementation: { linkSupport: false },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: { relatedInformation: false },
        },
        workspace: {
          workspaceFolders: true,
          configuration: true,
          diagnostics: { refreshSupport: true },
          symbol: {
            symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) },
          },
        },
      },
    });
    await this.conn.sendNotification("initialized", {});
  }

  private resetIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.shutdown().catch(() => {});
    }, IDLE_MS);
  }

  private markDead(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.onDeath(this);
  }

  isDead(): boolean {
    return this.dead;
  }

  /** Read file from disk and notify the server (didOpen first time, didChange on content drift). */
  async ensureOpen(absPath: string): Promise<void> {
    await this.initPromise;
    let text: string;
    try {
      text = await readFile(absPath, "utf8");
    } catch (e) {
      throw new Error(`Cannot read ${absPath}: ${(e as Error).message}`);
    }
    const hash = hashContent(text);
    const existing = this.openFiles.get(absPath);
    const uri = pathToFileURL(absPath).toString();
    if (!existing) {
      this.openFiles.set(absPath, { version: 1, hash });
      const languageId = this.lang.languageIdFor?.(absPath) ?? this.lang.id;
      await this.conn.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
    } else if (existing.hash !== hash) {
      const version = existing.version + 1;
      this.openFiles.set(absPath, { version, hash });
      await this.conn.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
  }

  /** Force-resync the next time a file is touched (e.g. after an external edit). */
  invalidateFile(absPath: string): void {
    const cur = this.openFiles.get(absPath);
    if (cur) cur.hash = "";
    this.diagnostics.delete(absPath);
  }

  /** Send an LSP request with a timeout guard. Bumps the idle timer. */
  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.dead) throw new Error("LSP server has exited");
    await this.initPromise;
    this.resetIdle();
    return new Promise<T>((resolveP, rejectP) => {
      const t = setTimeout(() => {
        rejectP(new Error(`LSP request ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.conn.sendRequest(method, params).then(
        (v: unknown) => {
          clearTimeout(t);
          resolveP(v as T);
        },
        (e: Error) => {
          clearTimeout(t);
          rejectP(e);
        },
      );
    });
  }

  getDiagnostics(absPath: string): Diagnostic[] {
    return this.diagnostics.get(absPath) ?? [];
  }

  /** Resolve once diagnostics arrive for `absPath`, or after `timeoutMs` with whatever we have. */
  waitForDiagnostics(absPath: string, timeoutMs = 3000): Promise<Diagnostic[]> {
    if (this.diagnostics.has(absPath)) return Promise.resolve(this.diagnostics.get(absPath)!);
    return new Promise((resolveP) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.diagListeners.delete(listener);
      };
      const listener = (p: string, diags: Diagnostic[]) => {
        if (p === absPath) {
          cleanup();
          resolveP(diags);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        resolveP(this.diagnostics.get(absPath) ?? []);
      }, timeoutMs);
      this.diagListeners.add(listener);
    });
  }

  getStderrTail(): string {
    return this.stderrTail;
  }

  setWorkspaceHint(hint: string | null): void {
    this.pendingWorkspaceHint = hint;
  }

  /** Return the workspace hint if any, then clear it. Called on the first tool result per server. */
  consumeWorkspaceHint(): string | null {
    const h = this.pendingWorkspaceHint;
    this.pendingWorkspaceHint = null;
    return h;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.dead) {
      try {
        await Promise.race([
          this.conn.sendRequest("shutdown", null),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
        try {
          await this.conn.sendNotification("exit");
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    }
    try {
      this.conn.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        this.proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2000).unref();
    this.markDead();
  }
}

export class LspManager {
  private readonly servers = new Map<string, LspServer>();
  /** Clears any state owners care about when a server dies (e.g. caches). */
  onServerDeath: ((s: LspServer) => void) | undefined;

  private key(langId: string, root: string): string {
    return `${langId}::${root}`;
  }

  /** Get an existing server or spawn a new one. Returns null if the binary is missing. */
  async getOrSpawn(lang: LanguageConfig, workspaceRoot: string): Promise<LspServer | null> {
    const root = resolve(workspaceRoot);
    const k = this.key(lang.id, root);
    const existing = this.servers.get(k);
    if (existing && !existing.isDead()) return existing;
    if (existing) this.servers.delete(k);

    const binary = await resolveBinary(lang);
    if (!binary) return null;

    const server = new LspServer(lang, root, binary, (s) => {
      this.servers.delete(k);
      this.onServerDeath?.(s);
    });
    this.servers.set(k, server);

    // Run the language-specific workspace probe in the background.
    // Setting the hint asynchronously is safe — the first tool result that fires
    // after the probe completes will pick it up; earlier results just won't carry it.
    if (lang.probeWorkspace) {
      lang.probeWorkspace(root)
        .then((hint) => {
          if (hint) server.setWorkspaceHint(hint);
        })
        .catch(() => {
          /* probe failures are not user-facing */
        });
    }

    return server;
  }

  /** Apply a function across all active servers — used to broadcast file invalidations. */
  forEach(fn: (s: LspServer) => void): void {
    for (const s of this.servers.values()) fn(s);
  }

  async shutdownAll(): Promise<void> {
    const all = [...this.servers.values()];
    this.servers.clear();
    await Promise.allSettled(all.map((s) => s.shutdown()));
  }
}
