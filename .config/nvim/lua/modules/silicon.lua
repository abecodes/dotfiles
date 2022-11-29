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
	local range = info.line1 .. ',' .. info.line2
	local dest = dir .. get_file_name() .. '.png'
	local lastErr = vim.v.errmsg

	vim.api.nvim_command(
		table.concat(
			{
				'silent',
				range,
				'w',
				'!silicon',
				'--language',
				vim.bo.filetype,
				'--theme',
				'~/.config/bat/themes/Horizon.tmTheme',
				'--background',
				'"\\#09F7A0"',
				'--shadow-offset-x ',
				10,
				'--shadow-offset-y',
				10,
				'--shadow-blur-radius',
				10,
				'--output',
				dest
			},
			' '
		)
	)

	if not (vim.v.errmsg == lastErr) then
		logger.warn('[Screenshot] '..vim.v.errmsg)
	end

	logger.log('[Screenshot] saved to '..dest)
end
