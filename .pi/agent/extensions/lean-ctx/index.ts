// pi-lean-ctx port for @earendil-works/pi-coding-agent
//
// Routes Pi's bash/read/grep/find/ls tools through the lean-ctx CLI binary on
// a per-call basis. Does NOT install shell aliases. Does NOT enable the MCP
// bridge from the upstream extension (dropped to remove the npm dep on
// @modelcontextprotocol/sdk).
//
// Source: https://github.com/yvgude/lean-ctx/blob/main/packages/pi-lean-ctx/extensions/index.ts
// Modifications:
//   - imports: @mariozechner/pi-coding-agent -> @earendil-works/pi-coding-agent
//   - imports: @mariozechner/pi-tui          -> @earendil-works/pi-tui
//   - imports: @sinclair/typebox             -> typebox
//   - removed McpBridge import + invocation (no MCP, no npm runtime deps)
//   - inlined CompressionStats type (was imported from ./types.js)

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createReadToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  getLanguageFromPath,
  highlightCode,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { recordSavings } from "../_shared/usage-store.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";

interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  percentSaved: number;
}

const CODE_EXTENSIONS = new Set([
  ".rs", ".ts", ".tsx", ".js", ".jsx", ".php", ".py", ".go",
  ".java", ".c", ".cc", ".cpp", ".cxx", ".cs", ".kt", ".swift", ".rb",
  ".vue", ".svelte", ".astro", ".html", ".css", ".scss", ".sass", ".less",
  ".lua", ".zig", ".nim", ".ex", ".exs", ".erl", ".hs", ".ml", ".mli",
  ".r", ".jl", ".dart", ".scala", ".groovy", ".pl", ".pm", ".sh", ".bash",
  ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".sql", ".graphql", ".gql",
  ".proto", ".thrift", ".tf", ".hcl", ".nix", ".dhall",
]);

const FULL_READ_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".json5", ".yaml", ".yml", ".toml",
  ".env", ".ini", ".xml", ".lock",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const CODE_FULL_READ_MAX_BYTES = 8 * 1024;
const CODE_SIGNATURES_MIN_BYTES = 96 * 1024;

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const lsSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
  depth: Type.Optional(Type.Number({ description: "Max recursion depth for the tree (default: 3, max: 10)" })),
});

// ---------------------------------------------------------------------------
// Tree implementation
// ---------------------------------------------------------------------------
//
// We re-implement lean-ctx's `ctx_tree` format in TypeScript instead of
// shelling out to `lean-ctx ls`. The CLI version routes through a daemon that
// silently jails the path argument to its sticky project_root, so any path
// outside that root comes back as the project_root tree (see daemon's
// ToolContext::resolve_path_sync -> pathjail::jail_path). The in-process Rust
// path (tools/ctx_tree.rs) walks paths correctly but isn't reachable from the
// CLI when a daemon is running, and there's no documented opt-out.
//
// Output format matches lean-ctx's compact tree:
//   {"  " * depth}{name}/ ({recursive_file_count})    for directories
//   {"  " * depth}{name}                              for files
//
// No filtering: every entry returned by readdir is shown, including dotfiles
// and gitignored files. The agent asked for `ls`, so it gets `ls`.
// Sort: alphabetical, matching upstream's sort_by_file_name.

function listEntriesSafe(dir: string): { name: string; isDir: boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

// Recursive file count, matching lean-ctx's `count_files_in_dir` (max depth 5,
// counts files only).
function countFilesRecursive(dir: string, remainingDepth: number): number {
  if (remainingDepth <= 0) return 0;
  let count = 0;
  for (const entry of listEntriesSafe(dir)) {
    if (entry.isDir) {
      count += countFilesRecursive(join(dir, entry.name), remainingDepth - 1);
    } else {
      count += 1;
    }
  }
  return count;
}

function buildTree(rootAbs: string, maxDepth: number): string {
  const lines: string[] = [];

  function walk(dir: string, currentDepth: number) {
    if (currentDepth >= maxDepth) return;
    for (const entry of listEntriesSafe(dir)) {
      const full = join(dir, entry.name);
      const indent = "  ".repeat(currentDepth);
      if (entry.isDir) {
        lines.push(`${indent}${entry.name}/ (${countFilesRecursive(full, 5)})`);
        walk(full, currentDepth + 1);
      } else {
        lines.push(`${indent}${entry.name}`);
      }
    }
  }

  walk(rootAbs, 0);
  return lines.join("\n");
}

const findSchema = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files" }),
  path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Lines of context around each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches (default: 100)" })),
});

const leanCtxSchema = Type.Object({
  args: Type.Array(
    Type.String({
      description:
        "Arguments after 'lean-ctx'. Example: ['overview'] or ['knowledge','recall','Pi']",
    }),
  ),
});

function shellQuote(value: string): string {
  if (!value) return "''";
  if (/^[A-Za-z0-9_./=:@,+%^-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveBinary(): string {
  const envBin = process.env.LEAN_CTX_BIN;
  if (envBin && existsSync(envBin)) return envBin;

  const home = homedir();
  const isWin = platform() === "win32";
  const candidates = isWin
    ? [
        resolve(home, ".cargo", "bin", "lean-ctx.exe"),
        resolve(home, "AppData", "Local", "lean-ctx", "lean-ctx.exe"),
      ]
    : [
        "/opt/homebrew/bin/lean-ctx",
        "/usr/local/bin/lean-ctx",
        resolve(home, ".cargo", "bin", "lean-ctx"),
        resolve(home, ".local", "bin", "lean-ctx"),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return "lean-ctx";
}

function normalizePathArg(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

async function chooseReadMode(path: string): Promise<"full" | "map" | "signatures"> {
  const ext = extname(path).toLowerCase();
  if (FULL_READ_EXTENSIONS.has(ext)) return "full";

  const fileStat = await stat(path);
  const size = fileStat.size;

  if (!CODE_EXTENSIONS.has(ext)) return size > 48 * 1024 ? "map" : "full";
  if (size >= CODE_SIGNATURES_MIN_BYTES) return "signatures";
  if (size >= CODE_FULL_READ_MAX_BYTES) return "map";
  return "full";
}

async function readSlice(path: string, offset?: number, limit?: number) {
  const content = await readFile(path, "utf8");
  const lines = content.split("\n");
  const startLine = offset ? Math.max(0, offset - 1) : 0;
  const endLine = limit ? startLine + limit : lines.length;
  const selected = lines.slice(startLine, endLine).join("\n");
  const truncation = truncateHead(selected, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  return { text: truncation.content, lines: lines.length, truncated: truncation.truncated };
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function clampStats(original: number, compressed: number): CompressionStats {
  const orig = Math.max(0, original);
  const comp = Math.max(0, Math.min(orig, compressed));
  const saved = Math.max(0, orig - comp);
  const percentSaved = orig > 0 ? Math.round((saved / orig) * 100) : 0;
  return { originalTokens: orig, compressedTokens: comp, percentSaved };
}

// lean-ctx's `read` subcommand suppresses the body when its session-tracker
// thinks we've already emitted this file in the agent's context. The stub
// looks like:
//   F1=foo.ts cached 4t 315L
//   File content unchanged since last read (same hash). Already in your context window.
// The dedup state lives in ~/.lean-ctx/context-os/context-os.db (SQLite),
// surviving daemon restarts. There is no documented invalidation API and no
// per-call bypass flag on the `read` subcommand (`--raw` only exists on
// `lean-ctx -c`, not on `read`). We detect the stub substring and fall back
// to local file contents at the call site — the stub is useless to the
// agent because it provides no actual content.
function looksLikeDedupStub(text: string): boolean {
  return /Already in your context window|content unchanged since last read/i.test(text);
}

function parseLeanCtxOutput(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let stats: CompressionStats | undefined;
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    const shellMatch = trimmed.match(/^\[lean-ctx:\s*(\d+)\s*→\s*(\d+)\s*tok,\s*-?(\d+)%\]$/);
    if (shellMatch) {
      stats = clampStats(Number(shellMatch[1]), Number(shellMatch[2]));
      continue;
    }

    const savedMatch = trimmed.match(/^\[(\d+)\s+tok saved(?:\s+\((\d+)%\))?\]$/);
    if (savedMatch) {
      const saved = Number(savedMatch[1]);
      const pct = savedMatch[2] ? Number(savedMatch[2]) : 0;
      if (pct > 0) {
        const original = Math.round((saved * 100) / pct);
        stats = clampStats(original, Math.max(0, original - saved));
      } else {
        stats = clampStats(saved, saved);
      }
      continue;
    }

    kept.push(line);
  }

  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(), stats };
}

function formatFooter(stats: CompressionStats) {
  const pct = stats.percentSaved > 0 ? `-${stats.percentSaved}%` : "0%";
  return `Compressed ${stats.originalTokens} → ${stats.compressedTokens} tokens (${pct})`;
}

function withFooter(text: string, opts?: {
  originalText?: string;
  limit?: number;
  always?: boolean;
  preferEstimate?: boolean;
}) {
  const parsed = parseLeanCtxOutput(text);
  const limited = limitLines(parsed.text, opts?.limit);

  let stats = parsed.stats;
  if (opts?.originalText !== undefined && (opts.preferEstimate || !stats)) {
    stats = clampStats(estimateTokens(opts.originalText), estimateTokens(limited.text));
  }
  if (!stats && opts?.always) {
    const tokens = estimateTokens(limited.text);
    stats = clampStats(tokens, tokens);
  }
  if (!stats) return { text: limited.text, stats: undefined, truncated: limited.truncated };

  const footer = formatFooter(stats);
  const base = limited.text.trimEnd();
  return {
    text: base ? `${base}\n\n${footer}` : footer,
    stats,
    truncated: limited.truncated,
  };
}

function limitLines(text: string, limit?: number) {
  if (!limit || limit <= 0) return { text, truncated: false };
  const lines = text.split("\n");
  if (lines.length <= limit) return { text, truncated: false };
  return {
    text: lines.slice(0, limit).join("\n") + `\n\n[Output truncated to ${limit} lines]`,
    truncated: true,
  };
}

function replaceTabs(text: string) {
  return text.replace(/\t/g, "    ");
}

function trimTrailingEmpty(lines: string[]) {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end);
}

function splitFooter(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  const match = normalized.match(/\n\n(Compressed \d+ → \d+ tokens \((?:-?\d+|0)%\))$/);
  if (!match) return { body: normalized, footer: undefined as string | undefined };
  return { body: normalized.slice(0, -match[0].length), footer: match[1] };
}

async function execLeanCtx(pi: ExtensionAPI, args: string[]) {
  const bin = resolveBinary();
  const result = await pi.exec(bin, args, { env: { ...process.env, LEAN_CTX_COMPRESS: "1", LEAN_CTX_NO_HOOK: "1" } });
  if (result.code !== 0) {
    const msg = (result.stderr || result.stdout || `lean-ctx failed: ${args.join(" ")}`).trim();
    throw new Error(msg);
  }
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Daemon isolation strategy (B1)
// ---------------------------------------------------------------------------
//
// The lean-ctx CLI binary auto-discovers a long-running daemon at
// `~/Library/Application Support/lean-ctx/daemon.sock`. The daemon owns
// session-scoped state (token counters, BUDGET WARNINGs, file cache) that
// persists across pi sessions because there's exactly one daemon and one
// `~/.lean-ctx/sessions/latest.json` for the whole machine. Result: a pi
// session inherits whatever cumulative state has accumulated since the
// daemon was first started, including stale BUDGET warnings that have
// nothing to do with this pi session's actual context.
//
// We picked B1 (kill the daemon, run lean-ctx as a stateless compression
// filter per call) because:
//   - The cache the daemon offers is not measurably useful for our workload
//     (observed cache hit rate ~0.7% across all reads; identical byte counts
//     for repeat reads of the same file with vs without the daemon).
//   - Per-call cold-start cost is ~80ms with or without the daemon for
//     simple compression invocations.
//   - Compression patterns are applied per call regardless of daemon
//     presence, so the savings (`tokens_saved`) we actually care about
//     stay intact.
//
// What B1 does not give us: isolation between concurrent pi sessions /
// subagents. Without a daemon there is no shared state to collide over,
// so the practical answer is "there's nothing to isolate".
//
// We rejected B2 (per-pi-session daemon on a private socket) because the
// CLI's daemon socket path is hardcoded to
// `~/Library/Application Support/lean-ctx/daemon.sock`. Strings analysis
// of the binary turned up no env var (`LEAN_CTX_DAEMON_SOCKET`,
// `LEAN_CTX_UDS`, etc.) to redirect it. `LEAN_CTX_HOST`/`LEAN_CTX_PORT`
// exist but target the HTTP dashboard / MCP server, not
// daemon-delegated compression. Revisit B2 if upstream adds a daemon
// socket override env var: spawn a private daemon on a per-pi-session
// socket in `pi.on("session_start", ...)`, point the CLI at it via the
// new env var, and tear it down on shutdown. That would give true
// per-pi-session isolation including for parallel pi sessions, with the
// daemon's cache/state intact.

export default async function (pi: ExtensionAPI) {
  // Session-scoped running totals for the saved-tokens footer slot.
  // Resets naturally: the extension factory re-runs on every session_start
  // (new/resume/fork/clone/reload), so this closure starts at 0 each session.
  // Limitation: resumed sessions don't backfill compression from prior turns;
  // the count reflects activity since this runtime instance was bound.
  let savedOriginalTokens = 0;
  let savedCompressedTokens = 0;

  // B1: stop the daemon at session_start and prevent any subprocess pi
  // spawns from healing it back to life via the lean-ctx shell hook.
  // Compression still works because the binary falls back to direct,
  // stateless per-call compression when no daemon is reachable.
  pi.on("session_start", async () => {
    process.env.LEAN_CTX_NO_HOOK = "1";
    try {
      await pi.exec(resolveBinary(), ["serve", "--stop"]);
    } catch {
      // best-effort: daemon may already be stopped, binary missing, etc.
    }
  });

  function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  function updateSavedFooter(ctx: ExtensionContext, stats?: CompressionStats, toolName?: string) {
    if (!stats) return;
    // Persist this savings event to the shared usage DB (best-effort; the store
    // swallows its own errors). inputCostPerM lets /stats compute $ savings.
    recordSavings({
      cwd: ctx.cwd,
      provider: ctx.model?.provider ?? null,
      model: ctx.model?.id ?? null,
      source: "lean-ctx",
      tool: toolName ?? null,
      originalTokens: stats.originalTokens,
      compressedTokens: stats.compressedTokens,
      inputCostPerM: ctx.model?.cost?.input ?? null,
    });
    savedOriginalTokens += stats.originalTokens;
    savedCompressedTokens += stats.compressedTokens;
    const saved = Math.max(0, savedOriginalTokens - savedCompressedTokens);
    if (saved <= 0) {
      ctx.ui.setStatus("lean-ctx-saved", undefined);
      return;
    }
    const pct = savedOriginalTokens > 0
      ? Math.round((saved / savedOriginalTokens) * 100)
      : 0;
    let line = `lean-ctx: ${formatTokenCount(savedOriginalTokens)}→${formatTokenCount(savedCompressedTokens)} tok of tool output (-${pct}%)`;
    // model.cost.input is dollars per 1M input tokens (verified against
    // pi-ai's models.generated.js). Skip when missing or zero (free models).
    const inputCostPerM = ctx.model?.cost?.input;
    if (typeof inputCostPerM === "number" && inputCostPerM > 0) {
      const dollars = (saved / 1_000_000) * inputCostPerM;
      if (dollars >= 0.01) {
        line += ` ~$${dollars.toFixed(2)}`;
      }
    }
    ctx.ui.setStatus("lean-ctx-saved", ctx.ui.theme.fg("dim", line));
  }

  const baseBashTool = createBashToolDefinition(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => {
      const bin = resolveBinary();
      return {
        command: `${shellQuote(bin)} -c sh -lc ${shellQuote(command)}`,
        cwd,
        // lean-ctx 3.8.x hard-blocks inline shell-eval (`sh -c`/`sh -lc`) at
        // its allowlist layer, which kills this entire wrapper. WARN_ONLY
        // downgrades the block to a log line so the command runs and output
        // still gets compressed; RUST_LOG=error suppresses that log line so
        // it doesn't leak into every bash result. Both are scoped to this
        // lean-ctx invocation only (raw bash, the lean_ctx tool, and other
        // rust programs you run are untouched).
        env: {
          ...env,
          LEAN_CTX_COMPRESS: "1",
          LEAN_CTX_NO_HOOK: "1",
          LEAN_CTX_ALLOWLIST_WARN_ONLY: "1",
          RUST_LOG: "error",
        },
      };
    },
  });

  const rawBash = createBashToolDefinition(process.cwd());

  const bashSchemaWithRaw = Type.Object({
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds to prevent hanging commands" })),
    raw: Type.Optional(Type.Boolean({ description: "Skip compression, return full uncompressed output" })),
  });

  pi.registerTool({
    ...baseBashTool,
    parameters: bashSchemaWithRaw,
    description:
      "Execute a bash command. Output is auto-compressed by lean-ctx. "
      + "IMPORTANT: Do NOT use bash to read files (cat/head/tail) — use the read tool instead. "
      + "Do NOT use bash for grep/find/ls — use the dedicated tools. "
      + "Use timeout (seconds) to prevent hanging commands. "
      + "Set raw=true to skip compression. raw=true is REQUIRED when the "
      + "command's FINAL stdout is binary — i.e. the rightmost command of the "
      + "outermost pipeline emits non-text bytes AND there is no redirection "
      + "to a file. Concrete examples that need raw=true: 'tar czf - dist', "
      + "'xxd -r hex.txt', 'gpg --decrypt secret.gpg' (no -o), "
      + "'cmd | base64 -d'. Cases that do NOT need raw=true (compression is "
      + "safe because final stdout is text or empty): 'tar czvf out.tgz dist' "
      + "(archive goes to file, stdout is verbose listing), 'tar tzvf foo.tgz' "
      + "(stdout is filenames), 'gpg --decrypt -o out.txt secret.gpg', "
      + "'cmd > /dev/null', any command piping into a file via '>'. Pipes and "
      + "$(...) substitutions internal to the shell command never reach "
      + "lean-ctx — only the final stdout matters.",
    promptSnippet: "Run shell commands (not for file reading — use read tool)",
    promptGuidelines: [
      "Use bash only for commands with side effects: build, test, install, git, run scripts.",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const isRaw = !!params.raw;
      const toolParams = { command: params.command, timeout: params.timeout };
      const tool = isRaw ? rawBash : baseBashTool;
      try {
        const result = await tool.execute(toolCallId, toolParams, signal, onUpdate, ctx);
        const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
        if (isRaw) {
          return { ...result, content: [{ type: "text", text }], details: { raw: true } };
        }
        const decorated = withFooter(text, { always: true });
        updateSavedFooter(ctx, decorated.stats, "bash");
        return {
          ...result,
          content: [{ type: "text", text: decorated.text }],
          details: { ...(result.details ?? {}), compression: decorated.stats },
        };
      } catch (error) {
        if (error instanceof Error) {
          if (isRaw) throw error;
          const decorated = withFooter(error.message, { always: true });
          throw new Error(decorated.text);
        }
        throw error;
      }
    },
  });

  const nativeReadTool = createReadToolDefinition(process.cwd());

  pi.registerTool({
    name: "read",
    label: "Read",
    description:
      "Read file contents. ALWAYS use this instead of cat/head/tail via bash. "
      + "Auto-selects mode: configs (.yaml/.json/.toml/.env) are always full-read. "
      + "Code files: full (<8KB), map (8-96KB), signatures (>96KB). "
      + "Use offset and limit to read specific line ranges.",
    promptSnippet: "Read file contents (always use instead of cat)",
    promptGuidelines: [
      "Use read to inspect file contents instead of cat or less.",
    ],
    parameters: readSchema,
    renderCall(args, theme, context) {
      return nativeReadTool.renderCall
        ? nativeReadTool.renderCall(args, theme, context)
        : (context.lastComponent ?? new Text("", 0, 0));
    },
    renderResult(result, options, theme, context) {
      if (result.content.some((block) => block.type === "image")) {
        return nativeReadTool.renderResult
          ? nativeReadTool.renderResult(result, options, theme, context)
          : (context.lastComponent ?? new Text("", 0, 0));
      }

      const textBlock = result.content.find((block) => block.type === "text");
      const rawText = textBlock?.type === "text" ? textBlock.text : "";
      const { body, footer } = splitFooter(rawText);
      const rawPath = typeof context.args?.path === "string" ? context.args.path : undefined;
      const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
      const renderedLines = lang ? highlightCode(replaceTabs(body), lang) : body.split("\n");
      const lines = trimTrailingEmpty(renderedLines);
      const maxLines = options.expanded ? lines.length : 10;
      const displayLines = lines.slice(0, maxLines);
      const remaining = lines.length - maxLines;

      let text = `\n${displayLines
        .map((line) => (lang ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line))))
        .join("\n")}`;

      if (remaining > 0) {
        text += `${theme.fg("muted", `\n... (${remaining} more lines, ctrl+o to expand)`)}`;
      }

      const truncation = (result.details as Record<string, unknown> | undefined)?.truncation as
        | { truncated?: boolean; firstLineExceedsLimit?: boolean; truncatedBy?: string; outputLines?: number; totalLines?: number; maxLines?: number; maxBytes?: number }
        | undefined;
      if (truncation?.truncated) {
        if (truncation.firstLineExceedsLimit) {
          text += `\n${theme.fg("warning", `[First line exceeds ${Math.round((truncation.maxBytes ?? DEFAULT_MAX_BYTES) / 1024)}KB limit]`)}`;
        } else if (truncation.truncatedBy === "lines") {
          text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} of ${truncation.totalLines} lines]`)}`;
        } else {
          text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines (${Math.round((truncation.maxBytes ?? DEFAULT_MAX_BYTES) / 1024)}KB limit)]`)}`;
        }
      }

      if (footer) {
        text += `\n\n${theme.fg("muted", footer)}`;
      }

      const component = context.lastComponent ?? new Text("", 0, 0);
      component.setText(text);
      return component;
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const requestedPath = normalizePathArg(params.path);
      const absolutePath = resolve(ctx.cwd, requestedPath);

      if (params.offset !== undefined || params.limit !== undefined) {
        const startLine = params.offset ?? 1;
        const endLine = params.limit ? startLine + params.limit - 1 : 999999;
        const args = ["read", absolutePath, "-m", `lines:${startLine}-${endLine}`];
        try {
          const leanCtxOutput = await execLeanCtx(pi, args);
          const originalSlice = await readSlice(absolutePath, params.offset, params.limit);
          // If lean-ctx returned a dedup stub ("Already in your context window")
          // emit the locally-sliced content instead. See looksLikeDedupStub.
          const output = looksLikeDedupStub(leanCtxOutput) ? originalSlice.text : leanCtxOutput;
          const decorated = withFooter(output, { originalText: originalSlice.text, always: true, preferEstimate: true });
          updateSavedFooter(ctx, decorated.stats, "read");
          return {
            content: [{ type: "text", text: decorated.text }],
            details: { path: absolutePath, lines: originalSlice.lines, source: "lean-ctx", mode: `lines:${startLine}-${endLine}`, compression: decorated.stats },
          };
        } catch {
          const sliced = await readSlice(absolutePath, params.offset, params.limit);
          return {
            content: [{ type: "text", text: sliced.text }],
            details: { path: absolutePath, lines: sliced.lines, source: "local-slice-fallback", truncated: sliced.truncated },
          };
        }
      }

      if (IMAGE_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
        return nativeReadTool.execute(_toolCallId, { ...params, path: absolutePath }, signal, onUpdate, ctx);
      }

      const mode = await chooseReadMode(absolutePath);
      const args = mode === "full" ? ["read", absolutePath] : ["read", absolutePath, "-m", mode];
      const leanCtxOutput = await execLeanCtx(pi, args);
      const originalText = await readFile(absolutePath, "utf8");
      // If lean-ctx returned a dedup stub, fall back to local file contents.
      // For "full" mode this is exact; for "map"/"signatures" we lose the
      // outline compression but at least give the agent real content instead
      // of a useless "already in your context" stub. See looksLikeDedupStub.
      const output = looksLikeDedupStub(leanCtxOutput) ? originalText : leanCtxOutput;
      const decorated = withFooter(output, { originalText, always: true, preferEstimate: true });
      updateSavedFooter(ctx, decorated.stats, "read");

      return {
        content: [{ type: "text", text: decorated.text }],
        details: { path: absolutePath, source: "lean-ctx", mode, compression: decorated.stats },
      };
    },
  });

  pi.registerTool({
    name: "ls",
    label: "ls",
    description: "List directory contents. Use limit to reduce output size.",
    promptSnippet: "List directory contents",
    parameters: lsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const requestedPath = normalizePathArg(params.path || ".");
      const absolutePath = resolve(ctx.cwd, requestedPath);

      // Re-implemented in-process to avoid lean-ctx daemon's path-jailing bug:
      // `lean-ctx ls <path>` silently rewrites paths outside the daemon's
      // sticky project_root and returns that root's tree instead. Walker output
      // matches the upstream `ctx_tree` format (indented tree, `(N)` file counts
      // on directories), but with no gitignore/dotfile filtering — every entry
      // readdir returns is shown.
      const depth = Math.min(
        Math.max(typeof params.depth === "number" ? params.depth : 3, 1),
        10,
      );

      let output: string;
      try {
        const stat0 = await stat(absolutePath);
        if (!stat0.isDirectory()) {
          output = `ERROR: ${absolutePath} is not a directory`;
        } else {
          output = buildTree(absolutePath, depth);
          if (!output) output = "(empty)";
        }
      } catch (e) {
        output = `ERROR: cannot read ${absolutePath}: ${
          e instanceof Error ? e.message : String(e)
        }`;
      }

      const decorated = withFooter(output, { limit: params.limit, always: true });
      updateSavedFooter(ctx, decorated.stats, "ls");
      return {
        content: [{ type: "text", text: decorated.text }],
        details: {
          path: absolutePath,
          source: "pi-lean-ctx-tree",
          depth,
          truncated: decorated.truncated,
          compression: decorated.stats,
        },
      };
    },
  });

  pi.registerTool({
    name: "find",
    label: "find",
    description: "Find files by glob pattern (respects .gitignore). Use limit to reduce output size.",
    promptSnippet: "Find files by glob pattern",
    parameters: findSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const requestedPath = normalizePathArg(params.path || ".");
      const absolutePath = resolve(ctx.cwd, requestedPath);
      const output = await execLeanCtx(pi, ["find", params.pattern, absolutePath]);
      const decorated = withFooter(output, { limit: params.limit, always: true });
      updateSavedFooter(ctx, decorated.stats, "find");
      return {
        content: [{ type: "text", text: decorated.text }],
        details: { path: absolutePath, pattern: params.pattern, source: "lean-ctx", truncated: decorated.truncated, compression: decorated.stats },
      };
    },
  });

  pi.registerTool({
    name: "grep",
    label: "grep",
    description: "Search file contents with ripgrep. Use limit to cap matches and context for surrounding lines.",
    promptSnippet: "Search file contents for patterns",
    parameters: grepSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const requestedPath = normalizePathArg(params.path || ".");
      const absolutePath = resolve(ctx.cwd, requestedPath);
      const searchArgs = ["rg", "--line-number", "--color=never"];
      if (params.ignoreCase) searchArgs.push("-i");
      if (params.literal) searchArgs.push("-F");
      if (params.context && params.context > 0) searchArgs.push(`-C${params.context}`);
      if (params.glob) searchArgs.push("--glob", params.glob);
      if (params.limit && params.limit > 0) searchArgs.push("-m", String(params.limit));
      searchArgs.push(params.pattern, absolutePath);

      const bin = resolveBinary();
      const result = await pi.exec(bin, ["-c", ...searchArgs], { env: { ...process.env, LEAN_CTX_COMPRESS: "1", LEAN_CTX_NO_HOOK: "1" } });
      if (result.code >= 2) {
        const msg = (result.stderr || result.stdout || `lean-ctx grep failed: ${params.pattern}`).trim();
        throw new Error(msg);
      }
      const output = result.code === 1 ? "(no matches)" : result.stdout;
      const decorated = withFooter(output, { always: true });
      updateSavedFooter(ctx, decorated.stats, "grep");
      return {
        content: [{ type: "text", text: decorated.text }],
        details: { path: absolutePath, pattern: params.pattern, source: "lean-ctx", compression: decorated.stats },
      };
    },
  });

  pi.registerTool({
    name: "lean_ctx",
    label: "lean_ctx",
    description:
      "Run lean-ctx CLI directly (CLI-first; no MCP required). "
      + "Use this for advanced commands like session/knowledge/overview/gain/stats/index/pack.",
    promptSnippet: "Run lean-ctx CLI directly",
    parameters: leanCtxSchema,
    async execute(_toolCallId, params) {
      const output = await execLeanCtx(pi, params.args);
      return {
        content: [{ type: "text", text: output.trimEnd() }],
        details: { source: "lean-ctx", args: params.args },
      };
    },
  });

  pi.registerCommand("lean-ctx", {
    description: "Show lean-ctx status: binary path and registered tools",
    handler: async (_args, ctx) => {
      const bin = resolveBinary();
      const found = existsSync(bin);
      const lines: string[] = [];
      lines.push(found ? `Binary: ${bin}` : "Binary: NOT FOUND — install: brew install yvgude/lean-ctx/lean-ctx");
      lines.push("Mode: CLI-first (no MCP, no shell aliases)");
      lines.push("Wraps: bash, read, grep, find, ls");
      lines.push("Direct CLI tool: lean_ctx");
      ctx.ui.notify(lines.join("\n"), found ? "info" : "warning");
    },
  });
}
