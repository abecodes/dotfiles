-- Shim for `require('nvim-treesitter.parsers')`.
--
-- Covers functions telescope-dap and other common consumers call:
--   get_buf_lang(buf)        -- tree-sitter language name for a buffer
--   has_parser(lang)         -- parser .so exists on disk
--   list()                   -- all languages in the registry
--   ft_to_lang(ft)           -- inverse filetype lookup
--   get_parser_configs()     -- { [lang] = { install_info = {...}, filetype = ... } }

local paths = require('treesitter.paths')

local M = {}

function M.get_buf_lang(buf)
  -- vim.treesitter.get_parser respects the filetype → lang aliases we
  -- register in attach.lua (e.g. bash parser for sh filetype), so this is
  -- the right entry point — don't re-walk our registry ourselves.
  local ok, parser = pcall(vim.treesitter.get_parser, buf)
  if ok and parser then return parser:lang() end
  return nil
end

function M.has_parser(lang)
  if not lang or lang == '' then return false end
  return paths.exists(paths.parser_path(lang))
end

function M.list()
  local registry = require('treesitter.registry')
  local out = {}
  for _, lang in registry.iter() do
    table.insert(out, lang)
  end
  return out
end

function M.ft_to_lang(ft)
  if not ft or ft == '' then return nil end
  local registry = require('treesitter.registry')
  for _, lang in registry.iter() do
    local entry = registry.get(lang)
    if entry and entry.filetypes then
      for _, f in ipairs(entry.filetypes) do
        if f == ft then return lang end
      end
    end
  end
  return nil
end

-- Approximate the legacy parser_configs shape. Only fields downstream
-- consumers typically read are populated; others are left nil.
function M.get_parser_configs()
  local registry = require('treesitter.registry')
  local out = {}
  for _, lang in registry.iter() do
    local entry = registry.get(lang)
    if entry and entry.source then
      out[lang] = {
        install_info = {
          url      = entry.source.parser_url or entry.source.url,
          location = entry.source.parser_location,
        },
        filetype = (entry.filetypes and entry.filetypes[1]) or lang,
      }
    end
  end
  return out
end

return M
