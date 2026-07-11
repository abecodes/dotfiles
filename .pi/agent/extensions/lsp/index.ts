/**
 * pi LSP extension.
 *
 * Adds LSP-backed code navigation tools (hover, references, definition, workspace_symbols,
 * implementations, document_symbols, diagnostics).
 *
 * The set of supported languages is open: file extensions resolve via a
 * language registry that's the union of a small built-in baseline and a
 * user-editable file at `~/.pi/agent/extensions/lsp/languages.json`. Missing
 * binaries trigger an install prompt at first use; missing language entries
 * surface a copy-pasteable config template in the tool's error message.
 *
 * Lifecycle:
 *   - Servers spawn lazily on first tool call per (language, workspaceRoot).
 *   - Idle for 10 min → auto-shutdown. Touched again → re-spawn.
 *   - session_shutdown → shutdown all servers.
 *   - Built-in `edit`/`write` tool result → invalidate that file in every running server + cache.
 *
 * Workspace root: ctx.cwd by default. Per-call `workspaceRoot` override available.
 *
 * Slash commands:
 *   - /lsp list       — print every registered language and whether its binary is on PATH.
 *   - /lsp reload     — re-read languages.json from disk.
 *   - /lsp path       — print the languages.json path.
 *   - /lsp template <ext>  — print a JSON template for that extension.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import {
  CATALOG,
  LspManager,
  catalogLanguages,
  getAllLanguages,
  getAllLanguageIds,
  getLanguagesConfigError,
  getUserLanguageCount,
  languagesConfigPath,
  languagesConfigTemplate,
  reloadLanguageRegistry,
  removeActiveLanguageEntry,
  resolveBinary,
} from "./manager.js";
import { registerTools, SessionCacheImpl } from "./tools.js";

export default function (pi: ExtensionAPI) {
  const manager = new LspManager();
  const cache = new SessionCacheImpl();

  registerTools(pi, manager, cache);

  // Invalidate cached LSP results + force re-sync when the agent edits a file.
  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) return;
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const input = event.input as { path?: string } | undefined;
    if (!input?.path) return;
    const abs = resolve(ctx.cwd, input.path.startsWith("@") ? input.path.slice(1) : input.path);
    cache.invalidateFile(abs);
    manager.forEach((s) => s.invalidateFile(abs));
  });

  pi.on("session_start", async (_event, ctx) => {
    const ids = getAllLanguageIds();
    const err = getLanguagesConfigError();
    if (err) {
      ctx.ui.notify(`lsp: failed to parse ${languagesConfigPath()}: ${err}`, "warning");
      return;
    }
    if (ids.length === 0) {
      // Friendly nudge — the registry is empty by design, so users hit “no LSP
      // for foo” on their first call. Let them know there’s a quick bootstrap.
      ctx.ui.notify(
        `lsp: no languages registered. Run /lsp scan to add already-installed LSPs in one step, or use lsp_install on demand.`,
        "info",
      );
      return;
    }
    ctx.ui.notify(`lsp: ${ids.length} language(s) registered`, "info");
  });

  pi.on("session_shutdown", async () => {
    cache.clear();
    await manager.shutdownAll();
  });

  // ------------------------------------------------------------------
  // /lsp slash command
  // ------------------------------------------------------------------

  pi.registerCommand("lsp", {
    description: "Inspect and manage the LSP language registry",
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      let action = tokens[0];

      if (!action) {
        const choice = await ctx.ui.select("LSP:", [
          "List active + catalog",
          "Scan PATH for installed LSPs",
          "Reload languages.json",
          "Remove a language…",
          "Show config path",
          "Show JSON template…",
        ]);
        if (!choice) return;
        if (choice === "List active + catalog") action = "list";
        else if (choice === "Scan PATH for installed LSPs") action = "scan";
        else if (choice === "Reload languages.json") action = "reload";
        else if (choice === "Remove a language…") action = "remove";
        else if (choice === "Show config path") action = "path";
        else action = "template";
      }

      switch (action) {
        case "list": {
          const langs = getAllLanguages();
          const activeKeys = new Set(Object.keys(langs));
          const cfgErr = getLanguagesConfigError();
          const lines: string[] = [];
          lines.push(`languages.json: ${languagesConfigPath()}`);
          if (cfgErr) lines.push(`⚠️  parse error: ${cfgErr}`);
          lines.push("");
          lines.push(`── Active (${activeKeys.size}) ────────────────────────────`);
          if (activeKeys.size === 0) {
            lines.push("  (none — run /lsp scan or call lsp_install)");
          } else {
            for (const [id, lang] of Object.entries(langs).sort(([a], [b]) => a.localeCompare(b))) {
              const bin = await resolveBinary(lang);
              const status = bin ? "✅" : "⚠️ ";
              lines.push(`  ${status} ${id.padEnd(14)} ${lang.command.padEnd(30)} ext: ${lang.extensions.join(" ")}`);
              lines.push(`     ${bin ?? `not on PATH (install: \`${lang.installCommand}\`)`}`);
            }
          }
          lines.push("");
          lines.push(`── Catalog (${CATALOG.length}) ──────────────────────────`);
          for (const e of CATALOG) {
            const bin = await resolveBinary({
              id: e.language,
              extensions: e.extensions,
              command: e.command,
              args: e.args,
              installCommand: e.installCommand,
              installNotes: e.installNotes,
              fallbackPaths: e.fallbackPaths,
            });
            const onPath = bin ? "✅" : "⚫";
            const isActive = activeKeys.has(e.language) && langs[e.language]?.command === e.command ? "📌" : "  ";
            lines.push(`  ${onPath}${isActive} ${e.language.padEnd(14)} ${e.command.padEnd(30)} install: \`${e.installCommand}\``);
          }
          lines.push("");
          lines.push("Legend: ✅ on PATH, ⚫ not on PATH, 📌 already in active config");
          ctx.ui.notify(lines.join("\n"), cfgErr ? "warning" : "info");
          return;
        }
        case "scan":
          ctx.ui.notify(
            "Run the `lsp_scan` tool (the agent can do this for you, or set `autoAdd: true` to skip the per-entry confirm).",
            "info",
          );
          return;
        case "reload":
          reloadLanguageRegistry();
          ctx.ui.notify(
            `lsp: reloaded. ${getAllLanguageIds().length} language(s) registered (${getUserLanguageCount()} from languages.json)` +
              (getLanguagesConfigError() ? `\n⚠️  parse error: ${getLanguagesConfigError()}` : ""),
            getLanguagesConfigError() ? "warning" : "info",
          );
          return;
        case "remove": {
          const ids = getAllLanguageIds().sort();
          if (ids.length === 0) {
            ctx.ui.notify("No active languages to remove.", "info");
            return;
          }
          const choice = await ctx.ui.select("Remove which language?", ids);
          if (!choice) return;
          const ok = await ctx.ui.confirm(`Remove ${choice}?`, `${choice} will be deleted from ${languagesConfigPath()}.`);
          if (!ok) return;
          const removed = removeActiveLanguageEntry(choice);
          ctx.ui.notify(
            removed ? `Removed ${choice} from ${languagesConfigPath()}.` : `${choice} was not present.`,
            removed ? "info" : "warning",
          );
          return;
        }
        case "path":
          ctx.ui.notify(languagesConfigPath(), "info");
          return;
        case "template": {
          let ext = tokens[1];
          if (!ext) {
            const typed = await ctx.ui.input("File extension (e.g. .py)", ".foo");
            ext = (typed ?? "").trim();
            if (!ext) return;
          }
          if (!ext.startsWith(".")) ext = `.${ext}`;
          const known = catalogLanguages().sort().join(", ") || "(none)";
          ctx.ui.notify(
            `Catalog languages: ${known}.\n\nAdd a custom entry to ${languagesConfigPath()}:\n\n${languagesConfigTemplate(ext)}`,
            "info",
          );
          return;
        }
        default:
          ctx.ui.notify(
            `Unknown action: ${action}. Use list|scan|reload|remove|path|template`,
            "warning",
          );
      }
    },
  });
}
