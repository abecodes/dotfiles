local theme = require('theme')
local hl    = require('utils.hl')

return function(ev)
	-- golang
	for _, s in pairs({
		'@lsp.type.parameter.go',
		'@lsp.type.keyword.go',
		'@lsp.type.string.go'
	}) do
		vim.api.nvim_set_hl(0, s, {})
	end

	theme.update_highlight(
		'goString',
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
	hl.link_all({
		RainbowDelimiterRed    = 'Macro',
		RainbowDelimiterYellow = 'Define',
		RainbowDelimiterBlue   = 'Tag',
		RainbowDelimiterOrange = 'PreProc',
		RainbowDelimiterGreen  = 'Question',
		RainbowDelimiterViolet = 'String',
		RainbowDelimiterCyan   = 'Special',
	})

	-- neogit diff highlights — neogit reads these via highlight links at
	-- runtime, so they must be re-applied on every ColorScheme event.
	hl.link_all({
		NeogitDiffDeletions        = 'StatusLineNC',
		NeogitDiffDelete           = 'StatusLineNC',
		NeogitDiffDeleteHighlight  = 'StatusLineNC',
		NeogitDiffDeleteCursor     = 'StatusLineNC',
	})
end
