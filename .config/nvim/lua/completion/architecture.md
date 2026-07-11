# Completion architecture

This directory implements a native multi-source completion stack that
replaces `coq_nvim`. It drives Neovim's built-in popup menu via
`vim.fn.complete()`, fans out to three concurrent sources per trigger,
merges their results, reranks by frecency, and pushes once.

The async-safety scaffolding (cursor-snapshot validation, request
cancellation, adaptive RTT debounce, generation tokens to drop stale
callbacks) is cribbed directly from Neovim's runtime
`runtime/lua/vim/lsp/completion.lua`. Where this module mirrors that
file, the comments call out specific line ranges so a future reader can
re-derive the patterns.

---

## Modules

| File | Role |
|------|------|
| `init.lua`       | Public surface: `setup(opts)`, `attach(client, bufnr)`, `detach(bufnr)`. Merges user opts + sets `completeopt`. |
| `config.lua`     | Mutable module-local options. `M.opts` is the live config; `M.merge(user)` is what `setup()` calls. |
| `icons.lua`      | Nerd-font codepoints for each LSP `CompletionItemKind` plus our `Buffer` / `Treesitter` sources. |
| `timing.lua`     | Cursor snapshot, adaptive debounce, RTT EMA, request cancellation. |
| `aggregator.lua` | Per-buffer state machine: trigger → gather → merge → cap → rerank → push. |
| `sources.lua`    | The three (soon four) source implementations: `lsp`, `buffer_words`, `ts_identifiers`. |
| `docs.lua`       | `CompleteChanged` → `completionItem/resolve` → side-popup with cache. |
| `snippet.lua`    | `CompleteDone` → `vim.snippet.expand` + `additionalTextEdits` + LSP item `command`. |
| `frecency.lua`   | Module-singleton frecency core for completion accepts. |
| `keymaps.lua`    | Buffer-local insert/select/normal mode keymaps installed on attach. |

---

## Data flow per trigger

```
InsertCharPre (vim.v.char)
  ├─ pum visible AND prior result was isIncomplete:
  │     adaptive_debounce → re-trigger
  ├─ char in client.completionProvider.triggerCharacters:
  │     trigger_char_ms libuv timer → vim.schedule → trigger()
  └─ otherwise: noop (TextChangedI handles prefix-based triggering)

TextChangedI
  └─ pum NOT visible AND prefix length ≥ PREFIX_MIN (2):
        text_changed_ms libuv timer → vim.schedule → trigger('invoked')

trigger(bufnr, kind, char, opts)
  ├─ timing.reset_timer(ctx)            cancel any prior pending requests
  ├─ timing.snapshot_cursor(ctx)        freeze { row, start_col, prefix } at trigger time
  ├─ generation token: ctx.last_request_time = vim.uv.hrtime()
  ├─ if no LSP clients: emit synchronously off buffer/TS alone
  ├─ schedule loading sentinel timer (default 150ms)
  │     fires "Loading…" pum if no real emit by then
  ├─ schedule soft-timeout timer (default 1s)
  │     forces emit with what we have, late LSP responses noop
  └─ sources.lsp(bufnr, ctx, on_partial)
        per-client async textDocument/completion request
        cancel handles stored on ctx.pending_requests
        each response → vim.schedule_wrap → on_partial → tally
        when all clients answer → emit_once('all_responded')

emit(ctx, lsp_items)
  ├─ timing.cursor_still_valid(ctx)?    bail if user moved past start_col
  ├─ sources.buffer_words(bufnr, prefix)   sync, cached by changedtick
  ├─ sources.ts_identifiers(bufnr, prefix, dedup)   sync, cached by changedtick
  ├─ merge: walk LSP first, then buffer, then TS, dedupe by `word`
  ├─ frecency.rank_items(matches)       reorder by accept-frecency
  ├─ apply_caps(matches)                cap per kind (Function=3, Buffer=2, …)
  │                                      empty prefix (raw `.`): LSP members
  │                                      bypass the cap; Buffer/TS stay capped
  ├─ swap_icons(matches)                replace kind name with nerd-font glyph
  │                                      + assign kind_hlgroup from cfg.opts.highlights
  └─ vim.fn.complete(ctx.start_col, matches)

CompleteChanged (selection navigates)
  └─ docs.lua on_complete_changed(bufnr)
        cache_key = (client_id, label, kind)
        cached → render_resolved synchronously (no roundtrip)
        miss   → debounced completionItem/resolve, write result to cache

CompleteDone (reason=='accept')
  └─ snippet.on_accept(ctx, completed_item)
        is_snippet=true   → replace_inserted '' + vim.snippet.expand(insertText)
        non-snippet textEdit → replace_inserted with newText
        additionalTextEdits  → vim.lsp.util.apply_text_edits
        item.command         → client:exec_cmd
  └─ frecency.record_accept()
        instance.record(word, 'accept')
  └─ docs cache cleared (separate CompleteDone autocmd)

InsertLeave
  └─ timing.reset_timer(ctx) + clear ctx.cursor / ctx.isIncomplete
```

---

## Sources

### LSP — `sources.lsp(bufnr, ctx, on_partial)`

Async. For every client attached to `bufnr` that supports
`textDocument/completion`, fires a `client:request(...)` and stores its
cancel handle on `ctx.pending_requests`. Each response is wrapped with
`vim.schedule_wrap` so `vim.fn.complete()` runs on the main loop.

Item conversion (`lsp_item_to_complete`):

- `word` priority: `filterText` > snippet `label` > `insertText`/`label`.
  `filterText` is what the user types against; some servers (emmet,
  gopls for snippet items) put a stable token there while `label`
  carries a signature.
- `abbr` = truncated `label` (`max_label`, default 15).
- `menu` = truncated `detail` (`max_menu`, default 30).
- `kind` = LSP `CompletionItemKind` name (`Function`, `Field`, …).
  Replaced with an icon by `swap_icons` before push.
- `user_data.nvim.lsp.{ client_id, completion_item }` — used by
  `docs.lua` (resolve), `snippet.lua` (accept), `frecency.lua` (record).

### Buffer-words — `sources.buffer_words(bufnr, prefix)`

Synchronous keyword scan of buffers in scope (`cfg.opts.sources.buffer_scope`):

- `'current'` — current buffer only.
- `'all_loaded'` (default) — every loaded + listed buffer, current first.

A per-buffer cache keyed by `nvim_buf_get_changedtick` skips the
re-scan when the buffer hasn't been edited since the last trigger.
Words ≥ 3 chars, case-insensitive prefix-match against the snapshot
prefix, deduped globally across the scope. The `seen` set is returned
to the caller so `ts_identifiers` can extend it.

### Treesitter — `sources.ts_identifiers(bufnr, prefix, dedup)`

Synchronous, no-op when no parser is attached. Walks the tree
iteratively (DFS with explicit stack — recursion blows Lua's call stack
on big files) and emits node text for the allowlist:

- `identifier`
- `type_identifier`
- `field_identifier`
- `property_identifier`

Cached by changedtick, same as buffer-words. Dedupes against the `seen`
set the buffer-words pass returned, so an identifier scanned by both
sources only appears once (buffer-words wins because it ran first).

---

## Timing & cancellation

### Generation tokens

`ctx.last_request_time = vim.uv.hrtime()` at trigger entry. Every async
callback (LSP response, soft-timeout, loading sentinel) re-checks
`ctx.last_request_time == start_time` before acting. A newer trigger
overwrites the field, so any stale callback that slips past the
cancellation logic is silently dropped.

### Adaptive RTT debounce

`timing.adaptive_debounce(ctx)` returns
`max(0, ctx.rtt_ms - elapsed_since_last_request)` — used by the
`isIncomplete` re-trigger path. The RTT is tracked per-context via an
exponential moving average (window=10, warmup=10) updated on every
LSP response. Fast servers converge to ~0; slow ones throttle.

### Soft timeout

`opts.timeout_ms` (default 1s) on `M.trigger` schedules a forced
`emit_once('timeout')`. If one slow LSP holds up the merge, we still
push buffer/TS (and any clients that did answer) at the timeout. Late
responses noop via the generation token.

### Loading sentinel

`cfg.opts.loading.threshold_ms` (default 150ms) schedules a single
`Loading…` pum item if no real emit has happened by then. Replaced by
the real emit when the LSP responds (or the soft timeout fires). Set
`loading.enabled = false` to disable.

---

## Frecency

`lua/completion/frecency.lua` is a thin wrapper around `lua/frecency/`:

- One module-singleton instance, lazy-allocated on first attach.
- `record_accept()` reads `vim.v.completed_item.word` on
  `CompleteDone` (gated on `event.reason == 'accept'`) and calls
  `instance.record(word, 'accept')`.
- `rank_items(items)` is invoked inside `emit` between merge and
  cap. Stable rerank by decayed score; ties preserve input order.

Currently session-only — the persistence sketch (file format, atomic
write, hydrate on attach) is documented at the top of `frecency.lua`
under `TODO(persistence)`.

---

## Docs popup

`lua/completion/docs.lua` resolves the active completion item via
`completionItem/resolve` and pushes the result into the pum's preview
window via `nvim__complete_set`.

### Caching

Per-resolver `cache` keyed by `(client_id, label, kind)`. Cleared on
`CompleteDone` (one cache per pum session). Cache hits render the
docs synchronously without an LSP roundtrip — re-selecting an item
you've already viewed is instant. Negative-cached: if the LSP returned
an empty resolve, the cache still records it so subsequent navigations
don't re-request.

### Position-aware sizing

`place_popup(content_w, content_h)` queries `vim.fn.pum_getpos()` and:

1. Right of pum has enough space → let Vim handle the position
   (cheapest; no flicker).
2. Right is too narrow but left is wide enough → switch to
   `relative='editor'` and place the popup left of the pum.
3. Both sides tight → pick the wider one, shrink content width to fit
   (clamped at 20 cells minimum).

A rounded border + `winhighlight = 'Normal:NormalFloat,FloatBorder:FloatBorder'`
gives the popup visual separation from the underlying buffer.

---

## Snippet & textEdit on accept

`lua/completion/snippet.lua` `on_accept` handles three orthogonal
LSP-driven side effects on a just-accepted item:

1. **Snippet expansion** when `insertTextFormat == 2`. Deletes the
   inserted literal word, then `vim.snippet.expand(insertText)`.
   Mirrors the runtime `apply_snippet` at `lsp/completion.lua:163-167`
   — passes the raw LSP-snippet body to `vim.snippet.expand`, which
   parses it natively (no `parse_snippet` wrapper — that wrapper used
   to be here and was a bug because `tostring(parse(input))` returns
   the *rendered* form, killing the placeholder syntax).
2. **Non-snippet `textEdit`**: when the LSP returns an explicit
   range/newText that isn't a snippet, replace the inserted range with
   the newText.
3. **`additionalTextEdits`**: auto-imports etc. Applied via
   `vim.lsp.util.apply_text_edits`. **Critical correctness note**:
   `lua/lsp/init.lua` removes `additionalTextEdits` from
   `resolveSupport.properties` so servers can't defer it past the
   initial response. Without that capability tweak, gopls would defer
   the import edit to `completionItem/resolve`, and items accepted
   without first being navigated to (and therefore never resolved by
   `docs.lua`) would land without their import.

The handler runs on `CompleteDone` (not `CompleteDonePre`) gated on
`event.reason == 'accept'`. CompleteDonePre fires while Vim's
completion state machine is still finalizing — `vim.snippet.expand`
inserts the text but the snippet session can't register tabstops
cleanly, leaving `vim.snippet.active() == false`. CompleteDone fires
after settling.

---

## Keymaps

Buffer-local, installed by `keymaps.setup(bufnr)` from
`aggregator.attach`:

| Key      | Modes      | Action |
|----------|------------|--------|
| `<CR>`   | i          | Accept pum selection (`<C-y>`); else literal `<CR>`. |
| `/`      | i          | Dismiss pum (`<C-e>`); else literal `/`. |
| `<C-n>`  | i          | Cycle pum if visible; else `aggregator.trigger(0, 'invoked')`; else fallback to omnifunc / built-in keyword completion. |
| `<C-u>`  | i          | Buffer-keyword completion (`<C-x><C-n>`). |
| `<C-h>`  | n / i / s  | Snippet forward jump if a session is active; else `<BS>`. Bound in normal mode too so `<Esc>` from select-mode-on-placeholder doesn't strand the user. |
| `<C-l>`  | n / i / s  | Snippet backward jump if a session is active; else `<C-l>` redraw. |
| `<BS>`   | s          | Drop placeholder selection cleanly (`<C-o>s`). |

`<Tab>` / `<S-Tab>` are intentionally NOT bound here — `tabout.nvim`
owns `<Tab>` in this config.

---

## Configuration

All runtime knobs live in `config.lua`. `setup(opts)` deep-merges into
`M.opts`:

```lua
require('completion').setup({
  max_label = 15,
  max_menu  = 30,

  caps = {
    Text       = 2,
    Buffer     = 2,
    Treesitter = 2,
    Function   = 3,
    Method     = 3,
    Field      = 3,
    Property   = 3,
    default    = 5,
  },

  icons      = require('completion.icons'),  -- override per-kind by passing { Function = '…' }
  highlights = { Function = '@function', ... },  -- mapped to kind_hlgroup

  sources = {
    buffer_scope = 'all_loaded',  -- or 'current'
  },

  debounce = {
    text_changed_ms = 500,        -- typing-pause before TextChangedI fires aggregator
    trigger_char_ms = 25,         -- pause after a trigger character
  },

  loading = {
    enabled      = true,
    threshold_ms = 150,
    label        = 'Loading…',
    icon         = nil,           -- nil → icons.default
  },

  docs = {
    max_width      = 60,
    max_height     = 20,
    initial_rtt_ms = 50,          -- initial resolve RTT estimate
  },
})
```

Nested tables (`caps`, `highlights`, `debounce`, etc.) merge with
`force` semantics — overriding `caps.Function` doesn't wipe the rest of
the cap map.

---

## Adding snippets as a fourth source (Option A)

This is the recommended path: emit completion items shaped exactly like
LSP-snippet items so the existing `on_accept` path expands them via
`vim.snippet.expand` with zero changes to `aggregator.lua` or
`snippet.lua`.

### Layout

```
lua/completion/
├── sources.lua
│   └── M.lsp_snippets(bufnr, prefix, dedup)   ← new function
└── snippets/
    ├── go.lua
    ├── lua.lua
    ├── python.lua
    └── ...
```

### Snippet file shape

Each filetype file returns a list of snippet specs in LSP format:

```lua
-- lua/completion/snippets/go.lua
return {
  {
    trigger = 'iferr',
    body    = 'if err != nil {\n\t${1:return err}\n}$0',
    detail  = 'guard against err',
  },
  {
    trigger = 'tt',
    body    = 'func Test${1:Name}(t *testing.T) {\n\t${0}\n}',
    detail  = 'test function',
  },
}
```

`trigger` is what the user types. `body` is the LSP-snippet body
(`${1:default}`, `$0`, etc.). `detail` shows in the pum's `menu`
column.

### Source implementation

```lua
-- in lua/completion/sources.lua
function M.lsp_snippets(bufnr, prefix, dedup)
  local ft = vim.bo[bufnr].filetype
  if ft == '' then return {} end

  local ok, defs = pcall(require, 'completion.snippets.' .. ft)
  if not ok or type(defs) ~= 'table' then return {} end

  local seen         = dedup or {}
  local has_prefix   = prefix ~= nil and prefix ~= ''
  local prefix_lower = has_prefix and prefix:lower() or nil
  local prefix_len   = has_prefix and #prefix or 0

  local out = {}
  for _, def in ipairs(defs) do
    local trig = def.trigger
    if trig and not seen[trig] then
      if (not has_prefix) or trig:sub(1, prefix_len):lower() == prefix_lower then
        seen[trig] = true
        out[#out + 1] = {
          word  = trig,
          abbr  = trig,
          menu  = def.detail or '',
          kind  = 'Snippet',
          icase = 1,
          dup   = 0,
          user_data = {
            nvim = { lsp = {
              client_id = 0,                            -- 0 = no LSP client
              completion_item = {
                label            = trig,
                insertText       = def.body,
                insertTextFormat = 2,                   -- LSP Snippet
              },
            }}
          },
        }
      end
    end
  end
  return out
end
```

### Aggregator hook

In `aggregator.lua` `emit`, add the call alongside the buffer/TS gather:

```lua
local buf_items, dedup = sources.buffer_words(ctx.bufnr, prefix)
local ts_items         = sources.ts_identifiers(ctx.bufnr, prefix, dedup)
local snip_items       = sources.lsp_snippets(ctx.bufnr, prefix, dedup)
```

Then merge `snip_items` into the dedupe pass (LSP wins, then buffer,
then TS, then snippets — or place snippets earlier if you want them
ranked higher).

### Caps + icons + highlights

`Snippet` is already in the default `caps` map (inherits `default = 5`
unless you set it). `icons.Snippet` already maps to a glyph. Add a
distinct highlight if you want:

```lua
require('completion').setup({
  caps       = { Snippet = 3 },
  highlights = { Snippet = '@string' },  -- whatever reads as "user-defined"
})
```

### What you get for free

- **Frecency** — accepted snippets contribute to the same rank as LSP /
  buffer items.
- **Per-kind caps** — `caps.Snippet = N` limits how many snippet items
  appear per pum session.
- **Icon + highlight** — already wired through `swap_icons`.
- **Snippet expansion on accept** — `on_accept` detects
  `insertTextFormat == 2` and routes through `vim.snippet.expand`, no
  changes needed.
- **Docs popup** — items don't need `documentation`; if absent, the
  side popup just doesn't render for them.

### Constraints

- LSP-snippet syntax only (`${1:default}`, `${2|a,b,c|}`, `$0`,
  variables like `$TM_FILENAME`). No dynamic / function / regex-trigger
  features.
- Filetype-scoped via the file path (`snippets/<ft>.lua`). Cross-
  filetype sharing requires explicit `require` from individual files.
- No autosnippets / regex triggers — the user has to type the trigger
  prefix and pick from the pum.

For more dynamic behavior, integrate LuaSnip instead — but that's a
separate path that bypasses `on_accept`'s LSP handling. See the
LuaSnip option in the conversation history if you go that route.
