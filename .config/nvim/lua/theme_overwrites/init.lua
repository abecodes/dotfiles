local shared = require('theme_overwrites._shared')

-- Per-colorscheme overwrite modules live at theme_overwrites/<colorscheme_name>.lua
-- and each returns a function(ev). The dispatcher lazy-requires them on first
-- use; a missing file is cached as `false` so a mistyped colorscheme name does
-- not error on every ColorScheme event.
local resolve_cache = require('cache').new()

local function resolve(name)
	return resolve_cache.get(name, function()
		local ok, mod = pcall(require, 'theme_overwrites.' .. name)
		return ok and mod or false
	end)
end

local function apply(ev)
	shared(ev)
	local name = vim.g.colors_name
	local fn = name and resolve(name)
	if fn then fn(ev) end
end

vim.api.nvim_create_autocmd({ 'VimEnter', 'ColorScheme' }, { callback = apply })
