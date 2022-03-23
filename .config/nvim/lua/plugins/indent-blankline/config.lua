local g = vim.g
--[[ g.indent_blankline_char_highlight_list = {
	"Boolean",
	"Function",
	"Reference",
	"Keyword"
} ]] -- define the highlight groups with only background colors (or leave odd empty to just show the normal background)
-- vim.cmd [[highlight IndentEven guifg=NONE guibg=#0000ff gui=nocombine]]
vim.cmd [[highlight IndentOdd guifg=NONE guibg=NONE gui=nocombine]]
vim.cmd [[highlight link IndentEven CursorLine]]

-- and then use the highlight groups
g.indent_blankline_char_highlight_list = {"IndentOdd", "IndentEven"}
g.indent_blankline_space_char_highlight_list = {"IndentOdd", "IndentEven"}

-- don't show any characters
g.indent_blankline_char = " "
g.indent_blankline_space_char = " "

-- when using background, the trailing indent is not needed / looks wrong
g.indent_blankline_show_trailing_blankline_indent = false
g.indent_blankline_filetype_exclude = {'man', 'Terminal', 'startify', 'Prompt'}
