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

-- Extract block doesn't need visual mode
map(
	"n",
	"<leader>rb",
	[[ <Cmd>lua require('refactoring').refactor('Extract Block')<CR>]],
	{silent = true, expr = false}
)
map(
	"n",
	"<leader>rB",
	[[ <Cmd>lua require('refactoring').refactor('Extract Block To File')<CR>]],
	{silent = true, expr = false}
)

-- Inline variable can also pick up the identifier currently under the cursor without visual mode
map(
	"n",
	"<leader>ri",
	[[ <Cmd>lua require('refactoring').refactor('Inline Variable')<CR>]],
	{silent = true, expr = false}
)
