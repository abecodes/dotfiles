local utils = require('utils')

return function()
	local view = vim.fn.winsaveview()
	-- breaking lines
	vim.api.nvim_command(
		"silent! exe 'undojoin | keepjumps :%! golines -m 80 -t 2 --no-chain-split-dots --base-formatter gofumpt 2>/dev/null < <(cat /dev/stdin) || cat /dev/stdin'"
	)
	-- organizing imports
	vim.api.nvim_command(
		"silent! exe 'undojoin | keepjumps :%! gci print -s standard -s default -s blank -s dot 2>/dev/null < <(cat /dev/stdin) || cat /dev/stdin'"
	)
	vim.fn.winrestview(view)
end
