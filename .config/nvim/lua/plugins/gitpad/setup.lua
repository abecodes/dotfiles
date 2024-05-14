local map = require'utils'.map_key
local opts = { noremap = true, silent = true }

map('n', '<leader>pp', '<CMD>lua require("gitpad").toggle_gitpad()<CR>', opts)
map('n', '<leader>pb', '<CMD>lua require("gitpad").toggle_gitpad_branch()<CR>', opts)
map(
	'n',
	'<leader>pf',
	'',
	vim.tbl_extend('force', {
		callback = function()
			local filename = vim.fn.expand('%:p') -- or just use vim.fn.bufname()
			if filename == '' then
				vim.notify('empty bufname')
				return
			end
			filename = vim.fn.pathshorten(filename, 2) .. '.md'
			require('gitpad').toggle_gitpad({ filename = filename })
		end,
	}, opts)
)
