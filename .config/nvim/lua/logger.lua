local name = '{plugins}'
local debug = false

---@class Logger
local M = {}

--- @param msg string
--- @param hl? string
M.log = function(msg, hl)
    vim.api.nvim_echo({{name .. ': ', hl}, {msg}}, true, {})
end

--- @param msg string
M.warn = function(msg) M.log(msg, 'WarningMsg') end

--- @param msg string
M.debug = function(msg) if debug then M.log(msg, 'Todo') end end

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
