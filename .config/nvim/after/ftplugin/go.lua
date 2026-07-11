local utils = require('utils')
local lint = require('pde.lang.go.lint')
local format = require('pde.lang.go.format')
local impl = require('pde.lang.go.impl')
local tests = require('pde.lang.go.tests')
require('pde.lang.go.json2struct')()

utils.cmd.new_buf_cmd('Golint', lint.run, {})
utils.cmd.new_buf_cmd('GolintAll', lint.all, {})
utils.cmd.new_buf_cmd('Goformat', format, {})
utils.cmd.new_buf_cmd('Goimpl', impl, { nargs = '*'})
utils.cmd.new_buf_cmd('Gotestadd', tests.add, { nargs = '*'})
utils.cmd.new_buf_cmd('Gotestall', tests.all, { nargs = '*'})
utils.cmd.new_buf_cmd('Gotestexp', tests.exp, { nargs = '*'})

vim.keymap.set(
	'n',
	'ff',
	format,
	{ silent = true, buffer = 0 }
)

vim.keymap.set(
	'n',
	'll',
	lint.run,
	{ silent = true, buffer = 0 }
)
