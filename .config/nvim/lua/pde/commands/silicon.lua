local utils = require('utils')
local logger = require('logger')
local dir = vim.fn.expand('~/Pictures/vimshots/')

local get_file_name = function()
	local name = vim.fn.expand('%:t')
	local sep = ''
	if not (name == '') then
		sep = '-'
	end
	local now = os.date('%Y-%m-%d-%H%M%S')

	return name .. sep .. now
end

return function(info)
	vim.fn.mkdir(dir, 'p')
	local dest = dir .. get_file_name() .. '.png'

	local lines = vim.api.nvim_buf_get_lines(0, info.line1 - 1, info.line2, false)
	local content = table.concat(lines, '\n')

	-- silicon 0.5.2 reads from stdin when no FILE positional arg is passed.
	local res = utils.proc.run_sync(
		{
			'silicon',
			'--language', vim.bo.filetype,
			'--theme', vim.fn.expand('~/.config/bat/themes/Horizon.tmTheme'),
			'--background', '#09F7A0',
			'--shadow-offset-x', '10',
			'--shadow-offset-y', '10',
			'--shadow-blur-radius', '10',
			'--output', dest,
		},
		{ stdin = content }
	)

	if res.code ~= 0 then
		logger.warn('[Screenshot] ' .. utils.proc.format_err('silicon', res.code, res.stderr))
		return
	end

	logger.info('[Screenshot] saved to ' .. dest)
end
