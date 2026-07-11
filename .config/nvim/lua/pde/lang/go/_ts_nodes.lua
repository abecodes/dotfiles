-- shameless plug of https://github.com/olexsmir/gopher.nvim/blob/main/lua/gopher/_utils/ts/nodes.lua
-- Go-specific treesitter node helpers. Query captures "declaration"/"clause"
-- are hard-coded to match the queries in impl.lua / tests.lua — not a generic
-- utility. Callers handle nil returns with their own logging; this module
-- stays logger-free.

local M = {}

local function intersects(row, col, sRow, sCol, eRow, eCol)
  if sRow > row or eRow < row then
    return false
  end

  if sRow == row and sCol > col then
    return false
  end

  if eRow == row and eCol < col then
    return false
  end

  return true
end

local function count_parents(result_node)
  local count = 0
  local n = result_node.declaring_node
  while n do
    n = n:parent()
    count = count + 1
  end
  return count
end

---@param nodes table
---@param row integer
---@param col integer
---@return table
function M.intersect_nodes(nodes, row, col)
  local found = {}
  for idx = 1, #nodes do
    local node = nodes[idx]
    local sRow = node.dim.s.r
    local sCol = node.dim.s.c
    local eRow = node.dim.e.r
    local eCol = node.dim.e.c

    if intersects(row, col, sRow, sCol, eRow, eCol) then
      table.insert(found, node)
    end
  end

  return found
end

---@param nodes table
---@return table
function M.sort_nodes(nodes)
  table.sort(nodes, function(a, b)
    return count_parents(a) < count_parents(b)
  end)

  return nodes
end

---@param query string
---@param lang string
---@param bufnr integer
---@param pos_row integer
---@param _pos_col integer
---@return table|nil
function M.get_all_nodes(query, lang, bufnr, pos_row, _pos_col)
  bufnr = bufnr or 0
  pos_row = pos_row or 30000

  local ok, parsed_query = pcall(vim.treesitter.query.parse, lang, query)
  if not ok then
    return nil
  end

  local ok2, parser = pcall(vim.treesitter.get_parser, bufnr, lang)
  if not ok2 or not parser then
    return nil
  end

  local tree = parser:parse()[1]
  if not tree then return nil end
  local root = tree:root()
  local start_row, _, end_row, _ = root:range()
  local results = {}

  for _, match, _ in parsed_query:iter_matches(root, bufnr, start_row, end_row, { all = true }) do
    local sRow, sCol, eRow, eCol, declaration_node
    local kind, name, op = "", "", ""

    for id, nodes in pairs(match) do
      local cap_name = parsed_query.captures[id]
      local idx = string.find(cap_name, ".[^.]*$")
      op   = string.sub(cap_name, idx + 1, #cap_name)
      kind = string.sub(cap_name, 1, idx - 1)

      for _, node in ipairs(nodes) do
        if op == "name" then
          name = vim.treesitter.get_node_text(node, bufnr)
        elseif op == "declaration" or op == "clause" then
          declaration_node = node
          sRow, sCol, eRow, eCol = node:range()
          sRow = sRow + 1
          eRow = eRow + 1
          sCol = sCol + 1
          eCol = eCol + 1
        end
      end
    end

    if declaration_node ~= nil then
      table.insert(results, {
        declaring_node = declaration_node,
        dim = { s = { r = sRow, c = sCol }, e = { r = eRow, c = eCol } },
        name = name,
        operator = op,
        type = kind,
      })
    end
  end

  return results
end

---@param query string
---@param bufnr integer|nil
---@param row integer
---@param col integer
---@return table|nil
function M.nodes_at_cursor(query, bufnr, row, col)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  local ft = vim.bo[bufnr].filetype
  if row == nil or col == nil then
    row, col = unpack(vim.api.nvim_win_get_cursor(0))
  end

  local nodes = M.get_all_nodes(query, ft, bufnr, row, col)
  if nodes == nil then
    return nil
  end

  nodes = M.sort_nodes(M.intersect_nodes(nodes, row, col))
  if nodes == nil or #nodes == 0 then
    return nil
  end

  return nodes
end

return M
