local hooks = require 'ibl.hooks'

local highlight = {
	'RainbowDelimiterRed',
	'RainbowDelimiterYellow',
	'RainbowDelimiterBlue',
	'RainbowDelimiterOrange',
	'RainbowDelimiterGreen',
	'RainbowDelimiterViolet',
	'RainbowDelimiterCyan',
}


hooks.register(
	hooks.type.HIGHLIGHT_SETUP,
	function()
		-- unfortunately indent_blanklines does not work with linked groupes
		-- so we need to hardcode the colers here
		vim.api.nvim_set_hl(0, 'RainbowDelimiterRed', { fg = '#6a51e6' }) -- Macro
    vim.api.nvim_set_hl(0, 'RainbowDelimiterYellow', { fg = '#9a86fd' }) -- Define
    vim.api.nvim_set_hl(0, 'RainbowDelimiterBlue', { fg = '#c4b9fe' }) -- Tag
    vim.api.nvim_set_hl(0, 'RainbowDelimiterOrange', { fg = '#ffa142' }) -- SpellCap
    vim.api.nvim_set_hl(0, 'RainbowDelimiterGreen', { fg = '#ffb870' }) -- Question
    vim.api.nvim_set_hl(0, 'RainbowDelimiterViolet', { fg = '#eeebff' }) -- String
    vim.api.nvim_set_hl(0, 'RainbowDelimiterCyan', { fg = '#bab8c7' }) -- Special
		--[[vim.api.nvim_exec([[
			hi link RainbowRed RainbowDelimiterRed
			hi link RainbowYellow RainbowDelimiterYellow
			hi link RainbowBlue RainbowDelimiterBlue
			hi link RainbowOrange RainbowDelimiterOrange
			hi link RainbowGreen RainbowDelimiterGreen
			hi link RainbowViolet RainbowDelimiterViolet
			hi link RainbowCyan RainbowDelimiterCyan
		]]--[[, true)]]--
	end
)


-- vim.g.rainbow_delimiters = { highlight = highlight }
require('ibl').setup({
	indent = {
		-- char = "▎",
		-- tab_char = { "a", "b", "c" },
		highlight = { 'WinSeparator' },
		-- smart_indent_cap = true,
		-- priority = 2,
},
	scope = {
		char = '▏',
		highlight = highlight,
		-- show_start = false,
		-- show_end = false,
	},
	exclude = {
		filetypes = {
			'lspinfo',
			'packer',
			'checkhealth',
			'help',
			'man',
			'gitcommit',
			'TelescopePrompt',
			'TelescopeResults',
			'startify',
			'""',
		}
	}
	-- whitespace = { highlight = { "Whitespace", "NonText" }},
})

hooks.register(
	hooks.type.SCOPE_HIGHLIGHT,
	hooks.builtin.scope_highlight_from_extmark
)

-- local g = vim.g
--[[ g.indent_blankline_char_highlight_list = {
	"Boolean",
	"Function",
	"Reference",
	"Keyword"
} ]] -- define the highlight groups with only background colors (or leave odd empty to just show the normal background)

-- vim.cmd [[highlight IndentEven guifg=NONE guibg=#0000ff gui=nocombine]]
-- vim.cmd [[highlight IndentOdd guifg=NONE guibg=NONE gui=nocombine]]
-- vim.cmd [[highlight link IndentEven CursorLine]]

-- and then use the highlight groups
-- g.indent_blankline_char_highlight_list = {"IndentOdd", "IndentEven"}
-- g.indent_blankline_space_char_highlight_list = {"IndentOdd", "IndentEven"}

-- don't show any characters
-- g.indent_blankline_char = " "
-- g.indent_blankline_space_char = " "

-- when using background, the trailing indent is not needed / looks wrong
-- g.indent_blankline_show_trailing_blankline_indent = false
-- g.indent_blankline_filetype_exclude = {'man', 'Terminal', 'startify', 'Prompt'}
