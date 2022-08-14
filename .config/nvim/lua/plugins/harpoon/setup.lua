local map = require'utils'.map
local opts = { noremap = true, silent = true }

map('n', 'hm', '<CMD>lua require("harpoon.mark").add_file()<CR>', opts)
map('n', 'hn', '<CMD>lua require("harpoon.ui").nav_next()<CR>', opts)
map('n', 'hp', '<CMD>lua require("harpoon.ui").nav_prev()<CR>', opts)
map('n', 'ht', '<CMD>lua require("harpoon.ui").toggle_quick_menu()<CR>', opts)
