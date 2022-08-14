local map = require'utils'.map

map('n', "<leader>pc",
    "<CMD>TSContextToggle<CR>", {silent = true})
