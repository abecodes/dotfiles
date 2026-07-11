local utils = require('utils')

utils.cmd.new_cmd(
	'Screenshot',
	require('pde.commands.silicon'),
	{ range = '%' }
)

utils.cmd.new_cmd(
	'ToggleSpell',
	function() vim.api.nvim_command(':setlocal spell!') end,
	{}
)

utils.cmd.new_cmd(
	'DiffOrig',
	function()
		local file = vim.fn.expand('%:p')
		if file == '' then
			vim.notify('DiffOrig: buffer has no file on disk', vim.log.levels.WARN)
			return
		end
		local ft = vim.bo.filetype
		vim.cmd('vertical new')
		vim.bo.buftype   = 'nofile'
		vim.bo.bufhidden = 'wipe'
		vim.bo.swapfile  = false
		vim.cmd('silent read ' .. vim.fn.fnameescape(file))
		vim.cmd('0d_')
		vim.bo.filetype = ft
		vim.bo.modifiable = false
		vim.cmd('diffthis')
		vim.cmd('wincmd p')
		vim.cmd('diffthis')
	end,
	{}
)
