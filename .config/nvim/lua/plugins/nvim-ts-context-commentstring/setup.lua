-- ts-context-commentstring: configure before treesitter-based consumers read
-- its state. `enable_autocmd = false` disables the plugin's own autocmd
-- because we let treesitter-aware commenting plugins drive the commentstring
-- update themselves.
--
-- Runs in the eager setup pass (plugins.lua) because this plugin has no
-- explicit lazy field and, after the nvim-treesitter spec is removed in
-- phase 5, no reverse-deps → propagate_lazy leaves it eager by default.
-- Previously this call lived in lua/plugins/nvim-treesitter/setup.lua,
-- which has been removed.

require('ts_context_commentstring').setup({
  enable_autocmd = false,
})
