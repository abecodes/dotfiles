local utils = require('utils')
local lint = require('modules.go.lint')
local format = require('modules.go.format')
local impl = require('modules.go.impl')
local tests = require('modules.go.tests')
require('modules.go.json2struct')()
require('modules.ensureTabstop')()

utils.new_buf_cmd('Golint', lint, {})
utils.new_buf_cmd('Goformat', format, {})
utils.new_buf_cmd('Goimpl', impl, { nargs = '*'})
utils.new_buf_cmd('Gotestadd', tests.add, { nargs = '*'})
utils.new_buf_cmd('Gotestall', tests.all, { nargs = '*'})
utils.new_buf_cmd('Gotestexp', tests.exp, { nargs = '*'})

vim.keymap.set(
	'n',
	'ff',
	format,
	{ silent = true, buffer = 0 }
)

vim.keymap.set(
	'n',
	'll',
	lint,
	{ silent = true, buffer = 0 }
)
