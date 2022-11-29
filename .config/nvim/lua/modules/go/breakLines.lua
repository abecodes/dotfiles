local utils = require('utils')

return function()
	local view = vim.fn.winsaveview()
	utils.get_buf_func('golines -m 80 -t 2 --base-formatter gofumpt')()
	vim.fn.winrestview(view)
end
