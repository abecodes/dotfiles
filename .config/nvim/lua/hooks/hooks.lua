local logger = require('logger')
local utils = require('utils')
local bucket = require('hooks.bucket')
local validate = require('hooks.validate')
local api = vim.api

---@class Hook
local M = {}

--- @param opts HookOptions
M.init = function(hooks)
	for fileID, events in pairs(hooks) do
		for event, hooks in pairs(events) do
		if not (type(hooks) == 'table') or not (hooks.func == nil) then
			logger.warn('[hook:'..fileID..':'..event..'] expects an array')
			return
		end
			for _, hook in pairs(hooks) do
				if validate.hook(fileID, event, hook) then
					bucket.add_hook(fileID, event, hook)
				end
			end
		end
	end

	bucket.reconcile()

	if vim.v.vim_did_enter == 1 then
		bucket.create_au_grps()
	else
		utils.new_autocmd('VimEnter', 'codes.abe.hook.0', {
			pattern = '*',
			callback = function()
				bucket.create_au_grps()
			end
		})
	end
end

M.register = function(fileID, event, hook)
	if not (type(hook) == 'table') or not (hook.func == nil) then
		logger.warn('[hook:'..fileID..':'..event..'] expects an array')
		return
	end

	for _, f in pairs(hook) do
		if validate.hook(fileID, event, f) then
			bucket.add_hook(fileID, event, f)
			bucket.reconcile()
		end
	end
end

return M
