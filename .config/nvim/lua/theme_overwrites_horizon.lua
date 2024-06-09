local theme = require('theme')

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
