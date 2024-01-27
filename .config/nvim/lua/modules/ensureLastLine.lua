return function()
	local maxLines = vim.api.nvim_buf_line_count(0)
	local nonBlank = vim.fn.prevnonblank(maxLines)

	if maxLines == 0 or
		maxLines == nonBlank then
		return
	end

	vim.api.nvim_buf_set_lines(
		0,
		nonBlank,
		maxLines,
		true,
		{''}
	)
end
