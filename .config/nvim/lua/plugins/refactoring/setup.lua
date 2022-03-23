local map = require'utils'.map

map(
	"v",
	"<Leader>re",
	[[ <Esc><Cmd>lua require('refactoring').refactor('Extract Function')<CR>]],
	{silent = true, expr = false}
)
map(
	"v",
	"<Leader>rf",
	[[ <Esc><Cmd>lua require('refactoring').refactor('Extract Function To File')<CR>]],
	{silent = true, expr = false}
)
map(
	"v",
	"<Leader>rv",
	[[ <Esc><Cmd>lua require('refactoring').refactor('Extract Variable')<CR>]],
	{silent = true, expr = false}
)
map(
	"v",
	"<Leader>ri",
	[[ <Esc><Cmd>lua require('refactoring').refactor('Inline Variable')<CR>]],
	{silent = true, expr = false}
)
