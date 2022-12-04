local fterm = require('FTerm')
local utils = require('utils')

local lazygit = fterm:new({
    ft = 'fterm_lazygit',
    cmd = 'lazygit',
    border = {
		{'╭', 'DiagnosticHint'},
		{'─', 'DiagnosticHint'},
		{'╮', 'DiagnosticHint'},
		{'│', 'DiagnosticHint'},
		{'╯', 'DiagnosticHint'},
		{'─', 'DiagnosticHint'},
		{'╰', 'DiagnosticHint'},
		{'│', 'DiagnosticHint'},
	},
})

utils.new_cmd('FTermLazygit', function() lazygit:toggle() end, {})
