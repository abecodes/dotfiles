return function()
	local maxLines = vim.api.nvim_buf_line_count(0)
	local nonBlank = vim.fn.prevnonblank(maxLines)

	while nonBlank < maxLines do
		vim.api.nvim_buf_set_lines(
			0,
			nonBlank,
			maxLines,
			true,
			{''}
		)

		maxLines = vim.api.nvim_buf_line_count(0)
		nonBlank = vim.fn.prevnonblank(maxLines)
	end
end
