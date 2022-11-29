return function()
	local maxLines = vim.api.nvim_buf_line_count(0)

	if not (vim.fn.getline(maxLines) == '') then
		vim.fn.append(vim.fn.line('$'), '')
	else
		while vim.fn.getline(maxLines) == '' and vim.fn.getline(maxLines - 1) == '' do
			vim.api.nvim_buf_set_lines(
				0,
				-2,
				-1,
				false,
				{}
			)

			maxLines = vim.api.nvim_buf_line_count(0)
		end
	end
end
