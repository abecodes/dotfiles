local name = '{plugins}'
local debug = vim.env.NVIM_DEBUG == '1'

---@class Logger
local M = {}

--- @param v boolean
M.set_debug = function(v) debug = v and true or false end

--- @param msg string
--- @param level integer vim.log.levels.DEBUG|ERROR|INFO|TRACE|WARN|OFF
M.log = function(msg, level)
    if vim.in_fast_event() then
      vim.schedule(function()
        vim.notify(msg, level)
      end)
    else
      vim.notify(msg, level)
    end
    -- vim.api.nvim_echo({{name .. ': ', hl}, {msg}}, true, {})
end

--- @param msg string
M.info = function(msg) M.log(msg, vim.log.levels.INFO) end

--- @param msg string
M.error = function(msg) M.log(msg, vim.log.levels.ERROR) end

--- @param msg string
M.warn = function(msg) M.log(msg, vim.log.levels.WARN) end

--- @param msg string
M.debug = function(msg) if debug then M.log(msg, vim.log.levels.DEBUG) end end

return M
