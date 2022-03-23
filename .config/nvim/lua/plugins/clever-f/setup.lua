local g = vim.g
-- controls to search a character across multi lines or not.
-- Please set it to 1 in your vimrc to search a character only in current line.
g.clever_f_across_no_line = 1
g.clever_f_smart_case = 1
g.clever_f_mark_char_color = 'Todo'
g.clever_f_highlight_timeout_ms = 2000

--[[ vim.api.nvim_exec([[
	highlight CustomH ctermfg=white ctermbg=NONE cterm=bold,underline guifg=white guibg=NONE gui=bold,underline
	highlight link CleverFChar Todo
	,true) ]]
