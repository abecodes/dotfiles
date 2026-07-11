local git          = require('utils.git')
local branch_cache = require('cache').new()
local float        = require('ui.float')

local M = {}

-- Ensure storage dirs exist once at load time
local _data_base = vim.fn.stdpath('data') .. '/notes'
vim.fn.mkdir(_data_base .. '/projects',  'p')
vim.fn.mkdir(_data_base .. '/branches', 'p')

-- -----------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------

local function sanitize(str)
  return str:gsub('[/\\:*?"<>|%s]', '_')
end

-- Cached per-cwd with a 5s TTL so rapid :GitPad / :ProjectNote calls don't
-- each spawn git.
local function get_branch()
  return branch_cache.get(vim.fn.getcwd(), function()
    local b = git.git_branch()
    if b == '' then return 'no-branch' end
    return b
  end, 5000)
end

-- -----------------------------------------------------------------------
-- Public: path resolution
-- -----------------------------------------------------------------------

function M.get_project_file(ext)
  return _data_base .. '/projects/' .. sanitize(vim.fn.getcwd()) .. (ext or '.md')
end

function M.get_branch_file(ext)
  local key = sanitize(vim.fn.getcwd()) .. '__' .. sanitize(get_branch())
  return _data_base .. '/branches/' .. key .. (ext or '.md')
end

-- -----------------------------------------------------------------------
-- Public: floating window
-- -----------------------------------------------------------------------

-- Opens `filepath` in a centred, rounded-border floating window.
-- Syncs file → buffer on open, buffer → file on WinClosed.
-- opts: { title, width, height }
function M.open_float(filepath, opts)
  opts = opts or {}

  if vim.fn.filereadable(filepath) == 0 then
    vim.fn.writefile({}, filepath)
  end

  local width    = opts.width  or math.floor(vim.o.columns * 0.6)
  local height   = opts.height or math.floor(vim.o.lines   * 0.4)
  local row, col = float.center(width, height)

  local buf = vim.fn.bufnr(filepath, true)
  vim.bo[buf].buflisted = false
  if vim.fn.bufloaded(buf) == 0 then vim.fn.bufload(buf) end

  -- Sync file content into the buffer, but only when the buffer has no
  -- unsaved edits — otherwise we'd silently clobber the user's in-flight
  -- changes. The WinClosed handler below still writes buffer→file on close.
  if not vim.bo[buf].modified then
    local lines = vim.fn.readfile(filepath)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
    vim.bo[buf].modified = false
  end

  local win = vim.api.nvim_open_win(buf, true, {
    relative  = 'editor',
    width     = width,
    height    = height,
    row       = row,
    col       = col,
    style     = 'minimal',
    border    = 'rounded',
    title     = opts.title or vim.fn.fnamemodify(filepath, ':t'),
    title_pos = 'center',
  })

  -- Write buffer back to file when the float closes. Gated on `modified`:
  -- peek-and-close (no edits) skips disk. Dual of the read gate at line 68.
  vim.api.nvim_create_autocmd('WinClosed', {
    pattern  = tostring(win),
    once     = true,
    callback = function()
      if vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].modified then
        local content = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
        vim.fn.writefile(content, filepath)
        vim.bo[buf].modified = false
      end
    end,
  })

  vim.keymap.set('n', 'q',     '<cmd>close<CR>', { buffer = buf, silent = true, nowait = true })
  vim.keymap.set('n', '<Esc>', '<cmd>close<CR>', { buffer = buf, silent = true })

  return win, buf
end

return M
