-- Only save changes if nothing new was written to the bfr in the meantime
vim.lsp.handlers["textDocument/formatting"] =
    -- function(err, _, result, _, bufnr)
    function(err, result, config)
        if err ~= nil or result == nil then return end
        if not vim.api.nvim_buf_get_option(config.bufnr, "modified") then
            local view = vim.fn.winsaveview()
            vim.lsp.util.apply_text_edits(result, config.bufnr)
            vim.fn.winrestview(view)
            if config.bufnr == vim.api.nvim_get_current_buf() then
                vim.api.nvim_command("noautocmd :update")
            end
        end
    end
