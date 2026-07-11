local cmd = vim.cmd -- to execute Vim commands e.g. cmd('pwd')
local fn = vim.fn   -- to call Vim functions e.g. fn.bufnr()
local g = vim.g     -- a table to access global variables
local opt = vim.opt -- to set options

-- Don't dispay mode in command line (lightline already shows it)
cmd 'set noshowmode'
-- Don't show last command
cmd 'set noshowcmd'

-- for plugin nvim-ts-context-commentstring
g.skip_ts_context_commentstring_module = true

if fn.has("termguicolors") then opt.termguicolors = true end

if fn.executable('rg') then
	opt.grepformat = '%f:%l:%c:%m'
	opt.grepprg = 'rg --vimgrep --no-heading --smart-case'
end

opt.background = 'dark'
opt.relativenumber = true
opt.spelllang = 'en_us'
opt.spell = true
opt.hidden = true
opt.cmdheight = 1
-- snappier CursorHold for LSP document_highlight (see lsp/utils/attach.lua)
opt.updatetime = 100
-- always show signcolumns
opt.signcolumn = 'yes'
-- Yank and paste with the system clipboard
opt.clipboard = 'unnamed'
-- Set preview window to appear at bottom
opt.splitbelow = true
-- ignore case when searching
opt.ignorecase = true
-- if the search string has an upper case letter in it, the search will be case sensitive
opt.smartcase = true
-- Automatically re-read file if a change was detected outside of vim
opt.autoread = true
opt.jumpoptions = 'stack' -- how items in the jumplist are arranged
-- Ensure a trailing newline on write when the buffer doesn't end in one.
-- This is the Neovim default; keep it explicit because the EOL invariant
-- is relied on by pde/rules/ensure_last_line.lua.
opt.fixeol = true
-- Global statusline: one at the bottom shared across all windows,
-- instead of per-window (which 2 would give).
opt.laststatus = 3

-- Render width for literal `\t` characters and column count for `>>`/`<<`.
-- Applies to tab-indented files (Go, Makefiles, this dotfiles repo); has no
-- effect on space-indented content since `tabstop` is display-only. We do NOT
-- set `expandtab` globally — each ftplugin owns the tabs-vs-spaces decision so
-- Python/YAML/JSON keep their native on-disk format. See
-- `lua/pde/rules/ensure_tabstop.lua` for why a global `noexpandtab` hook is
-- wrong (YAML is spec-illegal with tabs; Python mutates docstrings; etc.).
opt.tabstop = 2
opt.shiftwidth = 2

vim.diagnostic.config({
	float = {
		source = true,
	}
})
