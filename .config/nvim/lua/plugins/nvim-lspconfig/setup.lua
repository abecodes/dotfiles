local map = require'utils'.map

-- see custom lsp on attach function
-- maybe move everything to here
--[[ map('n', "gd", "lua vim.lsp.buf.definition()<CR>", {silent = true})
map('n', "gD", "lua vim.lsp.buf.declaration()<CR>", {silent = true})
map('n', "gr", "lua vim.lsp.buf.references()<CR>", {silent = true})
map('n', "gi", "lua vim.lsp.buf.implementation()<CR>", {silent = true})
map('n', "K", "lua vim.lsp.buf.hover()<CR>", {silent = true})
map('n', "<C-k>", "lua vim.lsp.buf.signature_help()<CR>", {silent = true})
map('n', "<C-n>", "lua vim.lsp.diagnostic.goto_prev()<CR>", {silent = true})
map('n', "<C-p>", "lua vim.lsp.diagnostic.goto_next()<CR>", {silent = true}) ]]
