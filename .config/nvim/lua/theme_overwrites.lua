
vim.api.nvim_create_autocmd({"ColorScheme"}, {
  pattern = {"*"},
  callback = function(ev)
		-- rainbow-delimeters
		vim.api.nvim_set_hl(0, 'RainbowDelimiterRed', { link = 'Macro' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterYellow', { link = 'Define' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterBlue', { link = 'Tag' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterOrange', { link = 'PreProc' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterGreen', { link = 'Question' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterViolet', { link = 'String' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterCyan', { link = 'Special' })
	end
})
