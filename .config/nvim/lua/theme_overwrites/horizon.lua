local theme = require('theme')
local P = require('theme.palette').raw

-- Cross-cutting hexes (mint, coral, azure, violet, slate) flow from the
-- shared palette; scheme-specific ones (red, orange, cyan, white, grey_l)
-- stay as literals — they are horizon's own palette.
local color = {
	red = {
		fg = { fg = '#eC6a88', ctermfg = 203 },
		bg = { bg = '#eC6a88', ctermbg = 203 },
	},
	green = {
		fg = { fg = P.mint, ctermfg = 48 },
		bg = { bg = P.mint, ctermbg = 48 },
	},
	yellow = {
		fg = { fg = P.coral, ctermfg = 209 },
		bg = { bg = P.coral, ctermbg = 209 },
	},
	blue = {
		fg = { fg = P.azure, ctermfg = 75 },
		bg = { bg = P.azure, ctermbg = 75 },
	},
	orange = {
		fg = { fg = '#f09483', ctermfg = 209 },
		bg = { bg = '#f09483', ctermbg = 209 },
	},
	purple = {
		fg = { fg = P.violet, ctermfg = 171 },
		bg = { bg = P.violet, ctermbg = 171 },
	},
	cyan = {
		fg = { fg = '#25b0bc', ctermfg = 37 },
		bg = { bg = '#25b0bc', ctermbg = 37 },
	},
	white = {
		fg = { fg = '#dcdfe4', ctermfg = 188 },
		bg = { bg = '#dcdfe4', ctermbg = 188 },
	},
	grey = {
		fg = { fg = P.slate, ctermfg = 242 },
		bg = { bg = P.slate, ctermbg = 242 },
	},
	grey_l = {
		fg = { fg = '#272c42', ctermfg = 236 },
		bg = { bg = '#272c42', ctermbg = 236 },
	},
	none = {
		fg = { fg = 'none', ctermfg = 'none' },
		bg = { bg = 'none', ctermbg = 'none' },
	},
}

return function(ev)
	--- Blue
	for _, s in pairs({
		'@namespace',
		-- '@parameter',
		'@operator'
	}) do
		theme.update_highlight(s, color.blue.fg)
	end
	--- Red
	for _, s in pairs({
		'@constant.builtin',
	}) do
		theme.update_highlight(s, color.red.fg)
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
		theme.update_highlight(s, color.purple.fg)
	end
	--- orange
	for _, s in pairs({
		'@string.special',
		'@string.escape',
		'@character.special',
	}) do
		theme.update_highlight(s, color.orange.fg)
	end
	--- Yellow
	for _, s in pairs({
		'@type',
		'@type.definition',
	}) do
		theme.update_highlight(s, color.yellow.fg)
	end
	--- White
	for _, s in pairs({
		'@variable',
	}) do
		theme.update_highlight(s, color.white.fg)
	end
	--- none
	theme.update_highlight('Todo', color.none.bg)
	theme.update_highlight('Pmenu', color.white.fg, color.none.bg)
	theme.update_highlight('PmenuSel', color.green.fg, color.none.bg)
	theme.update_highlight('FloatBorder', color.grey.fg, color.none.bg)
	theme.update_highlight('WinSeparator', color.grey.fg, color.none.bg)
end
