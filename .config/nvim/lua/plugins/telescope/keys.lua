-- Source of truth for telescope leader keymaps. Read by:
--   - plugins/telescope/setup.lua → register real keymaps post-load
--   - pack/loader.lua             → install on_key stubs (with desc) pre-load
return {
	{ mode = 'n',          lhs = '<leader>td', rhs = "<CMD>lua require('telescope.builtin').diagnostics({ previewer = false })<CR>",     opts = { desc = 'Diagnostics' } },
	{ mode = 'n',          lhs = '<leader>te', rhs = "<CMD>lua require('telescope').extensions.file_browser.file_browser()<CR>",          opts = { desc = 'File explorer' } },
	{ mode = 'n',          lhs = '<leader>tE', rhs = "<CMD>lua require('telescope.builtin').symbols()<CR>",                              opts = { desc = 'Find in emojis' } },
	{ mode = 'n',          lhs = '<leader>tf', rhs = "<CMD>lua require('telescope.builtin').find_files()<CR>",                           opts = { desc = 'File in pwd' } },
	{ mode = 'n',          lhs = '<leader>tF', rhs = "<CMD>lua require('telescope.builtin').live_grep()<CR>",                            opts = { desc = 'Find in files in pwd' } },
	{ mode = 'n',          lhs = '<leader>tb', rhs = "<CMD>lua require('frecency.buffer').pick()<CR>",                                   opts = { desc = 'Frecency buffers' } },
	{ mode = 'n',          lhs = '<leader>tB', rhs = "<CMD>lua require('telescope.builtin').current_buffer_fuzzy_find()<CR>",            opts = { desc = 'Find in buffers' } },
	{ mode = 'n',          lhs = '<leader>tg', rhs = "<CMD>lua require('telescope.builtin').git_files()<CR>",                            opts = { desc = 'Find file in git project' } },
	{ mode = 'n',          lhs = '<leader>th', rhs = "<CMD>lua require('telescope.builtin').help_tags()<CR>",                            opts = { desc = 'Find in help tags' } },
	{ mode = 'n',          lhs = '<leader>tt', rhs = "<CMD>lua require('telescope.builtin').treesitter()<CR>",                           opts = { desc = 'Find in treesitter' } },
	{ mode = 'n',          lhs = '<leader>tq', rhs = "<CMD>lua require('telescope.builtin').quickfix()<CR>",                             opts = { desc = 'Find in quickfix list' } },
	{ mode = 'n',          lhs = '<leader>ts', rhs = "<CMD>lua require('telescope.builtin').lsp_document_symbols()<CR>",                 opts = { desc = 'Find in lsp document symbols' } },
	{ mode = 'n',          lhs = '<leader>tS', rhs = "<CMD>lua require('telescope.builtin').lsp_dynamic_workspace_symbols()<CR>",        opts = { desc = 'Find in lsp workspace symbols' } },
	{ mode = 'n',          lhs = '<leader>tR', rhs = "<CMD>lua require('telescope.builtin').lsp_references()<CR>",                       opts = { desc = 'Find lsp references' } },
	{ mode = 'n',          lhs = '<leader>tI', rhs = "<CMD>lua require('telescope.builtin').lsp_implementations()<CR>",                  opts = { desc = 'Find lsp implementations' } },
	{ mode = 'n',          lhs = '<leader>tw', rhs = "<CMD>lua require('telescope.builtin').spell_suggest(vim.api.nvim_win_get_cursor(0))<CR>", opts = { desc = 'Find in spelling suggestions for word' } },
	{ mode = 'n',          lhs = '<leader>t<Space>', rhs = '<CMD>Telescope<CR>',                                                              opts = { desc = 'Telescope' } },
	-- `<leader>tr` lives in plugins/refactoring/keys.lua so first press loads
	-- refactoring.nvim (its setup registers the telescope extension), keeping
	-- refactoring lazy of telescope's trigger bundle.
}
