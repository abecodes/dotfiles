local name = '{plugins}'
local debug = false

---@class Logger
local M = {}

--- @param msg string
--- @param level string
--- vim.log.levels.DEBUG | vim.log.levels.ERROR | vim.log.levels.INFO | vim.log.levels.TRACE | vim.log.levels.WARN | vim.log.levels.OFF
M.log = function(msg, level)
		if level == "" then
			level = vim.log.levels.INFO
		end
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
M.error = function(msg) M.log(msg, vim.log.levels.ERROR) end

--- @param msg string
M.warn = function(msg) M.log(msg, vim.log.levels.WARN) end

--- @param msg string
M.debug = function(msg) if debug then M.log(msg, vim.log.levels.DEBUG) end end

M.dump = function(o)
	M.warn('rather use vim.pretty_print')
	if type(o) == 'table' then
		local s = '{ '
		for k,v in pairs(o) do
			s = s .. '\n['..k..'] = ' .. M.dump(v) .. ',\n'
		end
		return s .. '} '
	end

	if type(o) == 'boolean' then
		bool_to_string={ [true]='true', [false]='false' }
		return bool_to_string[o]
	end

	if type(o) == 'number' then
		return o
	end

	if type(o) == 'function' then
		return 'function'
	end

    if type(o) == 'string' then
		return '"'..o..'"'
	end

    print('unhandled type '.. type(o))
	return ''
end

return M
