local common = require('ui.common')
local float  = require('ui.float')

---@class ui.picker.Opts
---@field prompt? string
---@field format_item? fun(item: any): string
---@field preview? fun(item: any): string[]
---@field preview_filetype? string
---@field on_refresh? fun()  bound to <C-r>; closes the picker and invokes this callback
---@field preselect_index? integer  initial highlighted row (1-based, clamped to [1, #items])
---@field actions? table<string, fun(item: any|nil, idx: integer|nil)>  map of key-lhs to handler; handler runs after picker finalize with the highlighted item (or nil if nothing highlighted)

---@param items any[]
---@param opts ui.picker.Opts
---@param on_choice fun(item: any|nil, idx: integer|nil)
return function(items, opts, on_choice)
  opts = opts or {}
  if #items == 0 then on_choice(nil); return end

  local format_item = opts.format_item or tostring
  local preview_fn  = opts.preview     or function(_) return {} end
  local title       = opts.prompt      or 'Select:'

  local restore_caller = common.caller_win_restore()

  local formatted, search_list = common.build_fuzzy_list(items, format_item)

  local total_w = math.min(math.floor(vim.o.columns * 0.85), 160)
  local total_h = math.floor(vim.o.lines * 0.7)
  local res_w   = math.max(20, math.floor(total_w * 0.4))
  local prev_w  = total_w - res_w - 2
  local main_h  = math.max(5, total_h - 3)
  local start_row, start_col = float.center(total_w, total_h)

  local filtered = {}
  for i = 1, #items do filtered[i] = i end
  local selected = math.max(1, math.min(opts.preselect_index or 1, #items))

  local bd_win, res_buf, res_win, prev_buf, prev_win, prompt_buf, prompt_win
  common.safe_setup(function(ctx)
    common.hide_line_numbers_scoped(ctx)

    bd_win = float.make_backdrop()
    ctx:on_cleanup(function() pcall(vim.api.nvim_win_close, bd_win, true) end)

    local border = float.border()

    res_buf = float.scratch_buf()
    res_win = common.open_float(ctx, {
      buf    = res_buf,
      enter  = false,
      config = {
        relative  = 'editor',
        width     = res_w,
        height    = main_h,
        row       = start_row,
        col       = start_col,
        style     = 'minimal',
        border    = border,
        focusable = false,
        title     = ' ' .. title .. ' ',
        title_pos = 'left',
        zindex    = 60,
      },
    })
    vim.wo[res_win].cursorline = true

    prev_buf = float.scratch_buf({ buftype = 'nofile', filetype = opts.preview_filetype })
    prev_win = common.open_float(ctx, {
      buf    = prev_buf,
      enter  = false,
      config = {
        relative  = 'editor',
        width     = prev_w,
        height    = main_h,
        row       = start_row,
        col       = start_col + res_w + 2,
        style     = 'minimal',
        border    = border,
        focusable = false,
        title     = ' preview ',
        title_pos = 'left',
        zindex    = 60,
      },
    })
    vim.wo[prev_win].wrap      = true
    vim.wo[prev_win].linebreak = true

    prompt_buf = float.scratch_buf()
    prompt_win = common.open_float(ctx, {
      buf    = prompt_buf,
      enter  = true,
      config = {
        relative = 'editor',
        width    = total_w,
        height   = 1,
        row      = start_row + main_h + 2,
        col      = start_col,
        style    = 'minimal',
        border   = border,
        zindex   = 60,
      },
    })
    vim.wo[prompt_win].winfixbuf = true
  end)

  vim.cmd('startinsert')

  local function render_results()
    local lines = {}
    for _, idx in ipairs(filtered) do
      table.insert(lines, formatted[idx])
    end
    common.render_list(res_buf, res_win, lines, #filtered > 0 and selected or nil)
  end

  local function render_preview_now()
    local idx = filtered[selected]
    local lines = idx and preview_fn(items[idx]) or {}
    vim.bo[prev_buf].modifiable = true
    vim.api.nvim_buf_set_lines(prev_buf, 0, -1, false, lines)
    vim.bo[prev_buf].modifiable = false
  end

  -- Debounced wrapper: fast cursor movement (held `j`, scroll wheel) would
  -- otherwise re-run preview_fn on every step. The version counter lets the
  -- scheduled callback bail when another move happens before it fires.
  local preview_version = 0
  local PREVIEW_DEBOUNCE_MS = 30
  local function render_preview()
    preview_version = preview_version + 1
    local v = preview_version
    vim.defer_fn(function()
      if v ~= preview_version then return end
      if not vim.api.nvim_buf_is_valid(prev_buf) then return end
      render_preview_now()
    end, PREVIEW_DEBOUNCE_MS)
  end

  render_results()
  -- Initial render must be synchronous — the user expects a preview the
  -- instant the picker opens.
  render_preview_now()

  -- Keymap-driven teardown still owns focus, so stopinsert must run while the
  -- window is ours. The WinClosed path fires after focus has already moved to
  -- the caller; issuing stopinsert there would drop the caller (e.g. telescope
  -- prompt) out of insert mode.
  local finalize = common.make_finalizer({
    wins              = { bd_win, prompt_win, res_win, prev_win },
    restore_caller    = restore_caller,
    hide_line_numbers = true,
  })
  local finalize_external = common.make_finalizer({
    wins              = { bd_win, prompt_win, res_win, prev_win },
    restore_caller    = restore_caller,
    hide_line_numbers = true,
    stopinsert        = 'never',
  })
  local done = false
  local function choose(orig_idx)
    if done then return end
    done = true
    finalize(on_choice, orig_idx and items[orig_idx] or nil, orig_idx)
  end
  local function choose_external()
    if done then return end
    done = true
    finalize_external(on_choice, nil, nil)
  end

  local function move(delta)
    selected = common.cursor_step(selected, delta, filtered, res_win)
    render_preview()
  end

  local function scroll_preview(lhs)
    if not vim.api.nvim_win_is_valid(prev_win) then return end
    local keys = vim.api.nvim_replace_termcodes(lhs, true, false, true)
    vim.api.nvim_win_call(prev_win, function()
      vim.cmd('normal! ' .. keys)
    end)
  end

  local extras = {
    ['<C-d>']             = function() scroll_preview('<C-d>')   end,
    ['<C-u>']             = function() scroll_preview('<C-u>')   end,
    ['<C-f>']             = function() scroll_preview('<C-f>')   end,
    ['<C-b>']             = function() scroll_preview('<C-b>')   end,
    ['<ScrollWheelDown>'] = function() scroll_preview('3<C-e>')  end,
    ['<ScrollWheelUp>']   = function() scroll_preview('3<C-y>')  end,
  }
  if opts.on_refresh then
    extras['<C-r>'] = function()
      if done then return end
      done = true
      finalize(opts.on_refresh)
    end
  end
  for lhs, handler in pairs(opts.actions or {}) do
    extras[lhs] = function()
      if done then return end
      done = true
      local orig_idx = filtered[selected]
      finalize(handler, orig_idx and items[orig_idx] or nil, orig_idx)
    end
  end

  common.install_nav_keymaps(prompt_buf, {
    on_confirm = function() choose(filtered[selected]) end,
    on_cancel  = function() choose(nil) end,
    on_move    = move,
    extras     = extras,
  })

  -- matchfuzzy runs synchronously over the full item list on every keystroke.
  -- Fine for typical picker sizes (< a few thousand items). Scaling paths if
  -- this ever feels laggy:
  --   1. Debounce: wrap the body in vim.defer_fn(fn, ~30ms) with a version
  --      counter so held-down keys coalesce into a single match. See the
  --      render_preview pattern above for a concrete example.
  --   2. Chunked scoring: split search_list into N-sized chunks, process each
  --      via vim.schedule, merge results. Cancellable on next keystroke via
  --      version counter. Only worth the code when > 50k items.
  common.install_fuzzy_filter(prompt_buf, search_list, function(f)
    filtered = f
    selected = 1
    render_results()
    render_preview()
  end)

  common.install_winclosed_cancel(prompt_buf, choose_external)
end
