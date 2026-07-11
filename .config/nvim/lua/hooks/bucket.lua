local utils = require('utils')
local logger = require('logger')
local config = require('hooks.config')

-- Vim regex negative lookbehind (see `:h /\@<!`). When a hook is registered
-- for '*.go', the '*' bucket's pattern becomes `*\(go\)\@<!` so the '*.go'
-- handler isn't double-fired.
local NEG_LOOKBEHIND = '\\@<!'

---Pattern-style fileIDs: '*' or '*.ext' (any level). Anything else is treated
---as a filetype name (e.g. 'NvimTree', 'gitcommit') and dispatched via a
---pattern='*' autocmd with a runtime filetype guard.
local function is_pattern_fileid(id)
	return id == '*' or id:sub(1, 2) == '*.'
end

local eventBucketHasHook = function(eventBucket, hook)
	for _, h in ipairs(eventBucket) do
		if h.id == hook.id then
			return true
		end
	end

	return false
end

local getEventFunc = function(eventBucket)
	-- sort on every invocation so late-registered hooks participate in ordering.
	-- buckets are tiny; the cost is negligible.
	return function()
		table.sort(
			eventBucket,
			function(a,b)
				if a.order == b.order then
					return a.id < b.id
				end
				return a.order < b.order
			end)
		for _, hook in ipairs(eventBucket) do
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
	for _, id in ipairs(vim.split(fileID:gsub(', ', ','), ',', { plain = true })) do
		if not M.H[id] then
			M.H[id] = {}
		end

		--trim possible spaces
		events = events:gsub("%s+", "")
		for _, event in ipairs(vim.split(events, ',', { plain = true })) do
			if not M.H[id][event] then
				M.H[id][event] = {}
			end

			if type(hook) == 'function' then
				hook = { func = hook }
			end

			if hook.order == nil then
				hook.order = 100
			end

			if hook.id == nil then
				hook.id = config.getID()
			end

			table.insert(M.H[id][event], {
				id = hook.id,
				order = hook.order,
				func = hook.func,
			})
		end

		if id == '*' and not (M.version == 0) then
			M.reconcile()
		end
	end
end

M.has_no_star = function()
	return M.H['*'] == nil
end

-- this function excludes already registered extensions from the * selector
-- eg * is add last line and we have a hook for *.go registered
-- *.go will be excluded from * (no last line added).
-- filetype-based fileIDs (e.g. 'NvimTree') are handled separately via
-- M.get_star_filetype_exclude and a runtime guard in create_au_grps.
M.get_star_pattern = function()
	if M.has_no_star() then
		return '*'
	end
	local ignored = {}
	for fileID, _ in pairs(M.H) do
		if fileID ~= '*' and is_pattern_fileid(fileID) then
			local ext = fileID:match('^%*%.(.+)$')
			if ext and ext ~= '' then
				table.insert(ignored, ext)
			end
		end
	end

	if #ignored == 0 then
		return '*'
	end

	-- lifesafer: https://groups.google.com/g/vim_use/c/I_ssfzT8FD8/m/n6eSynJRMkUJ
	return '*\\(' .. table.concat(ignored, '\\|') .. '\\)' .. NEG_LOOKBEHIND
end

---Filetypes that were registered as their own fileID. The '*' autocmd must
---skip buffers whose filetype matches any of these — those buffers get their
---own dedicated hook and would otherwise double-fire.
M.get_star_filetype_exclude = function()
	local set = {}
	for fileID, _ in pairs(M.H) do
		if fileID ~= '*' and not is_pattern_fileid(fileID) then
			set[fileID] = true
		end
	end
	return set
end

M.reconcile = function()
	if M.has_no_star() then
		M.version = M.version + 1
		return
	end

	for event, hooks in pairs(M.H['*']) do
		for fileID, _ in pairs(M.H) do
			if fileID == '*' then
				goto continue
			end
			if M.H[fileID][event] == nil then
				M.H[fileID][event] = {}
				for _, hook in ipairs(hooks) do
					logger.debug(
						'[codes.abe.hook] adding hook '
						.. hook.id..
						' for event '
						.. event ..
						' from * to '
						.. fileID
						)
					table.insert(M.H[fileID][event],  hook)
				end

				goto continue
			else
				for _, hook in ipairs(hooks) do
					if eventBucketHasHook(M.H[fileID][event], hook) == false then
						logger.debug(
							'[codes.abe.hook] hook '
							.. hook.id ..
							' not registered on '
							.. fileID ..
							' for '
							..event
						)
						if config.get_append_star() then
							-- adding at the last position
							table.insert(M.H[fileID][event], hook)
						else
							table.insert(M.H[fileID][event], 1, hook)
						end
					else
						logger.debug(
							'[codes.abe.hook] '
							.. fileID ..
							' already has hook '
							.. hook.id ..
							' registered for '
							..event
						)
					end
				end
			end
			::continue::
		end
	end

	M.version = M.version + 1
end

M.create_au_grps = function()
	-- tear down previously-created augroups so create_au_grps is idempotent.
	-- every call mints fresh auIDs via config.getID(); without this, repeat
	-- invocations would leave orphaned augroups registered in nvim.
	for _, events in pairs(M.G) do
		for _, auID in pairs(events) do
			pcall(vim.api.nvim_del_augroup_by_name, 'codes.abe.hook.'..auID)
		end
	end
	M.G = {}

	for fileID, events in pairs(M.H) do
		for event, eventBucket in pairs(events) do
			local auID = config.getID()
			local run_bucket = getEventFunc(eventBucket)

			local pattern, callback
			if fileID == '*' then
				pattern = M.get_star_pattern()
				local ft_exclude = M.get_star_filetype_exclude()
				callback = function(ev)
					if ft_exclude[vim.bo[ev.buf].filetype] then return end
					run_bucket()
				end
			elseif is_pattern_fileid(fileID) then
				pattern  = fileID
				callback = function() run_bucket() end
			else
				-- filetype-based fileID: match every buffer via '*' and gate on filetype.
				pattern  = '*'
				local ft = fileID
				callback = function(ev)
					if vim.bo[ev.buf].filetype ~= ft then return end
					run_bucket()
				end
			end

			utils.autocmd.new_autocmd(event, 'codes.abe.hook.'..auID, {
				pattern  = pattern,
				callback = callback,
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
	vim.print(M.G)
end

M.print_hooks = function()
	vim.print(M.H)
end

return M
