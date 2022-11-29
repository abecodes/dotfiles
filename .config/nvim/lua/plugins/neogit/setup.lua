local map = require'utils'.map_key
local opts = {silent = true}

map(
	"n",
	"<leader>g",
	"<cmd>lua require('neogit').open()<CR>",
	opts
)
