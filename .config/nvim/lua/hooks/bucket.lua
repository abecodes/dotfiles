local utils = require('utils')
local logger = require('logger')
local config = require('hooks.config')

-- local isFuncValid  = function(hook)
-- 	if not (type(hook.func) == 'function') then
-- 		logger.warn(logger.dump(hook.func)..' in no valid param to func')
-- 		return false
-- 	end

-- 	return true
-- end

local eventBucketHasHook = function(eventBucket, hook)
	for _, h in pairs(eventBucket) do
		if h.id == hook.id then
			return true
		end
	end

	return false
end

local getEventFunc = function(eventBucket)
	-- sort ascending
	table.sort(
		eventBucket,
		function(a,b)
			if a.order == b.order then
				return a.id < b.id
			end
			return a.order < b.order
		end)

	return function()
		for _, hook in pairs(eventBucket) do
			hook.func()
		end
	end
end

---@class Bucket
local M = {}
-- tracks hooks
M.H = {}
-- tracks grps
M.G = {}
M.version = 0

M.add_hook = function(fileID, events, hook)
	for _, id in pairs(utils.split(fileID:gsub(', ', ','), ',')) do
		if not M.H[id] then
			M.H[id] = {}
		end

		--trim possible spaces
		events = events:gsub("%s+", "")
		for _, event in pairs(utils.split(events, ',')) do
			if not M.H[id][event] then
				M.H[id][event] = {}
			end

			if type(hook) == 'function' then
				hook = { func = hook }
			end

			if not hook.order then
				hook.order = 100
			end

			if not hook.id then
				hook.id = config.getID()
			end

			-- if isFuncValid(hook) then
			table.insert(M.H[id][event], {
				id = hook.id,
				order = hook.order,
				func = hook.func,
			})
			-- end
		end

		if id == '*' and not (M.version == 0) then
			M.reconcile()
		end
	end
end

M.has_no_star = function()
	return M.H['*'] == nil
end

M.get_star_pattern = function()
	if M.has_no_star() then
		return '*'
	end
	local ignored = {}
	for fileID, _ in pairs(M.H) do
		if not (id == '*') then
			table.insert(ignored, fileID)
		end
	end

	-- lifesafer: https://groups.google.com/g/vim_use/c/I_ssfzT8FD8/m/n6eSynJRMkUJ
	return '*\\('..table.concat(ignored, '\\|')..'\\)\\@<!'
end

M.reconcile = function()
	if M.has_no_star() then
		M.version = M.version + 1
		return
	end

	for event, hooks in pairs(M.H['*']) do
		for fileID, _ in pairs(M.H) do
			if not M.H[fileID][event] then
				M.H[fileID][event] = {}
				for _, hook in pairs(hooks) do
					table.insert(M.H[fileID][event],  hook)
				end
			else
				for _, hook in pairs(hooks) do
					if not eventBucketHasHook(M.H[fileID][event], hook) then
						if config.get_append_star() then
							table.insert(M.H[fileID][event], hook)
						else
							table.insert(M.H[fileID][event], 1, hook)
						end
					end
				end
			end
		end
	end

	M.version = M.version + 1
	return
end

M.create_au_grps = function()
	for fileID, events in pairs(M.H) do
		local pattern = fileID
		if fileID == '*' then
			pattern = M.get_star_pattern()
		end
		for event, eventBucket in pairs(events) do
			local auID = config.getID()
			local f = getEventFunc(eventBucket)
			utils.new_autocmd(event, 'codes.abe.hook.'..auID, {
				pattern = pattern,
				callback = function()
					f()
				end
			})

			if not M.G[fileID] then
				M.G[fileID] = {}
			end
			if not M.G[fileID][event] then
				M.G[fileID][event] = {}
			end

			M.G[fileID][event] = auID

			logger.debug(
				'[codes.abe.hook.'
				..auID..
				'] added au for '
				.. pattern ..
				' '
				.. event
			)
		end
	end
end

M.print_au_grps = function()
	vim.pretty_print(M.G)
end

M.print_hooks = function()
	vim.pretty_print(M.H)
end

return M
