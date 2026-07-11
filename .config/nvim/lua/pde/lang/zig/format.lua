local utils = require('utils')
local logger = require('logger')

return function()
	if utils.buf.is_effectively_empty(0) then
		return
	end

	local content = vim.api.nvim_buf_get_lines(0, 0, -1, false)
	local view = vim.fn.winsaveview()

	local res = utils.proc.run_sync({ 'zig', 'fmt', '--stdin' }, { stdin = content })
	if res.code ~= 0 then
		logger.warn(utils.proc.format_err('zig fmt', res.code, res.stderr))
		vim.fn.winrestview(view)
		return
	end

	local out = res.stdout
	if out:sub(-1) == '\n' then out = out:sub(1, -2) end
	vim.api.nvim_buf_set_lines(0, 0, -1, false, vim.split(out, '\n'))
	vim.fn.winrestview(view)
end
