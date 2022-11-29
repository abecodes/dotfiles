local nvim_lsp = require('lspconfig')

-- format options: {tab_size = 2, insert_spaces = false, insert_final_newline = true}

-- disabled since gofumpt/gopls should do that allready
-- autocmd BufWritePre *.go lua require"lsp.servers.gopls.functions.organize_imports"(1000)
-- vim.api.nvim_exec([[
--     augroup GoImports
--         autocmd BufWritePre *.go lua vim.lsp.buf.format(nil, 1000)
--     augroup END
-- ]], true)

return {
    filetypes = {'go', 'gomod'},
    root_dir = function(fname)
        return nvim_lsp.util.root_pattern('go.mod', '.git')(fname) or
                nvim_lsp.util.path.dirname(fname)
    end,
    settings = {
        gopls = {
            -- formatting and linting via hook functions
            -- gofumpt = true,
            experimentalPostfixCompletions = true,
            usePlaceholders = true,
            -- analyses = {unusedparams = true, shadow = true},
            -- staticcheck = true
        }
    }
}
