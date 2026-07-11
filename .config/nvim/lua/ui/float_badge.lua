-- Small rounded-border status badge anchored to the top-right of the editor.
-- Used for transient "doing X…" indicators (format, lint). open() returns a
-- handle; pass it back to close() when the job exits or is cancelled.

local float = require('ui.float')

local M = {}

---@param msg string  displayed verbatim inside the badge; also drives width
---@return { buf: integer, win: integer }
function M.open(msg)
	local buf = float.scratch_buf()
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, { msg })
	local width = #msg
	local win = vim.api.nvim_open_win(buf, false, {
		relative  = 'editor',
		anchor    = 'NE',
		row       = 0,
		col       = vim.o.columns,
		width     = width,
		height    = 1,
		style     = 'minimal',
		border    = float.border(),
		focusable = false,
		noautocmd = true,
	})
	return { buf = buf, win = win }
end

---@param handle? { buf: integer, win: integer }
function M.close(handle)
	if not handle then return end
	if handle.win and vim.api.nvim_win_is_valid(handle.win) then
		pcall(vim.api.nvim_win_close, handle.win, true)
	end
	if handle.buf and vim.api.nvim_buf_is_valid(handle.buf) then
		pcall(vim.api.nvim_buf_delete, handle.buf, { force = true })
	end
end

return M
