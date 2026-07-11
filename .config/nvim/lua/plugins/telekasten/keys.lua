-- Source of truth for telekasten leader keymaps.
return {
	{ mode = 'n', lhs = '<leader>z',  rhs = "<cmd>lua require('telekasten').panel()<CR>",                     opts = { desc = 'Telekasten panel' } },
	{ mode = 'n', lhs = '<leader>zf', rhs = "<cmd>lua require('telekasten').find_notes()<CR>",                opts = { desc = 'find notes' } },
	{ mode = 'n', lhs = '<leader>zF', rhs = "<cmd>lua require('telekasten').search_notes()<CR>",              opts = { desc = 'find text in notes' } },
	{ mode = 'n', lhs = '<leader>zl', rhs = "<cmd>lua require('telekasten').follow_link()<CR>",               opts = { desc = 'follow link' } },
	{ mode = 'n', lhs = '<leader>zL', rhs = "<cmd>lua require('telekasten').find_friends()<CR>",              opts = { desc = 'show notes also using this link' } },
	{ mode = 'n', lhs = '<leader>zn', rhs = "<cmd>lua require('telekasten').new_note()<CR>",                  opts = { desc = 'new note' } },
	{ mode = 'n', lhs = '<leader>zN', rhs = "<cmd>lua require('telekasten').new_templated_note()<CR>",        opts = { desc = 'new templated notes' } },
	{ mode = 'n', lhs = '<leader>zy', rhs = "<cmd>lua require('telekasten').yank_notelink()<CR>",             opts = { desc = 'yank note link' } },
	{ mode = 'n', lhs = '<leader>zt', rhs = "<cmd>lua require('telekasten').show_tags()<CR>",                 opts = { desc = 'show tags' } },
	{ mode = 'n', lhs = '<leader>zb', rhs = "<cmd>lua require('telekasten').show_backlinks()<CR>",            opts = { desc = 'show backlinks' } },
	{ mode = 'n', lhs = '<leader>zr', rhs = "<cmd>lua require('telekasten').rename_note()<CR>",               opts = { desc = 'rename note' } },
	{ mode = 'n', lhs = '<leader>zi', rhs = "<cmd>lua require('telekasten').paste_img_and_link()<CR>",        opts = { desc = 'paste image and link' } },
	{ mode = 'n', lhs = '<leader>zI', rhs = "<cmd>lua require('telekasten').insert_img_link({ i=true })<CR>", opts = { desc = 'insert image link' } },
	{ mode = 'i', lhs = '<leader>[',  rhs = "<cmd>lua require('telekasten').insert_link({ i=true })<CR>",     opts = { desc = 'Telekasten: insert link' } },
	{ mode = 'i', lhs = '<leader>#',  rhs = "<cmd>lua require('telekasten').show_tags({ i=true })<CR>",       opts = { desc = 'Telekasten: tags' } },
}
