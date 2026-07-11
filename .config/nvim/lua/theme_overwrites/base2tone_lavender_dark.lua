local utils = require('utils')
local palette = require('theme.palette').semantic

return function(ev)
	-- overwrite for lsp/diagnostics
	vim.api.nvim_set_hl(0, 'DiagnosticError', {
		fg = '#E9436F',
		ctermfg = 90
		-- link = 'SpellLocal'
	})
	vim.api.nvim_set_hl(0, 'DiagnosticWarn', {
		fg = '#FAB28E',
		ctermfg = 184
		-- link = 'Tag'
	})
	vim.api.nvim_set_hl(0, 'DiagnosticInfo', {
		fg = '#21BFC2',
		ctermfg = 111
		-- link = 'Define'
	})
	vim.api.nvim_set_hl(0, 'DiagnosticHint', {
		fg = palette.diag_hint_muted,
		ctermfg = 102
		-- link = 'PreProc'
	})

	for _, k in pairs({
		'error',
		'warn',
		'info',
		'hint',
	}) do
		local key = utils.str.str_capitalize(k)
		vim.api.nvim_set_hl(0, 'DiagnosticVirtualText'..key, { link = 'Diagnostic'..key })
		vim.api.nvim_set_hl(0, 'DiagnosticUnderline'..key, {
			cterm = {
				undercurl = true
			},
			undercurl = true,
			link = 'Diagnostic'..key
		})
	end

	vim.api.nvim_set_hl(
		0,
		'PmenuSel',
		{
			link = 'Todo',
		}
	)
end
