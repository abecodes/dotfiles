local logger = require('logger')
local utils = require('utils')
local bucket = require('hooks.bucket')
local validate = require('hooks.validate')

---@class Hook
local M = {}

--- @param hooks table
M.init = function(hooks)
	for fileID, events in pairs(hooks) do
		for event, hookList in pairs(events) do
			if not (type(hookList) == 'table') or not (hookList.func == nil) then
				logger.warn('[hook:'..fileID..':'..event..'] expects an array')
				goto next_event
			end
			for _, hook in ipairs(hookList) do
				if validate.hook(fileID, event, hook) then
					bucket.add_hook(fileID, event, hook)
				end
			end
			::next_event::
		end
	end

	bucket.reconcile()

	if vim.v.vim_did_enter == 1 then
		bucket.create_au_grps()
	else
		utils.autocmd.new_autocmd('VimEnter', 'codes.abe.hook.0', {
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

	local added = false
	for _, f in ipairs(hook) do
		if validate.hook(fileID, event, f) then
			bucket.add_hook(fileID, event, f)
			added = true
		end
	end

	if not added then return end

	bucket.reconcile()
	-- Pre-VimEnter: defer to the VimEnter handler installed by M.init;
	-- it runs create_au_grps with all hooks at once (and is idempotent).
	if vim.v.vim_did_enter == 1 then
		bucket.create_au_grps()
	end
end

return M
