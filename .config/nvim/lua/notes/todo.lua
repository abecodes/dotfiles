local M = {}
local fw    = require('notes.framework')
local float = require('ui.float')

-- -----------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------

local function filepath(scope)
  return scope == 'branch'
    and fw.get_branch_file('.todo')
    or  fw.get_project_file('.todo')
end

-- mtime-gated cache: WinScrolled-driven sticky re-renders call this on every
-- tick; without the cache, each scroll does a full readfile per scope.
local cache = {} -- path -> { key = <mtime ns>, content = <filtered lines> }

local function read_todos(path)
  local stat = vim.uv.fs_stat(path)
  if not stat then
    cache[path] = nil
    return {}
  end
  local key = stat.mtime.sec * 1e9 + stat.mtime.nsec
  local hit = cache[path]
  if hit and hit.key == key then return hit.content end

  local result = {}
  for _, line in ipairs(vim.fn.readfile(path)) do
    if line ~= '' then table.insert(result, line) end
  end
  cache[path] = { key = key, content = result }
  return result
end

local function write_todos(path, todos)
  vim.fn.writefile(todos, path)
  vim.api.nvim_exec_autocmds('User', { pattern = 'TodoChanged', modeline = false })
end

-- -----------------------------------------------------------------------
-- Public
-- -----------------------------------------------------------------------

-- Returns the first todo string for the given scope, or nil.
function M.get_first(scope)
  return read_todos(filepath(scope))[1]
end

-- Opens a single-line float input; <CR> appends the entry, <Esc>/q discards.
function M.add(scope)
  local path  = filepath(scope)
  local title = scope == 'branch' and ' Branch Todo ' or ' Project Todo '

  local buf      = float.scratch_buf()
  local width    = math.floor(vim.o.columns * 0.5)
  local row, col = float.center(width, 1)

  local win = vim.api.nvim_open_win(buf, true, {
    relative  = 'editor',
    width     = width,
    height    = 1,
    row       = row,
    col       = col,
    style     = 'minimal',
    border    = 'rounded',
    title     = title,
    title_pos = 'center',
  })

  vim.cmd('startinsert')

  local function confirm()
    local line = vim.trim(vim.api.nvim_buf_get_lines(buf, 0, 1, false)[1] or '')
    if line ~= '' then
      local todos = read_todos(path)
      table.insert(todos, line)
      write_todos(path, todos)
    end
    if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end
    if vim.api.nvim_buf_is_valid(buf) then vim.api.nvim_buf_delete(buf, { force = true }) end
    vim.schedule(function() vim.cmd('stopinsert') end)
  end

  local function discard()
    if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end
    if vim.api.nvim_buf_is_valid(buf) then vim.api.nvim_buf_delete(buf, { force = true }) end
    vim.schedule(function() vim.cmd('stopinsert') end)
  end

  vim.keymap.set('i', '<CR>',          confirm, { buffer = buf, silent = true })
  vim.keymap.set({ 'i', 'n' }, '<Esc>', discard, { buffer = buf, silent = true })
  vim.keymap.set('n', 'q',             discard, { buffer = buf, silent = true })
end

-- Removes the first todo from branch todos; falls back to project todos.
function M.delete_current()
  local path  = fw.get_branch_file('.todo')
  local todos = read_todos(path)
  if #todos > 0 then
    table.remove(todos, 1)
    write_todos(path, todos)
    return
  end
  path  = fw.get_project_file('.todo')
  todos = read_todos(path)
  if #todos > 0 then
    table.remove(todos, 1)
    write_todos(path, todos)
  end
end

-- Opens the todo file for the given scope in an editable float.
-- Use dd to delete items; changes save on close.
function M.review(scope)
  local title = scope == 'branch' and ' Branch Todos ' or ' Project Todos '
  fw.open_float(filepath(scope), { title = title, height = 10 })
end

return M
