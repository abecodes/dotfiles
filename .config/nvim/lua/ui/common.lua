local M = {}

---Save the currently-focused window and return a thunk that restores focus.
---Required when the picker is launched from a floating caller (e.g. telescope)
---so close doesn't fall through to the regular editor window.
function M.caller_win_restore()
  local caller = vim.api.nvim_get_current_win()
  return function()
    if vim.api.nvim_win_is_valid(caller) then
      vim.api.nvim_set_current_win(caller)
    end
  end
end

---Run fn with BufLeave/WinLeave suppressed, then restore eventignore even
---on error. Prevents floating callers (telescope) from detecting focus loss
---and destroying themselves while our window is opening.
local function with_suppressed_focus_events(fn)
  local saved = vim.o.eventignore
  vim.o.eventignore = 'BufLeave,WinLeave'
  local ok, err = pcall(fn)
  vim.o.eventignore = saved
  if not ok then error(err, 0) end
end

---Guarded construction. `builder(ctx)` runs under xpcall; `ctx:on_cleanup(fn)`
---registers a rollback. On error the rollbacks run in reverse and the error
---is rethrown; on success nothing runs (caller owns steady-state teardown).
function M.safe_setup(builder)
  local cleanups = {}
  local ctx = {}
  function ctx:on_cleanup(fn) table.insert(cleanups, fn) end
  local ok, err = xpcall(function() builder(ctx) end, debug.traceback)
  if not ok then
    for i = #cleanups, 1, -1 do pcall(cleanups[i]) end
    error(err, 0)
  end
end

---@param prompt_buf integer
---@param handlers { on_confirm: function, on_cancel: function, on_move: fun(delta:integer), extras?: table<string, function> }
function M.install_nav_keymaps(prompt_buf, handlers)
  local map = function(lhs, fn)
    vim.keymap.set('i', lhs, fn, { buffer = prompt_buf, nowait = true })
  end
  map('<CR>',   handlers.on_confirm)
  map('<Esc>',  handlers.on_cancel)
  map('<C-c>',  handlers.on_cancel)
  map('<C-n>',  function() handlers.on_move(1)  end)
  map('<C-j>',  function() handlers.on_move(1)  end)
  map('<Down>', function() handlers.on_move(1)  end)
  map('<C-p>',  function() handlers.on_move(-1) end)
  map('<C-k>',  function() handlers.on_move(-1) end)
  map('<Up>',   function() handlers.on_move(-1) end)
  if handlers.extras then
    for lhs, fn in pairs(handlers.extras) do map(lhs, fn) end
  end
end

---Safety net: when a picker window is closed externally, cancel the picker.
function M.install_winclosed_cancel(buf, cancel_fn)
  vim.api.nvim_create_autocmd('WinClosed', {
    buffer = buf, once = true,
    callback = function() vim.schedule(cancel_fn) end,
  })
end

---Open a floating window with focus-event suppression and register a
---cleanup that closes the window on rollback. Returns the new win id.
---@param ctx any safe_setup ctx (must provide :on_cleanup)
---@param opts { buf: integer, enter: boolean, config: vim.api.keyset.win_config }
---@return integer win
function M.open_float(ctx, opts)
  local win
  with_suppressed_focus_events(function()
    win = vim.api.nvim_open_win(opts.buf, opts.enter, opts.config)
  end)
  ctx:on_cleanup(function() pcall(vim.api.nvim_win_close, win, true) end)
  return win
end

---Build a single-shot teardown closure. The returned function latches on
---first call: issues `stopinsert` per `deps.stopinsert` policy, closes
---each window in `wins`, restores caller focus, shows line numbers (if
---requested), then invokes the trailing callback. Subsequent calls no-op.
---
---`deps.stopinsert` (default `'always'`):
---  - `'always'` — `stopinsert` unconditionally (legacy behaviour).
---  - `'never'`  — skip the cmd entirely. Use when focus has already moved
---                 to a caller window whose insert mode must be preserved
---                 (e.g. WinClosed fallbacks).
---  - `'auto'`   — `stopinsert` iff currently in insert mode. Use when the
---                 finalizer is shared between keymap paths that may be
---                 triggered from either insert or normal mode.
---@param deps { wins: integer[], restore_caller?: fun(), hide_line_numbers?: boolean, stopinsert?: 'always'|'never'|'auto' }
---@return fun(cb?: fun(...), ...): nil finalize
function M.make_finalizer(deps)
  local finished = false
  local line_numbers = deps.hide_line_numbers and require('pde.ui.line_numbers') or nil
  local stopinsert_mode = deps.stopinsert or 'always'
  return function(cb, ...)
    if finished then return end
    finished = true
    if stopinsert_mode == 'always'
      or (stopinsert_mode == 'auto' and vim.fn.mode():sub(1, 1) == 'i') then
      vim.cmd('stopinsert')
    end
    for _, w in ipairs(deps.wins) do
      pcall(vim.api.nvim_win_close, w, true)
    end
    if deps.restore_caller then deps.restore_caller() end
    if line_numbers then line_numbers.show() end
    if cb then cb(...) end
  end
end

---Install a TextChangedI handler that fuzzy-filters `search_list` by the
---prompt buffer's first line. `on_filtered` receives an integer array
---mapping query-result order → original item index. An empty query resets
---to the full list.
---@param prompt_buf integer
---@param search_list { display: string, orig: integer }[]
---@param on_filtered fun(filtered: integer[])
function M.install_fuzzy_filter(prompt_buf, search_list, on_filtered)
  vim.api.nvim_create_autocmd('TextChangedI', {
    buffer = prompt_buf,
    callback = function()
      local query = vim.api.nvim_buf_get_lines(prompt_buf, 0, 1, false)[1] or ''
      local filtered
      if query == '' then
        filtered = {}
        for i = 1, #search_list do filtered[i] = i end
      else
        local matched = vim.fn.matchfuzzy(search_list, query, { key = 'display' })
        filtered = vim.tbl_map(function(m) return m.orig end, matched)
      end
      on_filtered(filtered)
    end,
  })
end

---Build the parallel arrays used by the fuzzy-filter pattern: `formatted[i]`
---is the display string for item i; `search_list` is what `matchfuzzy` needs.
---@param items any[]
---@param format_item fun(item: any): string
---@return string[] formatted
---@return { display: string, orig: integer }[] search_list
function M.build_fuzzy_list(items, format_item)
  local formatted, search_list = {}, {}
  for i, item in ipairs(items) do
    local s = format_item(item)
    formatted[i]   = s
    search_list[i] = { display = s, orig = i }
  end
  return formatted, search_list
end

---Bounds-clamp `selected + delta` to [1, max(#filtered, 1)] and update the
---cursor in `res_win`. Returns the new selected index so the caller can
---assign it back.
---@param selected integer
---@param delta integer
---@param filtered integer[]
---@param res_win integer
---@return integer new_selected
function M.cursor_step(selected, delta, filtered, res_win)
  selected = math.max(1, math.min(selected + delta, math.max(#filtered, 1)))
  if #filtered > 0 then
    pcall(vim.api.nvim_win_set_cursor, res_win, { selected, 0 })
  end
  return selected
end

---Hide line numbers for the duration of a safe_setup block. Restores them
---on rollback. Happy-path restoration still goes through make_finalizer's
---hide_line_numbers=true flag.
---@param ctx any safe_setup ctx (must provide :on_cleanup)
function M.hide_line_numbers_scoped(ctx)
  local line_numbers = require('pde.ui.line_numbers')
  line_numbers.hide()
  ctx:on_cleanup(function() line_numbers.show() end)
end

---Write `lines` into a read-only result buffer and optionally anchor the
---cursor. Toggles modifiable around the write. Pass `selected = nil` when
---`lines` is a placeholder (empty-state hint) so the cursor stays put.
---@param buf integer
---@param win integer
---@param lines string[]
---@param selected integer|nil
function M.render_list(buf, win, lines, selected)
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, #lines > 0 and lines or { '' })
  vim.bo[buf].modifiable = false
  if selected then
    pcall(vim.api.nvim_win_set_cursor, win, { selected, 0 })
  end
end

---Open the results-pane-above, prompt-pane-below pair shared by the fuzzy
---vim.ui.select branch and live_select. Both wins use zindex=60 and the
---supplied border. Results pane gets cursorline; prompt pane gets
---winfixbuf and a titled border (title_pos='left').
---@param ctx any safe_setup ctx
---@param opts { width: integer, res_height: integer, start_row: integer, start_col: integer, border: any, title: string }
---@return integer res_buf, integer res_win, integer prompt_buf, integer prompt_win
function M.open_results_prompt_pair(ctx, opts)
  local float = require('ui.float')

  local res_buf = float.scratch_buf()
  local res_win = M.open_float(ctx, {
    buf    = res_buf,
    enter  = false,
    config = {
      relative  = 'editor',
      width     = opts.width,
      height    = opts.res_height,
      row       = opts.start_row,
      col       = opts.start_col,
      style     = 'minimal',
      border    = opts.border,
      focusable = false,
      zindex    = 60,
    },
  })
  vim.wo[res_win].cursorline = true

  local prompt_buf = float.scratch_buf()
  local prompt_win = M.open_float(ctx, {
    buf    = prompt_buf,
    enter  = true,
    config = {
      relative  = 'editor',
      width     = opts.width,
      height    = 1,
      row       = opts.start_row + opts.res_height + 2,
      col       = opts.start_col,
      style     = 'minimal',
      border    = opts.border,
      title     = ' ' .. opts.title .. ' ',
      title_pos = 'left',
      zindex    = 60,
    },
  })
  vim.wo[prompt_win].winfixbuf = true

  return res_buf, res_win, prompt_buf, prompt_win
end

return M
