local profile = require('profiler')

require('settings')
require('cmds')
require('hooks')
require('keybindings')
require('keymap')
-- Must run BEFORE require('plugins'). Registers package.preload['nvim-treesitter']
-- (shim for the archived plugin), bootstraps queries, and installs our
-- FileType autocmd so it fires before any plugin's FileType handler. See
-- lua/treesitter/init.lua for the full rationale.
require('treesitter')
require('plugins')
require('pde.rooter')
require('ui.input')
require('ui.select')
require('lsp')
require('terminal')
require('theme')
require('theme_overwrites')
require('winbar')
require('notes.sticky').attach()
require('frecency.buffer').attach()

-- Enabled with NVIM_PROFILE=1; no-op otherwise.
profile.mark_autocmds({
	'VimEnter', 'UIEnter', 'SafeState',
	'BufReadPre', 'BufReadPost', 'FileType',
	'ColorScheme', 'BufWinEnter',
})
