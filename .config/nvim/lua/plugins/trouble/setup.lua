local map = require'utils'.map_key

map("n", "<leader>x", "<cmd>TroubleToggle<cr>", {silent = true})
map("n", "<leader>xw", "<cmd>TroubleToggle workspace_diagnostics<cr>", {silent = true})
map("n", "<leader>xd", "<cmd>TroubleToggle document_diagnostics<cr>", {silent = true})
map("n", "<leader>xl", "<cmd>TroubleToggle loclist<cr>", {silent = true})
map("n", "<leader>xq", "<cmd>TroubleToggle quickfix<cr>", {silent = true})
map("n", "<leader>xr", "<cmd>TroubleToggle lsp_references<cr>", {silent = true})
