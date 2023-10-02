local utils = require('utils')

utils.new_cmd(
	'Screenshot',
	require('modules.silicon'),
	{ range = '%' }
)

utils.new_cmd(
	'ToggleSpell',
	function() vim.api.nvim_command(':setlocal spell!') end,
	{}
)
