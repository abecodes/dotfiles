-- nvim-peekup self-registers `""` via vim.g.peekup_open when the plugin
-- is packadded. This file exists solely so the loader can install a
-- desc-bearing stub (via `on_key = true` in plugins.lua); the rhs is
-- not consumed by setup.lua and is intentionally empty.
return {
	{ mode = 'n', lhs = '""', rhs = '', opts = { desc = 'Peek registers' } },
}
