local common = require('ui.common')
local float  = require('ui.float')

vim.ui.input = function(opts, on_confirm)
  opts = opts or {}
  local prompt  = opts.prompt  or 'Input: '
  local default = opts.default or ''
  -- TODO: opts.completion (vim.ui.input contract). Minimum viable impl:
  -- set vim.bo[buf].omnifunc to a wrapper over
  -- vim.fn.getcompletion(prefix, opts.completion) and bind <Tab> to
  -- <C-x><C-o>. Currently 'file'/'dir'/'command'/etc are ignored silently.

  local restore_caller = common.caller_win_restore()

  local buf, win
  common.safe_setup(function(ctx)
    buf = float.scratch_buf()
    ctx:on_cleanup(function()
      if vim.api.nvim_buf_is_valid(buf) then
        pcall(vim.api.nvim_buf_delete, buf, { force = true })
      end
    end)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, { default })

    local width = math.max(40, math.min(80, math.floor(vim.o.columns * 0.4)))

    win = common.open_float(ctx, {
      buf    = buf,
      enter  = true,
      config = {
        relative  = 'editor',
        width     = width,
        height    = 1,
        row       = math.floor(vim.o.lines / 2) - 2,
        col       = math.floor((vim.o.columns - width) / 2),
        style     = 'minimal',
        border    = float.border(),
        title     = ' ' .. prompt .. ' ',
        title_pos = 'left',
      },
    })
    vim.wo[win].winblend = 0
    -- Single-line prompt: scroll horizontally with the cursor pinned to the
    -- right edge instead of wrapping. With wrap on, a height-1 window paints
    -- the `<<<` NonText marker over a partial wrapped segment, and as you type
    -- past the edge the growing marker overpaints the chars you just typed.
    -- wrap=off keeps the just-typed char visible; the precedes/extends
    -- listchars give a static `<`/`>` truncation hint that never covers text.
    vim.wo[win].wrap      = false
    vim.wo[win].list      = true
    vim.wo[win].listchars = 'precedes:<,extends:>'
  end)

  vim.cmd('startinsert!')

  local confirmed = false

  -- Keymap-driven close goes through the shared finalizer with stopinsert
  -- 'always' so insert mode ends while we still own the window — otherwise
  -- focus can land on the caller (telescope etc.) mid-insert. The WinClosed
  -- fallback below uses its own minimal path because focus has already
  -- moved and issuing stopinsert would disturb the caller.
  local finalize = common.make_finalizer({
    wins           = { win },
    restore_caller = restore_caller,
  })

  local function close_input(value)
    if confirmed then return end
    confirmed = true
    finalize(on_confirm, value)
  end

  vim.keymap.set({ 'i', 'n' }, '<CR>', function()
    close_input(vim.api.nvim_buf_get_lines(buf, 0, 1, false)[1])
  end, { buffer = buf, nowait = true })

  vim.keymap.set({ 'i', 'n' }, '<Esc>', function()
    close_input(nil)
  end, { buffer = buf, nowait = true })

  vim.keymap.set('i', '<C-c>', function()
    close_input(nil)
  end, { buffer = buf, nowait = true })

  vim.api.nvim_create_autocmd('WinClosed', {
    buffer = buf,
    once = true,
    callback = function()
      -- Window was closed externally: don't call stopinsert, we're already
      -- in a different window at this point.
      if confirmed then return end
      confirmed = true
      vim.schedule(restore_caller)
      vim.schedule(function() on_confirm(nil) end)
    end,
  })
end
