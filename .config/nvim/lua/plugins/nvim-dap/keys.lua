-- Source of truth for nvim-dap leader keymaps. Also re-exported by
-- `plugins/nvim-dap-ui/keys.lua` so both specs share an identical
-- lazy-trigger bundle (see lua/pack/ARCHITECTURE.md → "Lazy propagation").
return {
	{ mode = 'n', lhs = '<leader>dD', rhs = '<CMD>lua require("dap").continue()<CR>',          opts = { desc = 'Start debug session' } },
	{ mode = 'n', lhs = '<leader>dT', rhs = '<CMD>lua require("dap").terminate()<CR>',         opts = { desc = 'Terminate session' } },
	{ mode = 'n', lhs = '<leader>do', rhs = '<CMD>lua require("dap").step_over()<CR>',         opts = { desc = 'Step over' } },
	{ mode = 'n', lhs = '<leader>dn', rhs = '<CMD>lua require("dap").step_into()<CR>',         opts = { desc = 'Step into' } },
	{ mode = 'n', lhs = '<leader>dp', rhs = '<CMD>lua require("dap").step_out()<CR>',          opts = { desc = 'Step out' } },
	{ mode = 'n', lhs = '<leader>db', rhs = '<CMD>lua require("dap").toggle_breakpoint()<CR>', opts = { desc = 'Set breakpoint' } },
}
