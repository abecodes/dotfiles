local utils = require('utils')

return function()
	local view = vim.fn.winsaveview()
	utils.get_buf_func('gci print -s standard -s default -s blank -s dot')()
	vim.fn.winrestview(view)
end
