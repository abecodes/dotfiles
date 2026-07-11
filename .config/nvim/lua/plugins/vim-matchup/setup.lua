-- nvim-treesitter.configs was removed in the main branch rewrite.
-- vim-matchup auto-enables treesitter integration on Neovim — no setup needed.

-- Default is { method = 'status' }: when cursor sits on a bracket whose match
-- is above the viewport, matchup overlays the matching line onto the whole
-- statusline (clock, line:col, diagnostics — all gone until scroll-back).
-- Disabled outright. To restore the context info as a floating window at the
-- top of the viewport instead, use:
--   vim.g.matchup_matchparen_offscreen = { method = 'popup' }
vim.g.matchup_matchparen_offscreen = {}
