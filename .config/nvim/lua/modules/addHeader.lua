local utils = require('utils')

return function(header)
	local header = utils.split(header, '\n')
	local length = 0
	for _ in pairs(header) do
		length = length + 1
	end
	table.insert(header, '')

	return function()
		local currHeader = vim.api.nvim_buf_get_lines(
			vim.api.nvim_get_current_buf(),
			0,
			length,
			false
		)

		local noMatch = false

		for i,line in pairs(currHeader) do
			if not (line == header[i]) then
				noMatch = true
				break
			end
		end

		if noMatch then
			vim.api.nvim_buf_set_lines(
				vim.api.nvim_get_current_buf(),
				0,
				0,
				false,
				header
			)
		end
	end
end
