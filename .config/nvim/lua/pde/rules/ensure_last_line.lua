-- Trim trailing blank lines on save. Combined with Neovim's `fixeol`
-- option (default on, explicit in settings.lua), this gives exactly one
-- trailing newline at EOF. The previous version of this module appended
-- an extra empty line after trimming, which produced a trailing blank
-- line on disk instead of a single trailing newline.

return function()
	local bufnr = 0
	if vim.api.nvim_buf_line_count(bufnr) == 0 then return end
	require('utils.buf').trim_trailing_blanks(bufnr)
end
