local map = require 'utils'.map_key

map('n', "<leader>pc",
	"<CMD>TSContext toggle<CR>", { silent = true })
