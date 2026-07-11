# lsp

A pi extension that exposes LSP-backed tools for any language for which an
LSP server is configured:

- **Navigation (read-only):** `lsp_hover`, `lsp_references`, `lsp_definition`,
  `lsp_implementations`, `lsp_workspace_symbols`, `lsp_document_symbols`,
  `lsp_diagnostics`.
- **Symbol-anchored editing:** `lsp_peek_symbol`, `lsp_edit_symbol`,
  `lsp_rename_symbol`. See [Symbol-anchored editing](#symbol-anchored-editing)
  below.

## Mental model

There are two distinct things:

1. **Catalog** — a hardcoded list (in `manager.ts`) of LSP recommendations.
   Multiple entries per language are allowed (e.g. `python` → pyright,
   basedpyright, pylsp). The catalog is **only consulted by `lsp_install`**:
   it answers the question "what should I install for language X?". The
   catalog never resolves code-navigation requests on its own.

2. **Active registry** — your `~/.pi/agent/extensions/lsp/languages.json`
   file. **Empty by default.** Only languages listed here are usable by
   `lsp_*` tools. Modified through:
   - `lsp_install` (auto-triggered when you query an unregistered file type),
   - `lsp_scan` (one-shot bootstrap: walks the catalog, finds binaries already
     on PATH, offers to add them all),
   - direct hand-editing of `languages.json`.

There is **no closed list** of supported languages anywhere — if the catalog
doesn't have what you want, you can hand-write a `languages.json` entry that
points at any binary you like.

## First-run bootstrap

Open a session, then have the agent run:

```
lsp_scan
```

It will check PATH for every catalog entry, show what it found, and (with your
confirmation) write the active config in one shot. Subsequent `lsp_*` calls
on `.py` / `.go` / `.ts` / etc. just work.

## What happens when you ask `lsp_hover` on a `.py` file

1. Active registry has no `.py` → look up `.py` in the catalog → `python`.
2. `python` has multiple catalog entries → you're asked "Pick an LSP for
   python:" with each candidate annotated `✅ installed` / `⚠️ not installed`.
3. You pick one (say `pyright-langserver`).
4. If it's on PATH → write to `languages.json`, proceed.
5. If it's not on PATH → "Install pyright-langserver?" → on yes, run
   `npm install -g pyright`, write to `languages.json`, proceed.
6. The `lsp_hover` request continues with the freshly-registered LSP.

## languages.json

```json
{
  "python": {
    "extensions": [".py", ".pyi"],
    "command": "pylsp",
    "installCommand": "pip install python-lsp-server"
  },
  "haskell": {
    "extensions": [".hs", ".lhs"],
    "command": "haskell-language-server-wrapper",
    "args": ["--lsp"],
    "installCommand": "ghcup install hls"
  }
}
```

| Field            | Required | Notes                                                                 |
|------------------|----------|-----------------------------------------------------------------------|
| `extensions`     | yes      | Array of file extensions (with leading dot). Lower-case.              |
| `command`        | yes      | Binary name; resolved via `command -v` (or absolute path).            |
| `args`           | no       | Argv passed to the binary. Most stdio LSPs need `["--stdio"]`.        |
| `installCommand` | no       | Shown / executed by `lsp_install` when the binary is missing.         |
| `installNotes`   | no       | Free-form notes shown next to the install prompt.                     |
| `languageIdMap`  | no       | Per-extension LSP `languageId` override (e.g. `".tsx" → "typescriptreact"`). Inherits from the catalog when the `command` matches a catalog entry. |

When your `command` matches a catalog binary (`pyright-langserver`,
`typescript-language-server`, `gopls`, …), the entry inherits the catalog's
function-typed niceties (`probeWorkspace`, `fallbackPaths`, `languageIdMap`).
For binaries the catalog doesn't know about there's no inheritance, which is
fine — the entry just won't get those bells and whistles.

## Tools

| Tool                     | Purpose                                                          |
|--------------------------|------------------------------------------------------------------|
| `lsp_install <language>` | Add a language to active config. Picks from catalog, installs if missing, writes `languages.json`. |
| `lsp_scan`               | Find every catalog LSP already on PATH and add it to the active config in one batch. |
| `lsp_hover` etc.         | Standard LSP navigation queries. Auto-trigger `lsp_install` on first use of a new extension. |
| `lsp_peek_symbol`        | Return the current source body of a symbol. Cheap diff base before `lsp_edit_symbol`. |
| `lsp_edit_symbol`        | Replace a symbol's full source range with a new body. No `oldText` echo, no whitespace fragility. Auto-runs diagnostics. |
| `lsp_rename_symbol`      | Workspace-wide rename via `textDocument/rename`. Applies the LSP's WorkspaceEdit across every touched file in one call. |

## Symbol-anchored editing

Three tools share one idea: **let the LSP locate the code, you supply only
the new content.** They reuse the same language resolution, server lifecycle,
and cache invalidation as the navigation tools.

### `lsp_peek_symbol`

Returns the current full body (header + decl through closing brace) of a
named symbol. Use this before `lsp_edit_symbol` when you want to see what
you're about to overwrite without reading the whole file.

```
lsp_peek_symbol({ path: "api/routes.go", symbol: "Runner.Run" })
→ api/routes.go:120-148 (symbol "Runner.Run")
  func (r *Runner) Run(ctx context.Context) error {
      ...
  }
```

Dotted paths (`Type.Method`) are supported, plus literal-name matches for
LSPs that flatten methods (gopls returns `(*Runner).Run` as a top-level
symbol whose *name* is the dotted form — both styles work).

### `lsp_edit_symbol`

Replaces a symbol's full range — signature included — with `newBody`. No
`oldText` parameter; the LSP's `documentSymbol` range is authoritative.

```
lsp_edit_symbol({
  path:    "api/routes.go",
  symbol:  "Runner.Run",
  newBody: "func (r *Runner) Run(ctx context.Context) error {\n\treturn r.runV2(ctx)\n}",
})
→ ✓ wrote api/routes.go (replaced L120-148, 28→3 lines)
  ✓ api/routes.go: no errors
```

After writing, the file is re-synced to the LSP and (by default) errors are
fetched and included in the result. Pass `runDiagnostics: false` to skip the
diagnostic round-trip when chaining many edits.

**When to reach for `edit` instead:** small (<5-line) in-body tweaks where
rewriting the whole symbol is overkill, or any change to imports, package
decls, or struct field tags (those aren't symbols in the LSP sense).

**Failure mode:** if `newBody` is syntactically invalid the file is left in
the broken state and the diagnostic summary will say so. Same risk as plain
`edit`, just larger blast radius per call.

### `lsp_rename_symbol`

Thin wrapper over `textDocument/rename`. The LSP returns a WorkspaceEdit
covering every reference; we apply it across all touched files (write +
invalidate caches per file) in one go.

```
lsp_rename_symbol({
  path:    "framework/workloadrepo/repo.go",
  symbol:  "WorkloadRepo",
  newName: "WorkloadStore",
})
→ ✓ renamed "WorkloadRepo" → "WorkloadStore" across 14 file(s), 47 edit(s):
    framework/workloadrepo/repo.go        (4 edits)
    cmd/ingest-service/handlers.go        (3 edits)
    ...
  ✓ framework/workloadrepo/repo.go: no errors
```

This catches usages a textual grep would miss (struct embeds, interface
implementations, generics) and avoids touching unrelated string matches in
logs or comments.

- `dryRun: true` returns the affected file list without writing anything.
- `runDiagnostics: false` skips the post-rename diagnostic check on the
  origin file (off-origin files are never auto-checked — call
  `lsp_diagnostics` per file if you need that).
- File create/rename/delete operations in the WorkspaceEdit are skipped; we
  only apply TextEdits. Sufficient for rename in every language we've used.

### Honest limits

- **UTF-16 vs JS strings.** LSP positions are in UTF-16 code units; JS
  strings index the same way for the BMP. Source files outside the BMP
  could in theory miscompute offsets — never seen in practice.
- **Symbol ambiguity.** Two `Run` methods on different receivers in one
  file: disambiguate with the dotted form (`Runner.Run` vs `Worker.Run`).
  Anonymous funcs and generic instantiations can't be addressed by name —
  fall back to plain `edit` for those.
- **No insertions.** These tools replace ranges; they don't add new methods
  to a file or insert at a position. Use plain `edit`/`write`.

## Slash command: `/lsp`

| Form                      | Effect                                                          |
|---------------------------|-----------------------------------------------------------------|
| `/lsp` (interactive)      | Menu: list / scan / reload / remove / path / template.          |
| `/lsp list`               | Print active registry + full catalog with PATH status / 📌 marker for active. |
| `/lsp reload`             | Re-read `languages.json` from disk.                             |
| `/lsp remove`             | Pick an active language to delete.                              |
| `/lsp path`               | Print the absolute path to `languages.json`.                    |
| `/lsp template <ext>`     | Print a copy-pasteable JSON entry for that extension.           |

## Lifecycle

- Servers spawn lazily on the first tool call per `(language, workspaceRoot)`.
- A server idle for 10 minutes is shut down; touching it again re-spawns it.
- A successful `edit`/`write` from the agent invalidates that file's cache
  and re-syncs it with every running server.
- `lsp_edit_symbol` / `lsp_rename_symbol` perform the same invalidation
  inline after each write — no extra hook needed.
- `session_shutdown` shuts down every server.

## Environment variables

| Variable                  | Effect                                                            |
|---------------------------|-------------------------------------------------------------------|
| `PI_LSP_LANGUAGES_PATH`   | Override the path to `languages.json` (mostly for tests).         |
| `PI_CODING_AGENT_DIR`     | Where pi stores agent config; the default `languages.json` lives at `$PI_CODING_AGENT_DIR/extensions/lsp/languages.json`. |
