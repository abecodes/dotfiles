-- Shim for `require('nvim-treesitter.ts_utils')`.
--
-- The most-imported legacy utility module across the treesitter plugin
-- ecosystem. All functions here are thin wrappers around nvim core's
-- `vim.treesitter.*` API.
--
-- Not a complete port. Covers the functions that ~90% of third-party
-- plugins call. If a plugin needs something missing here, add it — each
-- function is 5-15 lines and delegates to nvim core.

local log = require('logger')

local M = {}

-- Parent-hopping args are legacy nvim-treesitter behavior we don't
-- emulate. Warn once per function so a caller passing them gets a signal
-- instead of silent immediate-sibling semantics.
local legacy_warned = {}
local function warn_legacy_args(fn_name, allow_switch_parents, allow_next_parent)
  if (allow_switch_parents or allow_next_parent) and not legacy_warned[fn_name] then
    legacy_warned[fn_name] = true
    log.warn(('[treesitter-shim] ts_utils.%s: parent-hopping args ignored — immediate-sibling only'):format(fn_name))
  end
end

-- Smallest named node at the cursor in `winnr` (0 / nil = current window).
function M.get_node_at_cursor(winnr)
  local win = (winnr == nil or winnr == 0) and vim.api.nvim_get_current_win() or winnr
  local buf = vim.api.nvim_win_get_buf(win)
  local cursor = vim.api.nvim_win_get_cursor(win)
  return vim.treesitter.get_node({
    bufnr = buf,
    pos = { cursor[1] - 1, cursor[2] },
  })
end

-- Returns node text as a list of lines (legacy semantics). nvim core's
-- `get_node_text` returns a single string in newer versions, so we split.
function M.get_node_text(node, bufnr)
  if not node then return {} end
  local text = vim.treesitter.get_node_text(node, bufnr or 0)
  if type(text) == 'string' then
    return vim.split(text, '\n', { plain = true })
  end
  return text or {}
end

function M.get_node_range(node)
  return node:range()
end

function M.is_in_node_range(node, line, col)
  local sr, sc, er, ec = node:range()
  if line < sr or line > er then return false end
  if line == sr and col < sc then return false end
  if line == er and col >= ec then return false end
  return true
end

function M.get_named_children(node)
  local children = {}
  for i = 0, node:named_child_count() - 1 do
    table.insert(children, node:named_child(i))
  end
  return children
end

-- Sibling navigation. Legacy API accepts allow_switch_parents /
-- allow_next_parent flags; this simplified form covers only
-- immediate-sibling cases (the vast majority). If you hit a plugin that
-- relies on parent-hopping, extend here.
function M.get_next_node(node, allow_switch_parents, allow_next_parent)
  warn_legacy_args('get_next_node', allow_switch_parents, allow_next_parent)
  if not node then return nil end
  local parent = node:parent()
  if not parent then return nil end
  for i = 0, parent:named_child_count() - 1 do
    if parent:named_child(i) == node then
      return parent:named_child(i + 1)
    end
  end
  return nil
end

function M.get_previous_node(node, allow_switch_parents, allow_next_parent)
  warn_legacy_args('get_previous_node', allow_switch_parents, allow_next_parent)
  if not node then return nil end
  local parent = node:parent()
  if not parent then return nil end
  for i = parent:named_child_count() - 1, 0, -1 do
    if parent:named_child(i) == node then
      return parent:named_child(i - 1)
    end
  end
  return nil
end

-- Jump cursor to a node's start (or end if `goto_end` is true). Sets jump
-- mark by default.
function M.goto_node(node, goto_end, avoid_set_jump)
  if not node then return end
  if not avoid_set_jump then
    vim.cmd("normal! m'")
  end
  local row, col
  if goto_end then
    row, col = node:end_()
  else
    row, col = node:start()
  end
  vim.api.nvim_win_set_cursor(0, { row + 1, col })
end

return M
