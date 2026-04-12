-- nvim-treesitter.configs was removed in the main branch rewrite.
-- Parser installation is handled by :TSUpdate (automated via PackChanged hook in plugins_ii.lua).
-- Highlighting is managed by nvim-treesitter's own ftplugins via vim.treesitter.start().

-- ts-context-commentstring — separate plugin, keep its own setup
require('ts_context_commentstring').setup({
    enable_autocmd = false,
    commentary_integration = {
        Commentary = '<leader>/',
    },
})

-- Disable treesitter highlighting for large files (> 100 KB).
-- Runs after BufReadPost so ftplugins have already started treesitter.
vim.api.nvim_create_autocmd('BufReadPost', {
    callback = function(ev)
        local ok, stats = pcall(vim.uv.fs_stat, vim.api.nvim_buf_get_name(ev.buf))
        if ok and stats and stats.size > 100 * 1024 then
            vim.treesitter.stop(ev.buf)
        end
    end,
})
