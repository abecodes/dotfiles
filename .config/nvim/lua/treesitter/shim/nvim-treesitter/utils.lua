-- Shim for `require('nvim-treesitter.utils')`.
--
-- Only function telescope-dap (this config's lone consumer) calls is
-- `get_at_path(tbl, 'a.b.c')` — a dotted-path lookup into a nested table.
-- Returns nil if any segment is missing or non-table.

local M = {}

function M.get_at_path(tbl, path)
  if not tbl or not path then return nil end
  local node = tbl
  for segment in path:gmatch('[^.]+') do
    if type(node) ~= 'table' then return nil end
    node = node[segment]
  end
  return node
end

return M
