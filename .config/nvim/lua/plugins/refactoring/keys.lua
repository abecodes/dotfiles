-- Source of truth for refactoring.nvim leader keymaps. Visual-mode
-- entries for Extract operations (need a selection), normal-mode for
-- Extract Block (reads current line) and Inline Variable (reads ident
-- under cursor).
return {
	{ mode = 'v', lhs = '<Leader>re', rhs = [[ <Esc><Cmd>lua require('refactoring').refactor('Extract Function')<CR>]],         opts = { desc = 'Extract function' } },
	{ mode = 'v', lhs = '<Leader>rf', rhs = [[ <Esc><Cmd>lua require('refactoring').refactor('Extract Function To File')<CR>]], opts = { desc = 'Extract function to file' } },
	{ mode = 'v', lhs = '<Leader>rv', rhs = [[ <Esc><Cmd>lua require('refactoring').refactor('Extract Variable')<CR>]],         opts = { desc = 'Extract variable' } },
	{ mode = 'v', lhs = '<Leader>ri', rhs = [[ <Esc><Cmd>lua require('refactoring').refactor('Inline Variable')<CR>]],          opts = { desc = 'Inline variable' } },

	{ mode = 'n', lhs = '<leader>rb', rhs = [[ <Cmd>lua require('refactoring').refactor('Extract Block')<CR>]],         opts = { desc = 'Extract block' } },
	{ mode = 'n', lhs = '<leader>rB', rhs = [[ <Cmd>lua require('refactoring').refactor('Extract Block To File')<CR>]], opts = { desc = 'Extract block to file' } },
	{ mode = 'n', lhs = '<leader>ri', rhs = [[ <Cmd>lua require('refactoring').refactor('Inline Variable')<CR>]],       opts = { desc = 'Inline variable' } },

	-- Telescope picker for refactor actions. Lives here (not in
	-- telescope/keys.lua) so first press triggers refactoring's on_key
	-- load, which pulls telescope in via `wants` and registers the
	-- extension from refactoring/setup.lua before this rhs runs.
	{ mode = { 'n', 'v' }, lhs = '<leader>tr', rhs = "<Esc><cmd>lua require('telescope').extensions.refactoring.refactors()<CR>", opts = { desc = 'Find in refactor actions' } },
}
