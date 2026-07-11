-- Lightweight startup/runtime profiling framework.
--
-- Enabled by setting the env var NVIM_PROFILE=1:
--   $ NVIM_PROFILE=1 nvim
-- When unset, every function below is a zero-overhead no-op.
--
-- API:
--   profile.tick(label)            one-shot marker; emits "<elapsed> ms  <label>"
--   profile.time(label, fn, ...)   times a function call; forwards return values
--   profile.section(label)         returns a stopper fn to end a block and emit
--                                  "<label> (X ms)"
--   profile.mark_autocmds(events)  registers once-autocmds that tick when the
--                                  given events fire
--   profile.dump()                 open a scratch buffer with all profile lines
--                                  (also registered as the `:Profile` command)
--
-- Output policy:
--   • Lines are written to :messages (history=true), buffered in Lua, and
--     additionally surfaced via `:Profile` for a clean, scrollable view.
--   • 'messagesopt' gets 'wait:0,history:2000,progress:c'.
--   • 'more' is *temporarily* switched off to stop the hit-enter / --More--
--     prompt during startup, then restored on UIEnter so `:messages` still
--     paginates normally afterwards.

local M = {}

M.enabled = (vim.env.NVIM_PROFILE == '1')

local t0 = vim.uv.hrtime()
local buffer = {}

if M.enabled then
  vim.opt.messagesopt = { 'wait:0', 'history:2000', 'progress:c' }

  -- Disable pagination only until the UI is ready, then put it back.
  -- This kills the startup "Press ENTER" prompt without breaking :messages.
  local prev_more = vim.o.more
  vim.o.more = false
  vim.api.nvim_create_autocmd('UIEnter', {
    once = true,
    callback = function()
      vim.schedule(function() vim.o.more = prev_more end)
    end,
  })

  local function emit(label)
    local msg = string.format('[profile] %8.1f ms  %s', (vim.uv.hrtime() - t0) / 1e6, label)
    table.insert(buffer, msg)
    vim.api.nvim_echo({ { msg } }, true, {})
  end

  M.tick = emit

  M.time = function(label, fn, ...)
    local s = vim.uv.hrtime()
    local function finish(ok, ...)
      emit(string.format('%s (%.1f ms)', label, (vim.uv.hrtime() - s) / 1e6))
      if not ok then error((...), 0) end
      return ...
    end
    return finish(pcall(fn, ...))
  end

  M.section = function(label)
    local s = vim.uv.hrtime()
    return function()
      emit(string.format('%s (%.1f ms)', label, (vim.uv.hrtime() - s) / 1e6))
    end
  end

  -- Opts:
  --   suffix = ' (first)' — append to the emitted label, useful when you
  --                          register the same event twice (before/after a
  --                          plugin loads) to bracket its handler cost.
  M.mark_autocmds = function(events, opts)
    opts = opts or {}
    local suffix = opts.suffix or ''
    for _, ev in ipairs(events) do
      vim.api.nvim_create_autocmd(ev, {
        once = true,
        callback = function() emit('autocmd ' .. ev .. suffix) end,
      })
    end
  end

  M.dump = function()
    vim.cmd('new')
    vim.bo.buftype = 'nofile'
    vim.bo.bufhidden = 'wipe'
    vim.bo.swapfile = false
    vim.bo.modifiable = true
    pcall(vim.api.nvim_buf_set_name, 0, 'profile://timeline')
    vim.api.nvim_buf_set_lines(0, 0, -1, false, buffer)
    vim.bo.modifiable = false
    vim.bo.modified = false
  end

  require('utils.cmd').new_cmd('Profile', function() M.dump() end,
    { desc = 'Open profile timeline in a scratch buffer' })
else
  M.tick          = function() end
  M.time          = function(_, fn, ...) return fn(...) end
  M.section       = function() return function() end end
  M.mark_autocmds = function() end
  M.dump          = function() end
end

return M
