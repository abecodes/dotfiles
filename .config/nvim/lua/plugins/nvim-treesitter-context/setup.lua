local map = require'utils'.map_key

map('n', "<leader>pc",
    "<CMD>TSContextToggle<CR>", {silent = true})
