local cmd = vim.cmd -- to execute Vim commands e.g. cmd('pwd')
local fn = vim.fn -- to call Vim functions e.g. fn.bufnr()
local g = vim.g -- a table to access global variables
local opt = vim.opt -- to set options

-- Settings
--[[ opt.completeopt = {'menuone', 'noinsert', 'noselect'}  -- Completion options (for deoplete)
opt.expandtab = true                -- Use spaces instead of tabs
opt.hidden = true                   -- Enable background buffers
opt.ignorecase = true               -- Ignore case
opt.joinspaces = false              -- No double spaces with join
opt.list = true                     -- Show some invisible characters
opt.number = true                   -- Show line numbers
opt.relativenumber = true           -- Relative line numbers
opt.scrolloff = 4                   -- Lines of context
opt.shiftround = true               -- Round indent
opt.shiftwidth = 2                  -- Size of an indent
opt.sidescrolloff = 8               -- Columns of context
opt.smartcase = true                -- Do not ignore case with capitals
opt.smartindent = true              -- Insert indents automatically
opt.splitbelow = true               -- Put new windows below current
opt.splitright = true               -- Put new windows right of current
opt.tabstop = 2                     -- Number of spaces tabs count for
opt.termguicolors = true            -- True color support
opt.wildmode = {'list', 'longest'}  -- Command-line completion mode
opt.wrap = false                    -- Disable line wrap ]]

-- Don't dispay mode in command line (lightline already shows it)
cmd 'set noshowmode'
-- Don't show last command
cmd 'set noshowcmd'
-- don't give |ins-completion-menu| messages.
-- cmd 'set shortmess+=c'
-- Change vertical split character to be a space (essentially hide it)
-- cmd 'fillchars+=vert:.'
-- Some servers have issues with backup files, see #649
-- cmd 'set nobackup'
-- cmd 'set nowritebackup'

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
opt.cmdheight = 2
-- opt.updatetime = 300
opt.updatetime = 100 -- for vim-signify
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
-- Always keep cursor centered (seems to be overwritten by a plugin)
-- opt.scrolloff = 999
-- use on mac if neovim/fish is installed with brew
--[[ opt.shell = '/usr/local/bin/fish' ]]
opt.jumpoptions = 'stack' -- how items in the jumplist are arranged
