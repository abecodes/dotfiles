local map = require'utils'.map

map('n', "<leader>", "<CMD>WhichKey '<,>'<CR>", {silent = true})
map('v', "<leader>", "<c-u><CMD>WhichKeyVisual '<,>'<CR>", {silent = true})
