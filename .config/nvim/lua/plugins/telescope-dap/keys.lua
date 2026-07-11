return {
	{ mode = 'n', lhs = '<leader>dcc', rhs = "<cmd>lua require('telescope').extensions.dap.commands{}<CR>",         opts = { desc = 'DAP commands' } },
	{ mode = 'n', lhs = '<leader>dco', rhs = "<cmd>lua require('telescope').extensions.dap.configurations{}<CR>",   opts = { desc = 'DAP configurations' } },
	{ mode = 'n', lhs = '<leader>dlb', rhs = "<cmd>lua require('telescope').extensions.dap.list_breakpoints{}<CR>", opts = { desc = 'DAP breakpoints' } },
	{ mode = 'n', lhs = '<leader>dv',  rhs = "<cmd>lua require('telescope').extensions.dap.variables{}<CR>",        opts = { desc = 'DAP variables' } },
	{ mode = 'n', lhs = '<leader>df',  rhs = "<cmd>lua require('telescope').extensions.dap.frames{}<CR>",           opts = { desc = 'DAP frames' } },
}
