local map = require'utils'.map
local opts = {silent = true}

map(
	"n",
	"<leader>g",
	"<cmd>lua require('neogit').open()<CR>",
	opts
)
