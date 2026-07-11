local M = {}

---get the name of the current file
---@return string
M.get_filename = function()
	return vim.fn.expand("%:t")
end

---get the path to the current file
---@return string
M.get_filepath = function()
	return vim.api.nvim_buf_get_name(0)
end

---get the extension of the current file
---@return string
M.get_fileext = function()
	return vim.fn.expand("%:e")
end

---get the dir of the current file
---@return string
M.get_filedir = function()
	return vim.fn.expand("%:p:h")
end

---check if cursor is at a certain 0-indexed position
---@param line number
---@param col number
---@return boolean
M.is_cursor_at_position = function(line, col)
	local cursor = vim.api.nvim_win_get_cursor(0)

	return line == cursor[1] - 1 and col == cursor[2]
end

---return true when the buffer has no content (0 lines or 1 empty line).
---matches BufWritePre guards in the formatters.
---@param bufnr? integer defaults to 0 (current buffer)
---@return boolean
M.is_effectively_empty = function(bufnr)
	local content = vim.api.nvim_buf_get_lines(bufnr or 0, 0, -1, false)
	return #content == 0 or (#content == 1 and content[1] == '')
end

---remove all blank lines at the end of the buffer.
---@param bufnr? number defaults to 0 (current buffer)
M.trim_trailing_blanks = function(bufnr)
	bufnr = bufnr or 0
	local maxLines = vim.api.nvim_buf_line_count(bufnr)
	if maxLines == 0 then return end
	local nonBlank = vim.fn.prevnonblank(maxLines)
	-- prevnonblank returns 0 when every line is blank. Wiping [0, -1) in
	-- that case empties the buffer — which, as a pre-save hook, would nuke
	-- the file's contents. Leave the buffer untouched instead.
	if nonBlank == 0 then return end
	vim.api.nvim_buf_set_lines(bufnr, nonBlank, -1, false, {})
end

return M
