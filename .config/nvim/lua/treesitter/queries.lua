-- Lazy per-language query registration.
--
-- Called from attach.lua's attach_buf on the first FileType event for a
-- language, and from install.lua after a successful install (M.reload).
--
-- Precedence per language/query-name:
--   1. lua/treesitter/query_overrides/<lang>/<name>.scm    (repo-committed)
--   2. stdpath('data')/treesitter/queries/<lang>/<name>.scm (install artifact)
--
-- Winning file is registered via vim.treesitter.query.set(lang, name, text);
-- nvim core's in-memory query registry takes precedence over rtp-scanned
-- files, so set() wins for consumers calling vim.treesitter.query.get().
-- stdpath('data')/treesitter/queries is NOT on runtimepath, so set() is
-- the only way those files reach the query runtime.
--
-- Standard query names nvim core + consumers recognize: highlights,
-- injections, locals, folds, indents.

local log    = require('logger')
local paths  = require('treesitter.paths')
local fsutil = require('treesitter.fsutil')

local M = {}

local OVERRIDES = vim.fs.joinpath(vim.fn.stdpath('config'), 'lua/treesitter/query_overrides')

local QUERY_NAMES = { 'highlights', 'injections', 'locals', 'folds', 'indents' }

-- [lang] = true once queries registered for that lang. Cleared by reload().
local registered = {}

local function set_one(lang, name)
  local override = vim.fs.joinpath(OVERRIDES, lang, name .. '.scm')
  local fetched  = vim.fs.joinpath(paths.QUERIES_DIR, lang, name .. '.scm')

  local text = fsutil.read_text(override) or fsutil.read_text(fetched)
  if not text then return end

  local ok, err = pcall(vim.treesitter.query.set, lang, name, text)
  if not ok then
    log.warn(('[treesitter] %s/%s: query.set failed: %s'):format(lang, name, err))
  end
end

-- Idempotent. Called before every buffer attach; first call per lang does
-- the file reads, subsequent calls are a hash lookup + early return.
function M.ensure(lang)
  if registered[lang] then return end
  registered[lang] = true
  for _, name in ipairs(QUERY_NAMES) do
    set_one(lang, name)
  end
end

-- Force re-register (post-install, when on-disk .scm files may have changed).
function M.reload(lang)
  registered[lang] = nil
  M.ensure(lang)
end

return M
