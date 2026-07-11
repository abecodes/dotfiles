-- Shim for `require('nvim-treesitter.locals')`.
--
-- Consumers (telescope-dap, refactor.nvim, navigation plugins):
--   get_definitions(buf)                  -- [{ <kind> = { node } }, ...]
--   get_scopes(buf)                       -- [scope_node, ...]
--   containing_scope(node, buf, allow)    -- enclosing scope node or nil
--   get_definitions_lookup_table(buf)     -- { [scope_id] = { name = info } }
--
-- Return shapes match the legacy nvim-treesitter.locals format so that
-- `utils.get_at_path(d, 'var.node')` style access from consumers works
-- without translation.

local M = {}

-- Parse the buffer's root tree once; returns (tree, lang) or nil on failure.
local function parse_buf(buf)
  local ok, parser = pcall(vim.treesitter.get_parser, buf)
  if not ok or not parser then return nil end
  local trees = parser:parse()
  local tree = trees and trees[1]
  if not tree then return nil end
  return tree, parser:lang()
end

function M.get_definitions(buf)
  local tree, lang = parse_buf(buf)
  if not tree or not lang then return {} end
  local q = vim.treesitter.query.get(lang, 'locals')
  if not q then return {} end

  local results = {}
  for id, node, _ in q:iter_captures(tree:root(), buf) do
    local capture_name = q.captures[id]
    -- Bare @local.definition captures (common in Go/locals.scm) take the
    -- node type as kind, matching legacy nvim-treesitter behavior.
    local kind
    if capture_name == 'local.definition' then
      kind = node:type()
    else
      kind = capture_name:match('^local%.definition%.(.+)$')
    end
    if kind then
      table.insert(results, { [kind] = { node = node } })
    end
  end
  return results
end

function M.get_scopes(buf)
  local tree, lang = parse_buf(buf)
  if not tree or not lang then return {} end
  local q = vim.treesitter.query.get(lang, 'locals')
  if not q then return {} end

  local scopes = {}
  for id, node, _ in q:iter_captures(tree:root(), buf) do
    if q.captures[id] == 'local.scope' then
      table.insert(scopes, node)
    end
  end
  return scopes
end

-- Returns the innermost scope containing `node`, or nil.
-- `allow_scope`: if true and `node` itself is a scope, it counts.
function M.containing_scope(node, bufnr, allow_scope)
  if not node then return nil end
  bufnr = bufnr or vim.api.nvim_get_current_buf()

  local scope_ids = {}
  for _, s in ipairs(M.get_scopes(bufnr)) do
    scope_ids[s:id()] = s
  end

  local current = allow_scope and node or node:parent()
  while current do
    local s = scope_ids[current:id()]
    if s then return s end
    current = current:parent()
  end
  return nil
end

-- `{ [scope_id] = { [name] = definition_info } }`. Each scope id maps to a
-- flat { name → info } table of definitions whose node falls inside it.
function M.get_definitions_lookup_table(buf)
  buf = buf or vim.api.nvim_get_current_buf()
  local scopes = M.get_scopes(buf)
  local scope_ids = {}
  for _, s in ipairs(scopes) do scope_ids[s:id()] = true end

  local function find_enclosing_scope(node)
    local cur = node:parent()
    while cur do
      if scope_ids[cur:id()] then return cur end
      cur = cur:parent()
    end
    return nil
  end

  local out = {}
  for _, s in ipairs(scopes) do out[s:id()] = {} end

  for _, d in ipairs(M.get_definitions(buf)) do
    for _, info in pairs(d) do
      if info.node then
        local scope = find_enclosing_scope(info.node)
        if scope then
          local sid = scope:id()
          out[sid] = out[sid] or {}
          local ok, name = pcall(vim.treesitter.get_node_text, info.node, buf)
          if ok and type(name) == 'string' and name ~= '' then
            out[sid][name] = info
          end
        end
      end
    end
  end
  return out
end

return M
