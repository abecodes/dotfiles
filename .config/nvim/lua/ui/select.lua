local common = require('ui.common')
local float  = require('ui.float')

vim.ui.select = function(items, opts, on_choice)
  if #items == 0 then on_choice(nil, nil); return end

  opts = opts or {}
  local format_item = opts.format_item or tostring
  local title       = opts.prompt      or 'Select:'
  if opts.kind then title = title .. ' [' .. opts.kind .. ']' end

  local restore_caller = common.caller_win_restore()

  -- ── Simple picker (≤ 3 items) ──────────────────────────────────────────
  if #items <= 3 then
    local bd_win, buf, win
    common.safe_setup(function(ctx)
      common.hide_line_numbers_scoped(ctx)

      bd_win = float.make_backdrop()
      ctx:on_cleanup(function() pcall(vim.api.nvim_win_close, bd_win, true) end)

      local lines = {}
      local max_length = 0
      for _, item in ipairs(items) do
        local line = format_item(item)
        table.insert(lines, line)
        max_length = math.max(max_length, #line)
      end

      buf = float.scratch_buf()
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.bo[buf].modifiable = false

      local width  = math.min(math.max(max_length, #title), math.floor(vim.o.columns * 0.6))
      local height = #items
      local row, col = float.center(width, height)
      win = common.open_float(ctx, {
        buf    = buf,
        enter  = true,
        config = {
          relative  = 'editor',
          width     = width,
          height    = height,
          row       = row,
          col       = col,
          style     = 'minimal',
          border    = float.border(),
          title     = ' ' .. title .. ' ',
          title_pos = 'left',
          zindex    = 60,
        },
      })
      vim.wo[win].winfixbuf  = true
      vim.wo[win].cursorline = true
    end)

    -- Keymap-driven teardown still owns focus, so stopinsert must run while
    -- the window is ours. The WinClosed path fires after focus has already
    -- moved to the caller; issuing stopinsert there would drop the caller
    -- (e.g. telescope prompt) out of insert mode.
    local finalize = common.make_finalizer({
      wins              = { bd_win, win },
      restore_caller    = restore_caller,
      hide_line_numbers = true,
    })
    local finalize_external = common.make_finalizer({
      wins              = { bd_win, win },
      restore_caller    = restore_caller,
      hide_line_numbers = true,
      stopinsert        = 'never',
    })
    local done = false
    local function choose(idx)
      if done then return end
      done = true
      finalize(on_choice, idx and items[idx] or nil, idx)
    end
    local function choose_external()
      if done then return end
      done = true
      finalize_external(on_choice, nil, nil)
    end

    vim.keymap.set('n', '<CR>',  function() choose(vim.api.nvim_win_get_cursor(0)[1]) end, { buffer = buf, nowait = true })
    vim.keymap.set('n', '<Esc>', function() choose(nil) end,                               { buffer = buf, nowait = true })
    common.install_winclosed_cancel(buf, choose_external)
    return
  end

  -- ── Fuzzy picker (> 3 items) ───────────────────────────────────────────
  local formatted, search_list = common.build_fuzzy_list(items, format_item)

  local max_len = 0
  for _, s in ipairs(formatted) do max_len = math.max(max_len, #s) end

  local width      = math.min(math.max(max_len, #title + 4), math.floor(vim.o.columns * 0.6))
  local res_height = math.min(#items, math.floor(vim.o.lines * 0.4))
  -- total height: res (res_height + 2 borders) + prompt (1 + 2 borders) = res_height + 5
  local start_row  = math.floor((vim.o.lines - (res_height + 5)) / 2)
  local start_col  = math.floor((vim.o.columns - width) / 2)

  local filtered = {}
  for i = 1, #items do filtered[i] = i end
  local selected = 1

  local bd_win, res_buf, res_win, prompt_buf, prompt_win
  common.safe_setup(function(ctx)
    common.hide_line_numbers_scoped(ctx)

    bd_win = float.make_backdrop()
    ctx:on_cleanup(function() pcall(vim.api.nvim_win_close, bd_win, true) end)

    res_buf, res_win, prompt_buf, prompt_win = common.open_results_prompt_pair(ctx, {
      width      = width,
      res_height = res_height,
      start_row  = start_row,
      start_col  = start_col,
      border     = float.border(),
      title      = title,
    })
  end)

  local function render()
    local lines = {}
    for _, idx in ipairs(filtered) do
      table.insert(lines, formatted[idx])
    end
    common.render_list(res_buf, res_win, lines, #filtered > 0 and selected or nil)
  end
  render()

  vim.cmd('startinsert')

  -- Keymap-driven teardown still owns focus, so stopinsert must run while the
  -- window is ours. The WinClosed path fires after focus has already moved to
  -- the caller; issuing stopinsert there would drop the caller (e.g. telescope
  -- prompt) out of insert mode.
  local finalize = common.make_finalizer({
    wins              = { bd_win, prompt_win, res_win },
    restore_caller    = restore_caller,
    hide_line_numbers = true,
  })
  local finalize_external = common.make_finalizer({
    wins              = { bd_win, prompt_win, res_win },
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
  end

  common.install_nav_keymaps(prompt_buf, {
    on_confirm = function() choose(filtered[selected]) end,
    on_cancel  = function() choose(nil) end,
    on_move    = move,
  })

  -- matchfuzzy runs synchronously over the full item list on every keystroke.
  -- Fine for typical picker sizes (< a few thousand items). Scaling paths if
  -- this ever feels laggy:
  --   1. Debounce: wrap the body in vim.defer_fn(fn, ~30ms) with a version
  --      counter so held-down keys coalesce into a single match. See
  --      lua/ui/picker.lua's render_preview for the pattern.
  --   2. Chunked scoring: split search_list into N-sized chunks, process each
  --      via vim.schedule, merge results. Cancellable on next keystroke via
  --      version counter. Only worth the code when > 50k items.
  common.install_fuzzy_filter(prompt_buf, search_list, function(f)
    filtered = f
    selected = 1
    render()
  end)

  common.install_winclosed_cancel(prompt_buf, choose_external)
end
