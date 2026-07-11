local M = {}

---Filetypes that identify UI/chrome buffers (pickers, git views, tree,
---dashboard, help, etc.). Callers may add their own keys at runtime.
---Note: empty filetype ('') is intentionally NOT included. A brand-new
---unnamed file buffer has ft='' and buftype=''; we want modules like
---ensureTabstop to still apply to it. Scratch UI buffers are already
---caught by the ui_buftypes check below.
M.ui_filetypes = {
	alpha           = true,
	dashboard       = true,
	gitcommit       = true,
	help            = true,
	lir             = true,
	['no-neck-pain']= true,
	NeogitConsole   = true,
	NeogitStatus    = true,
	NeogitDiffView  = true,
	NeogitPopup     = true,
	NvimTree        = true,
	Outline         = true,
	spectre_panel   = true,
	startify        = true,
	TelescopePrompt = true,
	toggleterm      = true,
	Trouble         = true,
}

---Buftype values that indicate a non-file buffer: scratch floats (nofile),
---terminals, quickfix/loclist, prompt buffers, help.
M.ui_buftypes = {
	nofile   = true,
	prompt   = true,
	terminal = true,
	quickfix = true,
	help     = true,
}

---True when the buffer is a UI/chrome buffer that feature modules
---(winbar, line numbers, tabstop, rooter, …) should leave alone.
---@param bufnr? integer defaults to 0 (current buffer)
---@return boolean
M.is_ui_buffer = function(bufnr)
	bufnr = bufnr or 0
	if not vim.api.nvim_buf_is_valid(bufnr) then return true end
	if M.ui_filetypes[vim.bo[bufnr].filetype] then return true end
	if M.ui_buftypes[vim.bo[bufnr].buftype] then return true end
	return false
end

return M
