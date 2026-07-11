-- In-tree replacement for nvim-treesitter (archived upstream).
--
-- Load order: `require('treesitter')` MUST run before `require('plugins')` in
-- the top-level init.lua. Reasons:
--   1. Registers `package.preload['nvim-treesitter']` (phase 3) so plugins
--      that call `require('nvim-treesitter')` at setup/config time hit our
--      shim.
--   2. Registers the FileType autocmd dispatcher (phase 2) *before* any
--      plugin's own FileType autocmd — autocmds fire in registration order,
--      so `vim.treesitter.start()` runs before downstream consumers
--      (rainbow-delimiters, navic, etc.) try to attach to the parser.
--
-- Auto-setup on first require — call `require('treesitter')` once and
-- everything wires up. Idempotent.

local install     = require('treesitter.install')
local validate    = require('treesitter.validate')
local attach      = require('treesitter.attach')

local M           = {}

local initialized = false

function M.setup()
	if initialized then return end
	initialized = true

	-- Shim preloads FIRST, before any plugin's FileType autocmd registers,
	-- so downstream require('nvim-treesitter') resolves to our in-tree shim.
	require('treesitter.shim').register()

	-- User commands: :TSInstall, :TSUpdate, :TSUninstall, :TSVerifySources
	require('treesitter.commands').setup()

	-- FileType dispatcher + BufReadPost large-file opt-out. Queries are
	-- registered lazily per-lang on the first attach (see queries.ensure).
	attach.setup(install.list_installed())

	-- ABI probe on next tick so nvim has finished its own startup.
	vim.schedule(function() validate.probe() end)
end

M.setup()

return M
