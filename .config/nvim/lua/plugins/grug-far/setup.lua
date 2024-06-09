local map = require'utils'.map_key
local opts = { noremap = true, silent = true }

map('n', 'fw', '<CMD>lua require("grug-far").grug_far({ prefills = { search = vim.fn.expand("<cword>") } })<CR>', opts)
map('n', 'ff', '<CMD>lua require("grug-far").grug_far({ prefills = { flags = vim.fn.expand("%") } })<CR>', opts)
map('n', 'fv', '<CMD><C-u>lua require("grug-far").with_visual_selection({ prefills = { flags = vim.fn.expand("%") } })<CR>', opts)
