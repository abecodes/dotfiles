local map = require'utils'.map_key
local opts = {silent = true}

map(
	"n",
	"<leader>g",
	"<cmd>lua require('neogit').open()<CR>",
	opts
)

vim.api.nvim_set_hl(0, 'NeogitDiffDeletions', { link = 'StatusLineNC' })
vim.api.nvim_set_hl(0, 'NeogitDiffDelete', { link = 'StatusLineNC' })
vim.api.nvim_set_hl(0, 'NeogitDiffDeleteHighlight', { link = 'StatusLineNC' })
vim.api.nvim_set_hl(0, 'NeogitDiffDeleteCursor', { link = 'StatusLineNC' })
