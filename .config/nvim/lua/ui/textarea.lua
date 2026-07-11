local common = require('ui.common')
local float  = require('ui.float')

---@class ui.textarea.Opts
---@field prompt? string
---@field default? string
---@field filetype? string

---@param opts ui.textarea.Opts
---@param on_confirm fun(text: string|nil)
return function(opts, on_confirm)
  opts = opts or {}
  local title    = opts.prompt   or 'Input'
  local default  = opts.default  or ''
  local filetype = opts.filetype or 'markdown'

  local restore_caller = common.caller_win_restore()

  local buf, win
  common.safe_setup(function(ctx)
    common.hide_line_numbers_scoped(ctx)

    buf = float.scratch_buf({ filetype = filetype })
    ctx:on_cleanup(function()
      if vim.api.nvim_buf_is_valid(buf) then
        pcall(vim.api.nvim_buf_delete, buf, { force = true })
      end
    end)
    if default ~= '' then
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, vim.split(default, '\n', { plain = true }))
    end

    local width  = math.min(math.floor(vim.o.columns * 0.6), 100)
    local height = math.min(math.floor(vim.o.lines * 0.4), 15)
    local row, col = float.center(width, height)

    win = common.open_float(ctx, {
      buf    = buf,
      enter  = true,
      config = {
        relative   = 'editor',
        width      = width,
        height     = height,
        row        = row,
        col        = col,
        style      = 'minimal',
        border     = float.border(),
        title      = ' ' .. title .. ' ',
        title_pos  = 'left',
        footer     = ' <C-s> submit  |  q / <Esc> cancel ',
        footer_pos = 'right',
      },
    })
  end)

  vim.cmd('startinsert')

  -- Keymap-driven teardown still owns focus, so stopinsert must run while the
  -- window is ours. The WinClosed path fires after focus has already moved to
  -- the caller; issuing stopinsert there would drop the caller (e.g. telescope
  -- prompt) out of insert mode.
  local finalize = common.make_finalizer({
    wins               = { win },
    restore_caller     = restore_caller,
    hide_line_numbers  = true,
  })
  local finalize_external = common.make_finalizer({
    wins               = { win },
    restore_caller     = restore_caller,
    hide_line_numbers  = true,
    stopinsert         = 'never',
  })

  local done = false
  local function submit()
    if done then return end
    done = true
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    finalize(on_confirm, table.concat(lines, '\n'))
  end
  local function cancel()
    if done then return end
    done = true
    finalize(on_confirm, nil)
  end
  local function cancel_external()
    if done then return end
    done = true
    finalize_external(on_confirm, nil)
  end

  vim.keymap.set({ 'i', 'n' }, '<C-s>', submit, { buffer = buf, nowait = true })
  vim.keymap.set('n',          'q',     cancel, { buffer = buf, nowait = true })
  vim.keymap.set('n',          '<Esc>', cancel, { buffer = buf, nowait = true })

  common.install_winclosed_cancel(buf, cancel_external)
end
