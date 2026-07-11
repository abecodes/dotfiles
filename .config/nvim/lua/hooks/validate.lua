local logger = require('logger')

local validateHook = function(fileID, event, hook)
	if type(hook) == 'function' then
		return true
	end

	if type(hook) == 'table' then
		if type(hook.func) == 'function' then
			return true
		end

		logger.warn('[hook]' .. fileID .. ':' .. event .. ' expected to be either a function or a table, got ' .. type(hook))
		return false
	end

	logger.warn('[hook:' .. fileID .. ':' .. event .. '] has no hook')
	return false
end

local M = {}

M.hook = function(fileID, event, hook)
	if not (type(fileID) == 'string') then
		logger.warn('[hook] fileID is not a string: can`t set')
		return false
	end

	if not (type(event) == 'string') then
		logger.warn('[hook:'..fileID..'] event is not a string: can`t set')
		return false
	end

	return validateHook(fileID, event, hook)
end

return M
