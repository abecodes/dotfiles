local cmd = vim.cmd

cmd 'set cursorline'
-- cmd 'colorscheme horizon'
-- dark schemes
cmd 'colorscheme base2tone_evening_dark'
-- or any of the other schemes:
-- cmd 'colorscheme base2tone_morning_dark'
-- cmd 'colorscheme base2tone_sea_dark'
-- cmd 'colorscheme base2tone_space_dark'
-- cmd 'colorscheme base2tone_earth_dark'
-- cmd 'colorscheme base2tone_forest_dark'
-- cmd 'colorscheme base2tone_field_dark'
-- cmd 'colorscheme base2tone_garden_dark'
-- cmd 'colorscheme base2tone_desert_dark'
-- cmd 'colorscheme base2tone_lake_dark'
-- cmd 'colorscheme base2tone_meadow_dark'
-- cmd 'colorscheme base2tone_drawbridge_dark'
-- cmd 'colorscheme base2tone_mall_dark'
-- cmd 'colorscheme base2tone_suburb_dark'
-- cmd 'colorscheme base2tone_lavender_dark'
-- cmd 'colorscheme base2tone_pool_dark'
-- cmd 'colorscheme base2tone_porch_dark'
-- cmd 'colorscheme base2tone_heath_dark'
-- cmd 'colorscheme base2tone_cave_dark'
-- cmd 'colorscheme base2tone_motel_dark'

-- light schemes
-- cmd 'colorscheme base2tone_evening_light'
-- cmd 'colorscheme base2tone_morning_light'
-- cmd 'colorscheme base2tone_sea_light'
-- cmd 'colorscheme base2tone_space_light'
-- cmd 'colorscheme base2tone_earth_light'
-- cmd 'colorscheme base2tone_forest_light'
-- cmd 'colorscheme base2tone_field_light'
-- cmd 'colorscheme base2tone_garden_light'
-- cmd 'colorscheme base2tone_desert_light'
-- cmd 'colorscheme base2tone_lake_light'
-- cmd 'colorscheme base2tone_meadow_light'
-- cmd 'colorscheme base2tone_drawbridge_light'
-- cmd 'colorscheme base2tone_mall_light'
-- cmd 'colorscheme base2tone_suburb_light'
-- cmd 'colorscheme base2tone_lavender_light'
-- cmd 'colorscheme base2tone_pool_light'
-- cmd 'colorscheme base2tone_porch_light'
-- cmd 'colorscheme base2tone_heath_light'
-- cmd 'colorscheme base2tone_cave_light'
-- cmd 'colorscheme base2tone_motel_light'

--[[
Horizon colors

red = {guifg=#eC6a88, ctermfg=203},
green = {guifg=#09f7a0, ctermfg=48},
yellow = {guifg=#fab795, ctermfg=209},
blue = {guifg=#25b0bc, ctermfg=37},
purple = {guifg=#b877db, ctermfg=171},
cyan = {guifg=#25b0bc, ctermfg=37},
white = {guifg=#dcdfe4, ctermfg=188}
]]--

--[[
To be able to allow each user to pick his favorite set of colors, there must
be preferred names for highlight groups that are common for many languages.
These are the suggested group names (if syntax highlighting works properly
you can see the actual color, except for 'Ignore'):

	*Comment	any comment

	*Constant	any constant
	String		a string constant: 'this is a string'
	Character	a character constant: 'c', '\n'
	Number		a number constant: 234, 0xff
	Boolean	a boolean constant: TRUE, false
	Float		a floating point constant: 2.3e10

	*Identifier	any variable name
	Function	function name (also: methods for classes)

	*Statement	any statement
	Conditional	if, then, else, endif, switch, etc.
	Repeat		for, do, while, etc.
	Label		case, default, etc.
	Operator	'sizeof', '+', '*', etc.
	Keyword	any other keyword
	Exception	try, catch, throw

	*PreProc	generic Preprocessor
	Include	preprocessor #include
	Define		preprocessor #define
	Macro		same as Define
	PreCondit	preprocessor #if, #else, #endif, etc.

	*Type		int, long, char, etc.
	StorageClass	static, register, volatile, etc.
	Structure	struct, union, enum, etc.
	Typedef	A typedef

	*Special	any special symbol
	SpecialChar	special character in a constant
	Tag		you can use CTRL-] on this
	Delimiter	character that needs attention
	SpecialComment	special things inside a comment
	Debug		debugging statements

	*Underlined	text that stands out, HTML links

	*Ignore		left blank, hidden  |hl-Ignore|

	*Error		any erroneous construct

	*Todo		anything that needs extra attention; mostly the
			keywords TODO FIXME and XXX

The names marked with * are the preferred groups; the others are minor groups.
For the preferred groups, the 'syntax.vim' file contains default highlighting.
The minor groups are linked to the preferred groups, so they get the same
highlighting.  You can override these defaults by using ':highlight' commands
after sourcing the 'syntax.vim' file.

Note that highlight group names are not case sensitive.  'String' and 'string'
can be used for the same group.
]]--

--[[
If needed sync keywords to styleable types
syn keyword     goPackage           package
syn keyword     goImport            import    contained
syn keyword     goVar               var       contained
syn keyword     goConst             const     contained
]]--

--[[ This is experimental
vim.highlight.create('CursorLine', { gui=underline, cterm=underline, ctermbg=none, guibg=none, guifg=white, ctermfg=white }, true)
vim.highlight.create('CursorLineNR', { guifg=white, ctermfg=white }, true) ]]
-- vim.api.nvim_exec([[
-- 	hi CursorLine gui=underline cterm=underline ctermbg=none guibg=none
-- 	hi CursorLineNR guifg=white ctermfg=white
-- ]], true)

--[[
	• fg (or foreground): color name or '#RRGGBB', see note.
	• bg (or background): color name or '#RRGGBB', see note.
	• sp (or special): color name or '#RRGGBB'
	• ctermfg: Sets foreground of cterm color |ctermfg|
	• ctermbg: Sets background of cterm color |ctermbg|
]]--

local color = {
	red = {
		fg = {
			fg = '#eC6a88',
			ctermfg = 203,
		},
		bg = {
			bg = '#eC6a88',
			ctermbg = 203,
		},
	},
	green = {
		fg = {
			fg = '#09f7a0',
			ctermfg = 48,
		},
		bg = {
			bg = '#09f7a0',
			ctermbg = 48,
		},
	},
	yellow = {
		fg = {
			fg = '#fab795',
			ctermfg = 209,
		},
		bg = {
			bg = '#fab795',
			ctermbg = 209,
		},
	},
	blue = {
		fg = {
			fg = '#599eff',
			ctermfg = 75,
		},
		bg = {
			bg = '#599eff',
			ctermbg = 75,
		},
	},
	orange = {
		fg = {
			fg = '#f09483',
			ctermfg = 209,
		},
		bg = {
			bg = '#f09483',
			ctermbg = 209,
		},
	},
	purple = {
		fg = {
			fg = '#b877db',
			ctermfg = 171,
		},
		bg = {
			bg = '#b877db',
			ctermbg = 171,
		},
	},
	cyan = {
		fg = {
			fg = '#25b0bc',
			ctermfg = 37,
		},
		bg = {
			bg = '#25b0bc',
			ctermbg = 37,
		},
	},
	white = {
		fg = {
			fg = '#dcdfe4',
			ctermfg = 188,
		},
		bg = {
			bg = '#dcdfe4',
			ctermbg = 188,
		},
	},
	grey = {
		fg = {
			fg = '#6c6f93',
			ctermfg = 242,
		},
		bg = {
			bg = '#6c6f93',
			ctermbg = 242,
		}
	},
	grey_l = {
		fg = {
			fg = '#272c42',
			ctermfg=236,
		},
		bg = {
			bg = '#272c42',
			ctermbg=236,
		},
	},
	none = {
		fg = {
			fg = 'none',
			ctermfg = 'none',
		},
		bg = {
			bg = 'none',
			ctermbg = 'none',
		},
	},
}

--[[
	• blend: integer between 0 and 100
	• bold: boolean
	• standout: boolean
	• underline: boolean
	• undercurl: boolean
	• underdouble: boolean
	• underdotted: boolean
	• underdashed: boolean
	• strikethrough: boolean
	• italic: boolean
	• cterm: cterm attribute map, like |highlight-args|. If not set, cterm attributes will match those from the attribute map documented above.

	• reverse: boolean
	• nocombine: boolean
	• link: name of another highlight group to link to, see|:hi-link|.
	• default: Don't override existing definition |:hi-default|
]]--

local style = {
	bold = {
		bold = true,
		cterm = { bold = true },
	},
	bold_italic = {
		bold = true,
		italic = true,
		cterm = {
			bold = true,
			italic = true,
		},
	},
	italic = {
		italic = true,
		cterm = { italic = true },
	},
	none = {
		bold = false,
		standout = false,
		underline = false,
		undercurl = false,
		underdouble = false,
		underdotted = false,
		underdashed = false,
		strikethrough = false,
		italic = false,
		cterm = {
			bold = false,
			standout = false,
			underline = false,
			undercurl = false,
			underdouble = false,
			underdotted = false,
			underdashed = false,
			strikethrough = false,
			italic = false,
		},
	},
}

local set_highlight = function(id, ...)
	local args = {...}

	vim.api.nvim_set_hl(
		0,
		id,
		vim.tbl_extend(
			'force',
			{},
			unpack(args, select('#', args))
		)
	)
end

local update_highlight = function(id, ...)
	local args = {...}

	vim.api.nvim_set_hl(
		0,
		id,
		vim.tbl_extend(
			'force',
			{},
			vim.api.nvim_get_hl_by_name(id, true),
			unpack(args, select('#', args))
		)
	)
end

--[[
-- Recolor for horizon
--- Blue
for _, s in pairs({
	'@namespace',
	-- '@parameter',
	'@operator'
}) do
	update_highlight(s, color.blue.fg)
end
--- Red
for _, s in pairs({
	'@constant.builtin',
}) do
	update_highlight(s, color.red.fg)
end
--- Purple
for _, s in pairs({
	'Keyword',
	'Conditional',
	'Repeat',
	'Label',
	'Exception',
	'Include'
}) do
	update_highlight(s, color.purple.fg)
end
--- orange
for _, s in pairs({
	'@string.special',
	'@string.escape',
	'@character.special',
}) do
	update_highlight(s, color.orange.fg)
end
--- Yellow
for _, s in pairs({
	'@type',
	'@type.definition',
}) do
	update_highlight(s, color.yellow.fg)
end
--- White
for _, s in pairs({
	'@variable',
}) do
	update_highlight(s, color.white.fg)
end
--- none
update_highlight('Todo', color.none.bg)
update_highlight('Pmenu', color.white.fg, color.none.bg)
update_highlight('PmenuSel', color.green.fg, color.none.bg)
update_highlight('FloatBorder', color.grey.fg, color.none.bg)
update_highlight('WinSeparator', color.grey.fg, color.none.bg)
]]--

set_highlight("none", color.none.fg, color.none.bg, style.none)

-- Recolor for base2tone_evening_dark
for _, s in pairs({
	'FloatBorder',
	'FloatTitle',
}) do
	update_highlight(s, color.grey.fg, color.none.bg)
end

-- Italic
for _, s in pairs({
	'Comment',
	'Constant',
	'Type',
	'StorageClass',
	'Structure',
	'PmenuSel',
}) do
	update_highlight(s, style.italic)
end

-- Bold
for _, s in pairs({
	'Include',
	'@namespace',
	'@type',
	'@type.definition',
	'@constant.builtin'
}) do
	update_highlight(s, style.bold)
end

-- BoldItalic
for _, s in pairs({
	'Conditional',
	'Label',
	'Repeat',
	'Keyword',
	'Todo',
	'@function.builtin',
}) do
	update_highlight(s, style.bold_italic)
end

-- None
for _, s in pairs({
	'Pmenu',
	'@punctuation.bracket',
	'@variable',
}) do
	update_highlight(s, style.none)
end

update_highlight('Number', vim.tbl_extend('force', style.none, { bold = true, cterm = {bold = true }}))

update_highlight(
	'SpellBad',
	vim.tbl_extend(
		'force',
		style.none,
		{
			undercurl = true,
			sp = '#599eff',
			cterm = {
				undercurl = true
			}
		}
	)
)

update_highlight(
	'SpellBad',
	color.none.fg
)

-- changes for do.nvim
-- vim.api.nvim_set_hl(0, 'TabLineSel', { link = 'DiagnosticOk' })
