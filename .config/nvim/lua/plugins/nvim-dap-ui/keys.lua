-- Re-export nvim-dap's keymaps. nvim-dap-ui has no leader keymaps of
-- its own; this file exists purely so both specs' `on_key = true`
-- resolve to the same lazy-trigger bundle (see lua/pack/ARCHITECTURE.md
-- → "Lazy propagation"). First press of any <leader>d* key triggers
-- dap-ui's stub, which via `wants = 'mfussenegger/nvim-dap'` loads dap
-- first — dap's setup registers the real keymaps.
return require('plugins.nvim-dap.keys')
