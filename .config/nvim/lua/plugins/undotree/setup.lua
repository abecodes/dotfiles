local map = require'utils'.map

map('n', "<leader>pu",
    "<CMD>UndotreeToggle<CR>", {silent = true})
