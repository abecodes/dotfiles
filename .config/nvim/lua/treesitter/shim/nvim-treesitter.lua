-- Shim for `require('nvim-treesitter')`.
--
-- Activated via `package.preload` registration in lua/treesitter/init.lua.
-- Filename (`nvim-treesitter.lua`) is the module name that gets registered —
-- drop another file here (e.g. `some-successor.lua`) to shim a future
-- successor plugin without touching init.lua.
--
-- Contract we expose (mirrors the archived nvim-treesitter `main`-branch
-- public API):
--   setup(opts)            -- accepted but ignored; our backend self-initializes
--   get_available()        -- list of registry languages
--   get_installed()        -- list of installed parsers
--   install(langs, opts)   -- triggers backend install (async)
--   uninstall(langs, opts) -- triggers backend uninstall
--   update(langs, opts)    -- triggers backend update
--   indentexpr()           -- stub: returns 0 (nvim falls back to default indent)
--
-- DELIBERATELY OMITTED: `define_modules`. Consumer plugins
-- (nvim-ts-context-commentstring/plugin/ts_context_commentstring.lua:17,
-- nvim-ts-autotag/lua/nvim-ts-autotag.lua:8) check for its presence and
-- early-return when absent. That early-return is the correct behavior with
-- modern setup flows — those plugins have their own `setup()` to use
-- instead of the legacy module-registration API.
--
-- Submodule shims (in shim/nvim-treesitter/):
--   ts_utils.lua  — node-at-cursor, node text/range, sibling navigation,
--                   goto_node. Thin wrappers over vim.treesitter.*.
--   locals.lua    — get_definitions, get_scopes, containing_scope,
--                   get_definitions_lookup_table.
--   utils.lua     — get_at_path(tbl, 'a.b.c') helper.
--   parsers.lua   — get_buf_lang, has_parser, list, ft_to_lang,
--                   get_parser_configs.
--   query.lua     — has_highlights/has_folds/has_indents/has_injections/
--                   has_locals, get_query.
--   configs.lua   — legacy module-registration API; setup/get_module/
--                   is_enabled all no-op so legacy code paths don't crash.
--   health.lua    — :checkhealth nvim-treesitter entry point; forwards to
--                   treesitter.validate.health().
-- Add more by dropping new files here; init.lua's recursive preload walker
-- registers them automatically on next startup.
--
-- ───────────────────────────────────────────────────────────────────────
-- Deliberately NOT shimmed (Tier 3):
--
--   nvim-treesitter.indent — get_indent(lnum) for tree-sitter-driven
--     indentexpr. Real work (~150-250 lines walking indents.scm captures).
--     Not needed because no consumer in this config sets
--     `indentexpr=v:lua.require'nvim-treesitter.indent'.get_indent(v:lnum)`.
--     indent-blankline uses vim.treesitter.* directly, not this module.
--
--   nvim-treesitter.async — 736-line coroutine runtime (semaphores, queues,
--     work stealing). Almost never imported directly by plugins (it was
--     internal to nvim-treesitter itself). If a plugin does import it,
--     matching the exact semantics is a fool's errand — a minimal vim.uv-
--     backed shim might satisfy common primitives but won't be a drop-in.
--
--   nvim-treesitter.log — info/warn/error/debug logging. If consumed, a
--     ~15-line passthrough to `logger` would cover it. Skipped pending a
--     real consumer.
--
--   nvim-treesitter.util (lowercase — NOT `utils`) — small internal helpers.
--     ~20 lines to reimplement if needed.
--
--   nvim-treesitter._meta.parsers — LuaLS type annotations; non-runtime.
--     Return-an-empty-table shim is the most meaningful thing to do. Skipped.
--
--   Legacy module system (`define_modules`, `attach_module`, `detach_module`)
--     — deliberately absent, NOT a Tier 3 omission. Its absence is the
--     correct signal to consumer plugins (ts-context-commentstring,
--     ts-autotag) that they should use their own setup() instead.
-- ───────────────────────────────────────────────────────────────────────

local install = require('treesitter.install')
local registry = require('treesitter.registry')
local log = require('logger')

local M = {}

-- with_sync was a legacy nvim-treesitter flag for blocking installs.
-- Our backend is async-only; warn once per fn so a future caller
-- expecting sync semantics gets a log trail instead of a silent race.
local warned = {}
local function warn_sync(fn_name, opts)
  if opts and opts.with_sync and not warned[fn_name] then
    warned[fn_name] = true
    log.warn(('[treesitter-shim] %s(with_sync=true) runs async in this shim; caller may race'):format(fn_name))
  end
end

function M.setup(_opts)
  -- No-op. Backend initializes from top-level require('treesitter').
end

function M.get_available()
  local out = {}
  for _, l in registry.iter() do
    table.insert(out, l)
  end
  return out
end

function M.get_installed()
  return install.list_installed()
end

function M.install(langs, opts)
  if type(langs) == 'string' then langs = { langs } end
  warn_sync('install', opts)
  install.install(langs)
end

function M.uninstall(langs, opts)
  if type(langs) == 'string' then langs = { langs } end
  warn_sync('uninstall', opts)
  install.uninstall(langs)
end

function M.update(langs, opts)
  if type(langs) == 'string' then langs = { langs } end
  warn_sync('update', opts)
  install.update(langs)
end

function M.indentexpr()
  return 0
end

return M
