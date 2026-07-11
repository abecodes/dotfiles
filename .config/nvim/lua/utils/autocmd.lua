local M = {}

---create (or clear) a named augroup and return its id. thin wrapper used by
---multi-autocmd sites that want a shared group_id to pass to several
---new_autocmd / nvim_create_autocmd calls. defaults clear=true.
---@param group string
---@param clear? boolean
---@return integer
M.new_augroup = function(group, clear)
	if clear == nil then clear = true end
	return vim.api.nvim_create_augroup(group, { clear = clear })
end

---create a new autocmd inside an augroup.
---when `group` is a string, the augroup is created (and cleared) on every
---call — use this when the callsite owns exactly one autocmd for that name.
---when `group` is an integer (obtained from `new_augroup`), the autocmd is
---attached without clearing — use this to attach several autocmds to the
---same group without each call wiping the previous one.
---@param event string|string[]
---@param group string|integer
---@param opts vim.api.keyset.create_autocmd
M.new_autocmd = function(event, group, opts)
	opts = opts or {}

	if type(group) == 'string' then
		opts.group = M.new_augroup(group)
	else
		opts.group = group
	end

	vim.api.nvim_create_autocmd(event, opts)
end

return M
