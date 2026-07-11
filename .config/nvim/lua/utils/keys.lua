local M = {}

---map a key in mode. rhs may be a string (Vim keys / Ex command) or a Lua function.
---mode may be a single-mode string or a list of modes (vim.keymap.set accepts both).
---@param mode string|string[]
---@param lhs string
---@param rhs string|function
---@param opts? table vim.keymap.set opts (silent, expr, noremap, desc, buffer, ...)
M.map_key = function(mode, lhs, rhs, opts)
	local options = { noremap = true }
	if opts then options = vim.tbl_extend('force', options, opts) end
	vim.keymap.set(mode, lhs, rhs, options)
end

---register the same lhs across multiple modes, with a per-mode rhs.
---use when the rhs differs by mode (e.g. window nav needing <Esc> prefixes
---in i/v/x and <C-\><C-n> in terminal). for identical-rhs-across-modes
---cases, pass a list of modes directly to `map_key`.
---@param lhs string
---@param rhs_by_mode table<string, string|function>  e.g. { n = ..., i = ..., t = ... }
---@param opts? table  shared opts applied to each entry
M.map_per_mode = function(lhs, rhs_by_mode, opts)
	for mode, rhs in pairs(rhs_by_mode) do
		M.map_key(mode, lhs, rhs, opts)
	end
end

---map_key with `silent = true` merged into opts.
---@param mode string|string[]
---@param lhs string
---@param rhs string|function
---@param opts? table
M.silent_map = function(mode, lhs, rhs, opts)
	opts = vim.tbl_extend('force', { silent = true }, opts or {})
	M.map_key(mode, lhs, rhs, opts)
end

---register a batch of keymaps. each entry: { mode, lhs, rhs, opts? }.
---mode may be a string or a list (one entry binds n+v+x in a single line).
---`defaults.opts` is merged UNDER each entry's own opts (entry wins on conflict).
---@param entries { mode: string|string[], lhs: string, rhs: string|function, opts?: table }[]
---@param defaults? { opts?: table }
M.register = function(entries, defaults)
	local default_opts = defaults and defaults.opts or nil
	for _, e in ipairs(entries) do
		local merged = default_opts
		if e.opts then
			merged = default_opts and vim.tbl_extend('force', default_opts, e.opts) or e.opts
		end
		M.map_key(e.mode, e.lhs, e.rhs, merged)
	end
end

---unmap a key in mode
---@param mode string | "'n'" | "'v'" | "'x'" | "'s'" | "'o'" | "'!'" | "'i'" | "'l'" | "'c'" | "'t'" | "''"
---@param lhs string
M.unmap_key = function(mode, lhs) vim.keymap.del(mode, lhs) end

---translate termcodes in a string (e.g. '<Esc>' -> '\27')
---@param str string
M.replace_key = function(str)
	return vim.api.nvim_replace_termcodes(str, true, true, true)
end

---get the global rhs for a lhs; returns '' when absent or when rhs is a Lua callback
---@param lhs string
---@param mode string | "'n'" | "'v'" | "'x'" | "'s'" | "'o'" | "'!'" | "'i'" | "'l'" | "'c'" | "'t'" | "''"
---@return string
M.get_rhs = function(lhs, mode)
	local rhs = ''

	for _, mapping in ipairs(vim.api.nvim_get_keymap(mode)) do
		if mapping.lhs == lhs then
			if mapping.rhs ~= nil and mapping.rhs ~= '' then rhs = mapping.rhs end
			break
		end
	end

	return rhs
end

return M
