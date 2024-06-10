local utils = require('utils')
local theme = require('theme')

local update = function(ev)
-- overwrite for lsp/diagnostics
		vim.api.nvim_set_hl(0, 'RainbowDelimiterRed', { link = 'Macro' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterYellow', { link = 'Define' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterBlue', { link = 'Tag' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterOrange', { link = 'PreProc' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterGreen', { link = 'Question' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterViolet', { link = 'String' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterCyan', { link = 'Special' })
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
			fg = '#6C6F93',
			ctermfg = 102
			-- link = 'PreProc'
		})

		for _, k in pairs({
			'error',
			'warn',
			'info',
			'hint',
		}) do
			local key = utils.str_capitalize(k)
			vim.api.nvim_set_hl(0, 'DiagnosticVirtualText'..key, { link = 'Diagnostic'..key })
			vim.api.nvim_set_hl(0, 'DiagnosticUnderline'..key, {
				cterm = {
					undercurl = true
				},
				undercurl = true,
				link = 'Diagnostic'..key
			})

			for _, s in pairs({
				'lualine_b_diagnostics_'..k..'_normal',
				'lualine_b_diagnostics_'..k..'_insert',
				'lualine_b_diagnostics_'..k..'_visual',
				'lualine_b_diagnostics_'..k..'_replace',
				'lualine_b_diagnostics_'..k..'_command',
				'lualine_b_diagnostics_'..k..'_terminal',
				'lualine_b_diagnostics_'..k..'_inactive',
			}) do
				vim.api.nvim_set_hl(0, s, { link = 'Diagnostic'..key })
			end
		end

		vim.api.nvim_set_hl(
			0,
			'PmenuSel',
			{
				link = 'Todo',
			}
		)
end

vim.api.nvim_create_autocmd({"VimEnter"}, {
  once = true,
  callback = update
})

vim.api.nvim_create_autocmd({"ColorScheme"}, {
  pattern = {"base2tone_lavender_dark"},
  callback = update
})
