-- Disable virtual_text since it's redundant due to lsp_lines.
vim.diagnostic.config({
	virtual_text = false,
	-- only show diag when cursor is on line
	-- virtual_lines = { only_current_line = true },
})
