
-- per colorscheme option
---- base2tone_evening_dark
vim.api.nvim_create_autocmd({"ColorScheme"}, {
  -- pattern = {"base2tone_evening_dark"},
  pattern = {"base2tone_evening_dark"},
  callback = function(ev)
    -- print(string.format('event fired: %s', vim.inspect(ev)))
		vim.api.nvim_exec([[
			hi link RainbowDelimiterRed Macro
			hi link RainbowDelimiterYellow Define
			hi link RainbowDelimiterBlue Tag
			hi link RainbowDelimiterOrange PreProc
			hi link RainbowDelimiterGreen Question
			hi link RainbowDelimiterViolet String
			hi link RainbowDelimiterCyan Special
		]], true)
		vim.api.nvim_set_hl(0, 'markdownUrl', {
			cterm = {
				underline = true
			},
			underline = true,
			sp = '#e09142',
			fg= '#e09142'
		})
		-- overwrite for lsp/diagnostics
		-- DiagnosticUnderlineError xxx cterm=undercurl gui=undercurl guisp=#ffad5c
		-- DiagnosticUnderlineWarn xxx cterm=undercurl gui=undercurl guisp=#d8d1ca
		-- DiagnosticUnderlineInfo xxx cterm=undercurl gui=undercurl guisp=#d8d1ca
		-- DiagnosticUnderlineHint xxx cterm=undercurl gui=undercurl guisp=#bab8c7
		vim.api.nvim_set_hl(0, 'DiagnosticUnderlineError', {
			cterm = {
				undercurl = true
			},
			undercurl = true,
			sp = '#f70067'
		})
		vim.api.nvim_set_hl(0, 'DiagnosticUnderlineWarn', {
			cterm = {
				undercurl = true
			},
			undercurl = true,
			sp = '#ffb870'
		})
		vim.api.nvim_set_hl(0, 'DiagnosticUnderlineInfo', {
			cterm = {
				undercurl = true
			},
			undercurl = true,
			sp = '#c4b9fe'
		})
		vim.api.nvim_set_hl(0, 'DiagnosticUnderlineHint', {
			cterm = {
				undercurl = true
			},
			undercurl = true,
			sp = '#c4b9fe'
		})
		-- overwrite for spell
		-- SpellCap       xxx guifg=#ffa142 guibg=#2a2734
		-- SpellRare      xxx guifg=#9a86fd guibg=#2a2734
		-- SpellLocal     xxx guifg=#e09142 guibg=#2a2734
		vim.api.nvim_set_hl(0, 'SpellCap', { link = 'SpellBad' })
		vim.api.nvim_set_hl(0, 'SpellRare', { link = 'SpellBad' })
		vim.api.nvim_set_hl(0, 'SpellLocal', { link = 'SpellBad' })
  end
})
