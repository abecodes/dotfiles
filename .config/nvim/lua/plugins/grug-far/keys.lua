-- Non-leader keys. No desc since the bridge only surfaces leader
-- entries, but keeping them here makes plugins.lua `on_key = true`
-- the single opt-in and kills drift with setup.lua.
return {
	{ mode = 'n', lhs = 'fw', rhs = '<CMD>lua require("grug-far").grug_far({ prefills = { search = vim.fn.expand("<cword>") } })<CR>',       opts = { desc = 'grug-far: search word under cursor' } },
	{ mode = 'n', lhs = 'ff', rhs = '<CMD>lua require("grug-far").grug_far({ prefills = { flags = vim.fn.expand("%") } })<CR>',               opts = { desc = 'grug-far: in current file' } },
	{ mode = 'x', lhs = 'fv', rhs = '<CMD>lua require("grug-far").with_visual_selection({ prefills = { flags = vim.fn.expand("%") } })<CR>', opts = { desc = 'grug-far: visual selection in current file' } },
}
