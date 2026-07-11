local utils = require('utils')
local hooks = require('hooks.hooks')
local g = vim.g
local fn = vim.fn

g.startify_session_dir = '~/.config/nvim/sessions'

-- g.startify_change_to_vcs_root = 1

-- 'Most Recent Files' number (lowered from 10 — smaller MRU stat cost, still plenty)
g.startify_files_number = 6

-- Update session automatically as you exit vim
g.startify_session_persistence = 1

-- Short-circuit the two git subprocess calls below when cwd isn't inside a
-- worktree. Re-evaluated per render (not frozen at config-load) so `:cd`
-- into/out of a repo mid-session is honoured. `finddir('.git', '.;')` walks
-- parents for a `.git` entry — no fork, cheap.

--[[ returns all modified files of the current git repo
`2>/dev/null` makes the command fail quietly, so that when we are not
in a git repo, the list will be empty ]]
vim.api.nvim_exec2([[
  function! Startify_GitModified()
      if empty(finddir('.git', '.;')) | return [] | endif
      let files = systemlist('git ls-files -m 2>/dev/null')
      return map(files, "{'line': v:val, 'path': v:val}")
  endfunction
  ]], { output = true })

-- same as above, but show untracked files, honouring .gitignore
vim.api.nvim_exec2([[
  function! Startify_GitUntracked()
      if empty(finddir('.git', '.;')) | return [] | endif
      let files = systemlist('git ls-files -o --exclude-standard 2>/dev/null')
      return map(files, "{'line': v:val, 'path': v:val}")
  endfunction
  ]], { output = true })

-- Simplify the startify list to just recent files and sessions
g.startify_lists = {
	{ type = 'dir',                           header = { '   Recent Project files' .. fn.getcwd() } },
	{ type = vim.fn['Startify_GitModified'],  header = { '   git modified' } },
	{ type = vim.fn['Startify_GitUntracked'], header = { '   git untracked' } },
	{ type = 'sessions',                      header = { '   Saved sessions' } },
	{ type = 'bookmarks',                     header = { '   Bookmarks' } }
}

g.startify_bookmarks = { { b = '~/_blog' } }

local header = [[

             _                          _
            | |                        | |
       _____| |__  _____  ____ ___   __| |_____  ___
      (____ |  _ \| ___ |/ ___) _ \ / _  | ___ |/___)
      / ___ | |_) ) ____( (__| |_| ( (_| | ____|___ |
      \_____|____/|_____)\____)___/ \____|_____|___/

  ]]

g.startify_custom_header = vim.split(header, '\n', { plain = true })

--[[ _G.vim_startify_unique_session_name = function()
  local path = fn.fnamemodify(fn.getcwd(), ':~:t')
  local path = fn.empty(path) and 'no-project' or path
  local branch = fn['gitbranch#name']()
  local branch = fn.empty(branch) and '' or ('-' .. branch)
  return fn.substitute(path . branch, '/', '-', 'g')
end ]]

local vim_starify_save_session = function()
	local path = fn.fnamemodify(fn.getcwd(), ':~:t')
	path = (string.len(path) == 0 and 'no-project' or path)
	-- local branch = fn['gitbranch#name']()
	local branch = utils.git.git_branch()
	branch = (string.len(branch) == 0 and '' or ('-' .. branch))

	if string.len(branch) > 0 then
		vim.cmd('SSave! ' .. string.gsub(path .. branch, '/', '-'))
	end
end

hooks.register(
	'*',
	'VimEnter',
	{
		function()
			vim.cmd('if !argc() | Startify | wincmd w | endif')
		end
	}
)
hooks.register(
	'*',
	'VimLeavePre',
	{
		vim_starify_save_session
	}
)
hooks.register(
	'Startified',
	'User',
	{
		function()
			vim.cmd('setlocal buflisted')
		end
	}
)

-- vim.api.nvim_exec([[
--   augroup VimStartify
--     autocmd VimEnter * if !argc() | Startify | wincmd w | endif
--     autocmd VimLeavePre * silent :lua vim_starify_save_session()
--     autocmd User Startified setlocal buflisted
--   augroup END
-- ]], true)
