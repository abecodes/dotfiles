local theme = require('theme')

vim.api.nvim_create_autocmd({"VimEnter", "ColorScheme"}, {
  -- pattern = {"*"},
  callback = function(ev)
		-- golang
		for _, s in pairs({
			'@lsp.type.parameter.go',
			'@lsp.type.keyword.go',
		}) do
			vim.api.nvim_set_hl(0, s, {})
		end

		theme.update_highlight(
			'@lsp.type.string.go',
			{ link = 'SpellCap' }
		)

		theme.update_highlight(
			'@lsp.type.parameter.go',
			theme.style.italic
		)

		theme.update_highlight(
			'@lsp.type.type.go',
			theme.style.bold
		)

		theme.update_highlight(
			'goStatement',
			{ link = 'goDeclaration' }
		)

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
