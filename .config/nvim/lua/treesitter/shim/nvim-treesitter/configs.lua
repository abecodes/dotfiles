-- Shim for `require('nvim-treesitter.configs')`.
--
-- Legacy module-registration API. Plugins using this path expect a "modules"
-- system where features (highlight, indent, context_commentstring, etc.)
-- register with configs.setup{} and get looked up via configs.get_module(name).
-- Modern setup flows replace this per-plugin; we return safe no-ops so the
-- legacy code paths don't raise.
--
-- Observed consumers that hit this module:
--   - nvim-ts-context-commentstring/lua/.../internal.lua:150 (deprecated M.attach)
--   - nvim-ts-autotag/lua/.../internal.lua:460 (pcall'd, soft)
-- All of them either pcall or gate on get_module() returning nil → our
-- stubs take the correct path through their code.

local M = {}

function M.setup(_opts)
  -- No-op.
end

-- Return nil → "module not configured" → caller falls back to its own path.
function M.get_module(_name)
  return nil
end

function M.is_enabled(_module, _lang, _bufnr)
  return false
end

return M
