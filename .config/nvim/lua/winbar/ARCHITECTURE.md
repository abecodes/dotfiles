# Winbar / Statusline architecture

This directory implements the winbar and statusline for the config. Both
render through Neovim's `%!` statusline-expression mechanism and are
composed from **sections** that modules register with `winbar.bar`.

Nothing in here runs on a fast-polling timer. Redraws are driven by
autocmds, plus one low-frequency 60s timer for the wall clock.

---

## How it's wired

`lua/winbar/init.lua` runs these three steps, in order:

```
require('winbar.bar').setup_autocmds()   -- 1. install redraw autocmds + 60s clock
require('winbar.winbar')                 -- 2. register winbar sections
require('winbar.statusbar')              -- 3. register statusline sections

vim.o.winbar     = "%!v:lua.require('winbar.winbar').render()"
vim.o.statusline = "%!v:lua.require('winbar.statusbar').render()"
```

When Neovim redraws the screen, it evaluates the `%!` expression, which
calls `winbar.bar.render(target)`. That function iterates the registered
sections for `target`, renders each one, and composes the final string.

---

## The `%!v:lua...` evaluation model

Neovim evaluates `%!` expressions **once per redraw, per window**. A redraw
is triggered by:

- Cursor movement (`CursorMoved` / `CursorMovedI`)
- Mode change (`ModeChanged`)
- Buffer/window enter (`BufEnter`, `WinEnter`)
- Window scroll or resize (`WinScrolled`, `WinResized`)
- Any explicit `vim.api.nvim__redraw({statusline=true})` / `{winbar=true}`
- Most plugin operations that move the cursor or change the buffer

The render function **must**:

- Be **pure** (no side effects — no autocmds created, no options set, no
  buffer writes, no `vim.cmd`).
- Be **fast** — target well under a millisecond. The renderer is called on
  every redraw.
- Be **nil-safe** — defend against optional plugins being absent, LSP not
  attached, etc.
- Return a **string**. Empty strings are fine; nil is not.
- **Not** call `vim.schedule` or any API that requires the main loop
  context. `%!` expressions run inside a display-eval context.

If a render function throws, `winbar.bar` `pcall`-guards it, logs once, and
substitutes an empty string. One noisy section does not break the bar.

---

## Section spec

```lua
---@alias BarCtx { winid: integer, bufnr: integer }

---@class BarSection
---@field side     'left' | 'center' | 'right'        position group
---@field priority integer                            lower = earlier within its side (default 100)
---@field render   fun(ctx: BarCtx): string           returns content (may include %#HL# / %* codes)
---@field condition? fun(ctx: BarCtx): boolean        optional gate; when false section is skipped
---@field name?    string                             optional label used in error logs
```

The `%!` expression is evaluated **per window** for the winbar. `ctx.winid`
is the window being drawn (sourced from `vim.g.statusline_winid`); `ctx.bufnr`
is its buffer. **Winbar sections MUST read from `ctx`** — using
`nvim_get_current_buf()` / `expand('%...')` inside a winbar render will leak
the focused window's data into every inactive split.

Statusline sections may ignore `ctx` since `laststatus=3` (global statusline)
means the drawn window is always the focused window. Existing statusbar
sections accept no args and lua silently discards the extra one.

**Field notes:**

- `side` buckets the section. Composition is `left %= center %= right` when
  any center section is present, else `left %= right`. `%=` is the
  statusline "align gap" — Neovim inserts filler spaces between groups.
- `priority` orders sections *within their side*. Lower numbers come first.
  Ties preserve insertion order. Leave defaults unless you need a specific
  order.
- `render` is the workhorse — see "Do's and don'ts" below.
- `condition` is evaluated per render. Use it for gates like "current
  buffer has a filename" or "LSP is attached". Keep it cheap; it runs as
  often as `render`.
- `name` shows up in `:messages` if the section errors. Defaults to the
  function's `tostring`, which is usually unreadable — provide a name.

---

## Composition rules

Given `left = {L1, L2}`, `center = {C1}`, `right = {R1, R2}`:

```
L1 L2 %= C1 %= R1 R2
```

Given `left = {L1}`, `center = {}`, `right = {R1}`:

```
L1 %= R1
```

Consecutive `%=` produce equal gaps between groups. Each side's sections
are concatenated in priority order with **no separator** — separators are
the section author's responsibility (add a leading space, a `|`, etc.).

There is no global gate — every gate lives in a section's `condition`.
The winbar sections gate on `is_file_buffer` (both `utils.ui_buffer.is_ui_buffer`
and the presence of a filename), so the winbar renders empty on
telescope/neogit/terminal/unnamed buffers. The statusline sections
deliberately do **not** gate on `is_ui_buffer`; mode and clock should stay
visible even inside telescope-style prompts. Follow that convention unless
you have a specific reason not to.

---

## Registration API

```lua
require('winbar.bar').register_section('winbar' | 'statusline', spec)
```

**Where to call it:** at the top level of your module. Example layout:

```lua
-- lua/winbar/my_section.lua
local bar = require('winbar.bar')

local function render_foo()
  ...
end

bar.register_section('statusline', {
  side     = 'left',
  priority = 30,
  name     = 'my_section.foo',
  render   = render_foo,
})
```

Then require the module once, before the `%!` expression is first
evaluated. The cleanest place is from `lua/winbar/init.lua` (add a new
`require('winbar.my_section')` line there), or from any module that already
loads at startup.

---

## Redraw events

`bar.setup_autocmds()` wires the canonical list:

| Event                         | Targets                      | Why                                               |
| ----------------------------- | ---------------------------- | ------------------------------------------------- |
| `DiagnosticChanged`           | statusline + winbar          | LSP publishes diagnostics out-of-band             |
| `LspAttach`, `LspDetach`      | statusline + winbar          | winbar shows attached server names                |
| `ModeChanged`                 | statusline                   | belt-and-suspenders; NVim usually redraws already |
| `User GitSignsUpdate`         | statusline                   | gitsigns b-vars changed                           |
| 60s timer                     | statusline                   | wall-clock minute tick                            |

If your new section depends on a data source not in this list, trigger
redraws yourself from an autocmd:

```lua
vim.api.nvim_create_autocmd('User', {
  pattern  = 'MyPluginEvent',
  callback = function()
    vim.api.nvim__redraw({ statusline = true, winbar = true })
  end,
})
```

Prefer the narrowest scope possible (`statusline = true` or
`winbar = true`, not both) — it avoids redundant work.

---

## Worked example: current git branch (statusline)

A complete, self-contained section in its own file.

```lua
-- lua/winbar/sections/git_branch.lua
local bar = require('winbar.bar')

-- Cache the branch so we don't shell out on every redraw.
local cached_branch = ''

local function refresh()
  -- vim.system is async; schedule the result back to the main loop.
  vim.system({ 'git', 'rev-parse', '--abbrev-ref', 'HEAD' }, { text = true },
    vim.schedule_wrap(function(res)
      cached_branch = (res.code == 0 and vim.trim(res.stdout)) or ''
      vim.api.nvim__redraw({ statusline = true })
    end))
end

-- Update whenever the user opens a file or switches cwd.
local grp = require('utils.autocmd').new_augroup('winbar_git_branch')
vim.api.nvim_create_autocmd({ 'BufEnter', 'DirChanged', 'FocusGained' }, {
  group    = grp,
  callback = refresh,
})

bar.register_section('statusline', {
  side      = 'left',
  priority  = 25,
  name      = 'git.branch',
  -- Skip the section when we have no branch yet; keeps the bar clean.
  condition = function() return cached_branch ~= '' end,
  render    = function()
    return require('utils.hl').hl('StatusBarB') .. '  ' .. cached_branch .. ' '
  end,
})

refresh()  -- prime the cache at load time
```

Then from `lua/winbar/init.lua`, add one line after the existing requires:

```lua
require('winbar.sections.git_branch')
```

That's the whole flow: **fetch data out-of-band → cache → tell the bar to
redraw → pull from cache inside render()**. The render function stays
synchronous and fast.

---

## Styling helpers

Pull them from `utils.hl`:

```lua
local hl_utils = require('utils.hl')
```

| Helper                            | Returns            | Use when                                             |
| --------------------------------- | ------------------ | ---------------------------------------------------- |
| `hl_utils.wrap_hl(hl, str)`       | `%#HL#str%*`       | self-contained styled chunk; resets after            |
| `hl_utils.hl(hl)`                 | `%#HL#`            | switch into a highlight group without resetting (bg carries forward) |
| `hl_utils.limit_str(str, n)`      | truncated string   | clip long content with a `..` prefix                 |

`wrap_hl` is what `winbar.lua` uses — each chunk is self-closing, so bg is
transparent between them. `hl` is how `statusbar.lua` paints contiguous
B-section / C-section backgrounds without closing them. Pick based on
whether your bg needs to extend into the next section.

---

## Float-overlay pattern (the sticky idiom)

Some things aren't expressible as a `%!` string:

- Content that needs its own buffer (multi-line, wrapped text)
- Content that needs per-window positioning (anchored floats)
- Content that should only appear on certain windows

For those, use a **floating window** driven by the same event-driven model
that the bar uses. `lua/notes/sticky.lua` is the canonical example. The
pattern:

1. A public `M.attach()` function, called once from `init.lua`, creates an
   augroup and registers the events that should trigger a rerender
   (`BufEnter`, `WinEnter`, `WinResized`, `User <YourEvent>`, etc.).
2. Internal state holds the current win/buf ids of the float.
3. `render()` checks if the float should exist for the current buffer; if
   so, creates or updates it; if not, closes it.
4. Mutations to the underlying data source fire a `User` event that the
   attach autocmds listen for. Single path — no polling.

**Do not register a float with `bar.register_section`** — that registry is
only for the `%!` expression composition. Floats are a separate idiom.

---

## Do's and don'ts

**Do:**

- Keep `render()` and `condition()` pure.
- Return `''` when your section has nothing to show — never `nil`.
- Cache expensive data (git, shell-outs, plugin state) in module-level
  locals; update from autocmds.
- Use `name` in your spec so errors are findable in `:messages`.
- Prefer narrow redraw scope (`statusline = true` alone if you don't need
  winbar).

**Don't:**

- Call `vim.cmd`, `vim.schedule`, or any option-writing API from inside
  `render()`.
- Do I/O inside `render()` — move it behind a cache refreshed by autocmd.
- Assume an optional plugin is loaded — `pcall(require, 'nvim-web-devicons')`.
- Rely on a section running at a specific cadence. There is no timer; run
  as often as neovim redraws, which could be 100+ times per second during
  fast cursor motion.

---

## Debugging

- **Section isn't updating.** Check that your data source fires an
  autocmd, and that you're either listening to that autocmd (to trigger
  `nvim__redraw`) or the data change coincides with a natural redraw
  (cursor move, buffer enter, etc.). Test with `:lua vim.api.nvim__redraw({statusline=true})` — if that makes it update, the data is fine and you just need a redraw trigger.
- **Section errors silently.** `winbar.bar` logs the first error per
  section to `:messages`. Grep for `[winbar] section <name> errored`.
  Subsequent errors are suppressed to keep messages clean; to reset,
  restart nvim or `:lua package.loaded['winbar.bar'] = nil; require('winbar.bar')`
  to reinit the module (clears the file-local once-per-section log).
- **Winbar shows on wrong buffers.** `bar.render` applies the
  `utils.ui_buffer.is_ui_buffer` gate globally. If a buffer type slips through,
  add it to `utils/ui_buffer.ui_filetypes` or `ui_buftypes`.
- **Clock doesn't tick.** The timer is set on first require of
  `winbar.bar` and survives `:luafile`. To force a reset:
  `_G.__winbar_clock_timer:close(); _G.__winbar_clock_timer = nil; package.loaded['winbar.bar'] = nil; require('winbar.bar')`.
- **Statusline is blank.** Check `:lua vim.print(vim.o.statusline)` —
  should be the `%!v:lua...` expression. If a plugin or later config
  overwrote it, re-run `require('winbar')`.
- **Performance regression.** Add `print` or a counter inside your
  `render()`; if it fires 100+ times a second, you're inside an inner
  redraw loop (fast cursor motion through a large file). Move any
  non-trivial work into an autocmd-refreshed cache.
