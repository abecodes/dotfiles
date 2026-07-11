local common = require('ui.common')
local float  = require('ui.float')

---@class ui.live_select.Opts
---@field prompt? string
---@field fetch fun(query: string, items_cb: fun(items: any[]))
---@field format_item? fun(item: any): string
---@field min_chars? integer
---@field debounce_ms? integer

---@param opts ui.live_select.Opts
---@param on_choice fun(item: any|nil)
return function(opts, on_choice)
  opts = opts or {}
  local format_item = opts.format_item or tostring
  local title       = opts.prompt      or 'Search'
  local min_chars   = opts.min_chars   or 2
  local debounce_ms = opts.debounce_ms or 150

  assert(type(opts.fetch) == 'function', 'live_select: opts.fetch is required')

  local restore_caller = common.caller_win_restore()

  local pending_timer
  local function clear_timer()
    if pending_timer then
      pending_timer:stop()
      if not pending_timer:is_closing() then pending_timer:close() end
      pending_timer = nil
    end
  end

  local bd_win, res_buf, res_win, prompt_buf, prompt_win
  common.safe_setup(function(ctx)
    common.hide_line_numbers_scoped(ctx)

    bd_win = float.make_backdrop()
    ctx:on_cleanup(function() pcall(vim.api.nvim_win_close, bd_win, true) end)

    local width      = math.min(math.floor(vim.o.columns * 0.5), 100)
    local res_height = math.floor(vim.o.lines * 0.3)
    local start_row  = math.floor((vim.o.lines - (res_height + 5)) / 2)
    local start_col  = math.floor((vim.o.columns - width) / 2)

    res_buf, res_win, prompt_buf, prompt_win = common.open_results_prompt_pair(ctx, {
      width      = width,
      res_height = res_height,
      start_row  = start_row,
      start_col  = start_col,
      border     = float.border(),
      title      = title,
    })
  end)

  vim.cmd('startinsert')

  local items    = {}
  local selected = 1

  local function render(hint)
    local lines
    if #items == 0 then
      lines = { hint or '' }
    else
      lines = {}
      for _, item in ipairs(items) do
        table.insert(lines, format_item(item))
      end
    end
    common.render_list(res_buf, res_win, lines, #items > 0 and selected or nil)
  end
  render('type ' .. min_chars .. '+ chars to search')

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
  local chosen = false
  local function choose(item)
    if chosen then return end
    chosen = true
    clear_timer()
    finalize(on_choice, item)
  end
  local function choose_external()
    if chosen then return end
    chosen = true
    clear_timer()
    finalize_external(on_choice, nil)
  end

  local function move(delta)
    if #items == 0 then return end
    selected = math.max(1, math.min(selected + delta, #items))
    pcall(vim.api.nvim_win_set_cursor, res_win, { selected, 0 })
  end

  common.install_nav_keymaps(prompt_buf, {
    on_confirm = function() choose(items[selected]) end,
    on_cancel  = function() choose(nil) end,
    on_move    = move,
  })

  local seq = 0

  vim.api.nvim_create_autocmd('TextChangedI', {
    buffer = prompt_buf,
    callback = function()
      local query = vim.api.nvim_buf_get_lines(prompt_buf, 0, 1, false)[1] or ''
      clear_timer()

      if #query < min_chars then
        items = {}
        selected = 1
        render('type ' .. min_chars .. '+ chars to search')
        return
      end

      seq = seq + 1
      local my_seq = seq

      pending_timer = vim.uv.new_timer()
      if not pending_timer then return end
      pending_timer:start(debounce_ms, 0, vim.schedule_wrap(function()
        if my_seq ~= seq or chosen then return end
        opts.fetch(query, vim.schedule_wrap(function(result)
          if my_seq ~= seq or chosen then return end
          items = result or {}
          selected = 1
          render('no matches')
        end))
      end))
    end,
  })

  common.install_winclosed_cancel(prompt_buf, choose_external)
end
