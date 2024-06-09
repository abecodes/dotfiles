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
		-- ibl behaves super weird
		-- these highlights are setup by rainbow-delimiter and theme overwrites
		-- but instead of inheriting them ibl does some stuff and gets wrong colors
		-- therefore we need this code here again, to set the correct colors
		vim.api.nvim_set_hl(0, 'RainbowDelimiterRed', { link = 'Macro' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterYellow', { link = 'Define' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterBlue', { link = 'Tag' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterOrange', { link = 'PreProc' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterGreen', { link = 'Question' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterViolet', { link = 'String' })
		vim.api.nvim_set_hl(0, 'RainbowDelimiterCyan', { link = 'Special' })
	end
)

-- vim.g.rainbow_delimiters = { highlight = highlight }
require('ibl').setup({
	indent = {
		char = '▏',
		-- char = '▎',
		-- tab_char = { 'a', 'b', 'c' },
		-- highlight = { 'WinSeparator' },
		-- smart_indent_cap = true,
		-- priority = 2,
	},
	scope = {
		enabled = true,
		char = '▎',
		-- char = '▏',
		highlight = highlight,
		-- show_start = false,
		-- show_end = false,
		include = {
			node_type = {
				go = {
					-- get name of current node:
					-- lua vim.print(vim.treesitter.get_node():type())
					'field_declaration_list',
					'import_spec_list'
				},
			},
		},
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
	-- whitespace = { highlight = { 'Whitespace', 'NonText' }},
})

hooks.register(
	hooks.type.SCOPE_HIGHLIGHT,
	hooks.builtin.scope_highlight_from_extmark
)

-- local g = vim.g
--[[ g.indent_blankline_char_highlight_list = {
	'Boolean',
	'Function',
	'Reference',
	'Keyword'
} ]] -- define the highlight groups with only background colors (or leave odd empty to just show the normal background)

-- vim.cmd [[highlight IndentEven guifg=NONE guibg=#0000ff gui=nocombine]]
-- vim.cmd [[highlight IndentOdd guifg=NONE guibg=NONE gui=nocombine]]
-- vim.cmd [[highlight link IndentEven CursorLine]]

-- and then use the highlight groups
-- g.indent_blankline_char_highlight_list = {'IndentOdd', 'IndentEven'}
-- g.indent_blankline_space_char_highlight_list = {'IndentOdd', 'IndentEven'}

-- don't show any characters
-- g.indent_blankline_char = ' '
-- g.indent_blankline_space_char = ' '

-- when using background, the trailing indent is not needed / looks wrong
-- g.indent_blankline_show_trailing_blankline_indent = false
-- g.indent_blankline_filetype_exclude = {'man', 'Terminal', 'startify', 'Prompt'}
