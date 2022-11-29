local map = require'utils'.map_key

map('n', "<leader>pu",
    "<CMD>UndotreeToggle<CR>", {silent = true})
