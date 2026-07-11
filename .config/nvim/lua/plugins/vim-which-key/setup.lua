-- vim-which-key trigger. `g:which_key_map` / `g:which_key_map_visual`
-- are rebuilt from `desc` fields on every `<leader>` press by
-- `plugins.vim-which-key.whichkey` — no hand-maintained label tables.

local whichkey = require('plugins.vim-which-key.whichkey')

require('utils.keys').register({
	{ mode = 'n', lhs = '<leader>', rhs = function()
		whichkey.rebuild()
		vim.cmd("WhichKey '<,>'")
	end, opts = { desc = 'which-key' } },
	{ mode = 'v', lhs = '<leader>', rhs = function()
		whichkey.rebuild()
		vim.cmd("WhichKeyVisual '<,>'")
	end, opts = { desc = 'which-key' } },
}, { opts = { silent = true } })

local g = vim.g

g.which_key_sep = '→'
-- `which_key_use_floating_win = 1` opens which-key in a float that
-- auto-sizes to fit all entries; the legacy non-floating "message-area"
-- mode is not used here, so `cmdheight` does not bound the UI.
g.which_key_use_floating_win = 1

vim.cmd 'set timeoutlen=400'

-- Wired to ColorScheme so the links survive `:colorscheme` swaps
-- (which execute `hi clear` and drop user-set highlights).
local function apply_whichkey_hl()
	require('utils.hl').link_all({
		WhichKey          = 'Operator',
		WhichKeySeperator = 'DiffAdded',
		WhichKeyGroup     = 'Identifier',
		WhichKeyDesc      = 'Function',
	})
end

require('utils.hl').apply_on_colorscheme(apply_whichkey_hl, 'codes.abe.plugins.whichkey.highlights')

-- Seed `g:which_key_map` once so the first invocation has a dict to
-- read even before our `<leader>` wrapper fires.
whichkey.rebuild()

vim.cmd ':call which_key#register("<,>", "g:which_key_map", "n")'
vim.cmd ':call which_key#register("<,>", "g:which_key_map_visual", "v")'
