local cmd = vim.cmd

cmd 'colorscheme horizon'
cmd 'set cursorline'

--[[ This is experimental
vim.highlight.create('CursorLine', { gui=underline, cterm=underline, ctermbg=none, guibg=none, guifg=white, ctermfg=white }, true)
vim.highlight.create('CursorLineNR', { guifg=white, ctermfg=white }, true) ]]
-- vim.api.nvim_exec([[
-- 	hi CursorLine gui=underline cterm=underline ctermbg=none guibg=none
-- 	hi CursorLineNR guifg=white ctermfg=white
-- ]], true)

-- Italics
vim.api.nvim_exec([[
	highlight Keyword cterm=italic term=italic gui=italic
	highlight Identifier cterm=italic term=italic gui=italic
	highlight String cterm=italic term=italic gui=italic
	highlight Number cterm=italic term=italic gui=italic
	highlight Character cterm=italic term=italic gui=italic
	highlight Float cterm=italic term=italic gui=italic
	highlight Boolean cterm=italic term=italic gui=italic
	highlight Reference cterm=italic term=italic gui=italic
	highlight Function cterm=italic term=italic gui=italic
	highlight Conditional cterm=italic term=italic gui=italic
	highlight Label cterm=italic term=italic gui=italic
	highlight Repeat cterm=italic term=italic gui=italic
	highlight PreProc cterm=italic term=italic gui=italic
	highlight htmlArg cterm=italic term=italic gui=italic
	highlight xmlAttrib cterm=italic term=italic gui=italic
	highlight Type cterm=italic term=italic gui=italic
]], true)
