-- Shim for `require('nvim-treesitter.query')`.
--
-- Covers functions telescope-dap and other common consumers call:
--   has_highlights / has_folds / has_indents / has_injections / has_locals
--   get_query(lang, query_name)
--
-- All `has_*` accessors return true iff a query of that name is registered
-- via vim.treesitter.query.set() — which we do in queries.lua after install.

local M = {}

local function has(lang, name)
  if not lang or lang == '' then return false end
  return vim.treesitter.query.get(lang, name) ~= nil
end

function M.has_highlights(lang) return has(lang, 'highlights') end
function M.has_folds(lang)      return has(lang, 'folds')      end
function M.has_indents(lang)    return has(lang, 'indents')    end
function M.has_injections(lang) return has(lang, 'injections') end
function M.has_locals(lang)     return has(lang, 'locals')     end

function M.get_query(lang, query_name)
  if not lang or lang == '' then return nil end
  return vim.treesitter.query.get(lang, query_name)
end

return M
