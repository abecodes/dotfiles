local utils = require('utils')
local cache = require('cache')

-- VCS markers take priority: they always point to the repo root.
-- Build markers (go.mod, package.json) are sub-module aware and only used
-- as a fallback when no VCS root is found.
local vcs_markers   = { '.git', '.hg', '.svn' }
local build_markers = { 'Makefile', 'go.mod', 'package.json' }

-- Session-lifetime cache keyed by buffer dirname. File-tree structure
-- doesn't normally shift mid-session; if a user runs `git init` mid-edit
-- and wants the new root picked up, :cd or a session restart covers it.
local root_cache = cache.new()

local function apply_root()
  -- Don't chdir on UI buffers (terminals, neogit, telescope, …).
  if utils.ui_buffer.is_ui_buffer(0) then return end

  local bufname = vim.api.nvim_buf_get_name(0)
  if bufname == '' then return end

  local dir = vim.fs.dirname(bufname)
  local root = root_cache.get(dir, function()
    return vim.fs.root(dir, vcs_markers) or vim.fs.root(dir, build_markers)
  end)
  if not root or root == vim.fn.getcwd() then return end

  -- Match the scope of whatever set the current directory so that :pwd
  -- reflects the change. haslocaldir() returns:
  --   0 = global cwd   → use :cd
  --   1 = window-local → use :lcd  (e.g. set by telescope after BufEnter)
  --   2 = tab-local    → use :tcd
  local scope = vim.fn.haslocaldir()
  if scope == 1 then
    vim.cmd('lcd ' .. vim.fn.fnameescape(root))
  elseif scope == 2 then
    vim.cmd('tcd ' .. vim.fn.fnameescape(root))
  else
    vim.fn.chdir(root)
  end
end

utils.autocmd.new_autocmd('BufEnter', 'rooter', {
  callback = function()
    -- Defer to the next event loop tick so any plugin that sets :lcd during
    -- the same BufEnter cycle (e.g. telescope-file-browser) runs first and
    -- we get the final say on the working directory.
    vim.schedule(apply_root)
  end,
})
