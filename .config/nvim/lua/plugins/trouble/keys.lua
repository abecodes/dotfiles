return {
	{ mode = 'n', lhs = '<leader>x',  rhs = '<cmd>Trouble diagnostics toggle<cr>',                opts = { desc = 'Toggle' } },
	{ mode = 'n', lhs = '<leader>xw', rhs = '<cmd>Trouble diagnostics toggle<cr>',                opts = { desc = 'Workspace diagnostics' } },
	{ mode = 'n', lhs = '<leader>xd', rhs = '<cmd>Trouble diagnostics toggle filter.buf=0<cr>',   opts = { desc = 'Document diagnostics' } },
	{ mode = 'n', lhs = '<leader>xl', rhs = '<cmd>Trouble loclist toggle<cr>',                    opts = { desc = 'Toggle loclist' } },
	{ mode = 'n', lhs = '<leader>xq', rhs = '<cmd>Trouble qflist toggle<cr>',                     opts = { desc = 'Toggle quickfix' } },
	{ mode = 'n', lhs = '<leader>xr', rhs = '<cmd>Trouble lsp_references toggle<cr>',             opts = { desc = 'LSP references' } },
}
