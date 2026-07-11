local autocmd = require('utils.autocmd')

local M = {}

---set `link` on a batch of highlight groups. `map` is a plain
---{ SourceGroup = 'TargetGroup', ... } table.
---@param map table<string, string>
M.link_all = function(map)
	for src, target in pairs(map) do
		vim.api.nvim_set_hl(0, src, { link = target })
	end
end

---Run `fn` once now, then re-run it on every `ColorScheme` event. Use for
---plugin highlight registration — `:colorscheme` fires `hi clear`, which
---drops user-set `nvim_set_hl` links.
---@param fn fun()
---@param name string unique augroup name (e.g. 'codes.abe.plugins.leap.highlights')
M.apply_on_colorscheme = function(fn, name)
	fn()
	autocmd.new_autocmd('ColorScheme', name, { callback = fn })
end

---Wrap `str` in a highlight group and reset afterwards (`%#HL#str%*`).
---Use when the content is a self-contained, closed styling unit.
---@param hl string
---@param str string
---@return string
M.wrap_hl = function(hl, str)
	return '%#' .. hl .. '#' .. str .. '%*'
end

---Switch highlight group without resetting (`%#HL#`). The bg carries forward
---until the next switch. Use inside a section that controls a contiguous
---background region (e.g. the statusbar's B section).
---@param hl string
---@return string
M.hl = function(hl)
	return '%#' .. hl .. '#'
end

---Truncate `str` to `limit` chars, replacing the leading chars with '..'.
---Counts characters, not bytes, so nerd-font icons and other multi-byte
---glyphs don't get truncated mid-codepoint into invalid UTF-8.
---@param str string
---@param limit integer
---@return string
M.limit_str = function(str, limit)
	local n = vim.fn.strchars(str)
	if n > limit then
		str = '..' .. vim.fn.strcharpart(str, n - (limit - 2))
	end
	return str
end

return M
