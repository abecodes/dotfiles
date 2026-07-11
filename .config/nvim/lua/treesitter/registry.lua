-- Loader + typed access for `registry.json`.
--
-- Source of truth: `neovim-treesitter/treesitter-parser-registry` (community
-- successor to the archived nvim-treesitter). The file `registry.json` is a
-- verbatim copy pinned to a specific upstream commit — do not hand-edit.
--
-- Pinned upstream commit: 6eb15358bb9fc88f0d3401d8538d56652e9bdf3c
-- Update via: `:TSVerifySources` to see what drifted, then re-download the
-- raw file at a new SHA and bump PINNED_COMMIT below.
--
-- Registry entry shape (per upstream schema):
--   <lang>.filetypes              = { 'foo', 'bar', ... }
--   <lang>.requires               = { 'dep-lang', ... }              -- optional
--   <lang>.source.type            = 'external_queries' | 'queries_only'
--   <lang>.source.parser_url      = 'https://...'                    -- external_queries
--   <lang>.source.parser_location = 'subdir/path'                    -- optional
--   <lang>.source.parser_semver   = true | false                     -- tag vs HEAD
--   <lang>.source.queries_url     = 'https://...'                    -- external_queries
--   <lang>.source.queries_semver  = true | false
--   <lang>.source.url             = 'https://...'                    -- queries_only
--   <lang>.source.semver          = true | false                     -- queries_only

local fsutil = require('treesitter.fsutil')

local M = {}

local PINNED_COMMIT = '6eb15358bb9fc88f0d3401d8538d56652e9bdf3c'

local function registry_path()
  local src = debug.getinfo(1, 'S').source:sub(2)
  return vim.fn.fnamemodify(src, ':h') .. '/registry.json'
end

local cache

local function load()
  if cache then return cache end
  local text = fsutil.read_text(registry_path())
  if not text then
    error('[treesitter] failed to read registry.json')
  end
  local ok, data = pcall(vim.json.decode, text)
  if not ok then
    error('[treesitter] failed to parse registry.json: ' .. tostring(data))
  end
  cache = data
  return cache
end

function M.get(lang)
  local data = load()
  local entry = data[lang]
  -- Skip meta keys like "$schema"
  if type(entry) ~= 'table' then return nil end
  return entry
end

function M.exists(lang)
  return M.get(lang) ~= nil
end

-- Sorted language keys (non-meta), memoized. Registry JSON is pinned and
-- never mutated at runtime, so invalidation is never needed.
local _sorted

local function sorted_langs()
  if _sorted then return _sorted end
  local data = load()
  local langs = {}
  for k, v in pairs(data) do
    if k:sub(1, 1) ~= '$' and type(v) == 'table' then
      table.insert(langs, k)
    end
  end
  table.sort(langs)
  _sorted = langs
  return _sorted
end

-- Iterator over (i, lang) for every language key (non-meta) in the registry.
function M.iter()
  return ipairs(sorted_langs())
end

-- Build { [ft] = lang } for a given list of installed langs. Callers filter
-- down to the ones they care about so the map only covers active parsers.
function M.filetype_map(langs)
  local map = {}
  for _, lang in ipairs(langs) do
    local entry = M.get(lang)
    if entry and entry.filetypes then
      for _, ft in ipairs(entry.filetypes) do
        map[ft] = lang
      end
    end
  end
  return map
end

-- Topo-ordered list: returns `requires`-chain first, lang itself last.
-- Registry shouldn't contain cycles; unknown language -> error.
function M.resolve_deps(lang)
  local visited = {}
  local result = {}
  local function visit(l)
    if visited[l] then return end
    visited[l] = true
    local entry = M.get(l)
    if not entry then
      error('[treesitter] unknown language in registry: ' .. l)
    end
    if entry.requires then
      for _, dep in ipairs(entry.requires) do
        visit(dep)
      end
    end
    table.insert(result, l)
  end
  visit(lang)
  return result
end

function M.pinned_commit()
  return PINNED_COMMIT
end

return M
