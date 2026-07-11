-- Runtime attach: single FileType autocmd dispatcher.
--
-- On FileType we look up ev.match in ft_to_lang (built from the registry for
-- installed parsers) and fire vim.treesitter.start() if the language has a
-- parser on disk. Both language.add and start are pcall'd — missing .so or
-- ABI mismatch yields silent skip (no highlighting) rather than a crash.
--
-- Pattern is `*` deliberately: hot-install a new language and we want new
-- buffers of its filetype to auto-attach without re-registering the autocmd.
-- Cost of firing on every FileType event: one hashmap lookup + early return,
-- low-µs — negligible vs any per-buffer setup already happening in nvim.
--
-- Also owns the large-file opt-out (migrated from
-- lua/plugins/nvim-treesitter/setup.lua): BufReadPost tears treesitter down
-- for files >100KB. Runs AFTER FileType, so our attach fires first and
-- BufReadPost cleans up for the oversized case.
--
-- Hot-attach: install.lua calls M.attach_open_buffers(lang) after a
-- successful install. We extend ft_to_lang and fire attach for already-open
-- buffers whose filetype now maps — user doesn't have to :e to see
-- highlighting.

local registry = require('treesitter.registry')
local paths = require('treesitter.paths')
local queries = require('treesitter.queries')

local M = {}

local LARGE_FILE = 100 * 1024

-- Module-level; mutated by setup() and attach_open_buffers().
local ft_to_lang = {}

local function attach_buf(buf, lang)
  queries.ensure(lang)
  local ok = pcall(vim.treesitter.language.add, lang, { path = paths.parser_path(lang) })
  if not ok then return end
  pcall(vim.treesitter.start, buf, lang)
end

-- Register filetype aliases (e.g. bash parser serves sh filetype). Idempotent.
local function register_aliases(lang)
  local entry = registry.get(lang)
  if not entry or not entry.filetypes then return end
  for _, ft in ipairs(entry.filetypes) do
    pcall(vim.treesitter.language.register, lang, ft)
  end
end

function M.setup(installed_langs)
  ft_to_lang = registry.filetype_map(installed_langs)
  for _, lang in ipairs(installed_langs) do
    register_aliases(lang)
  end

  vim.api.nvim_create_autocmd('FileType', {
    pattern = '*',
    callback = function(ev)
      local lang = ft_to_lang[ev.match]
      if not lang then return end
      -- Skip oversize files up front so we don't pay queries.ensure +
      -- language.add + vim.treesitter.start only to tear it all down in the
      -- BufReadPost hook below.
      local name = vim.api.nvim_buf_get_name(ev.buf)
      if name ~= '' then
        local ok, stats = pcall(vim.uv.fs_stat, name)
        if ok and stats and stats.size > LARGE_FILE then return end
      end
      attach_buf(ev.buf, lang)
    end,
    desc = 'treesitter: start parser for installed language (skipped on >100KB files)',
  })

  -- Safety net for the rare case where a named buffer's on-disk size grew
  -- past the threshold between FileType (when we decided to attach) and
  -- BufReadPost. Gated on the active highlighter so the fs_stat syscall
  -- only lands on buffers that actually have treesitter attached — without
  -- this gate we'd pay it on every BufReadPost, and the FileType handler
  -- above already covers the common case for named buffers.
  vim.api.nvim_create_autocmd('BufReadPost', {
    callback = function(ev)
      if not (vim.treesitter.highlighter.active or {})[ev.buf] then return end
      local name = vim.api.nvim_buf_get_name(ev.buf)
      if name == '' then return end
      local ok, stats = pcall(vim.uv.fs_stat, name)
      if ok and stats and stats.size > LARGE_FILE then
        pcall(vim.treesitter.stop, ev.buf)
      end
    end,
    desc = 'treesitter: disable for files >100KB (grew since FileType)',
  })
end

function M.attach_open_buffers(lang)
  local entry = registry.get(lang)
  if not entry or not entry.filetypes then return end

  for _, ft in ipairs(entry.filetypes) do
    ft_to_lang[ft] = lang
  end
  register_aliases(lang)

  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) then
      local ft = vim.bo[buf].filetype
      if ft and ft_to_lang[ft] == lang then
        attach_buf(buf, lang)
      end
    end
  end
end

-- Drop ft→lang mappings so FileType events stop firing attach for a
-- language whose .so no longer exists. Already-attached buffers keep their
-- open parser handle; new buffers of the same ft won't re-attach.
function M.detach_for_lang(lang)
  local entry = registry.get(lang)
  if not entry or not entry.filetypes then return end
  for _, ft in ipairs(entry.filetypes) do
    if ft_to_lang[ft] == lang then ft_to_lang[ft] = nil end
  end
end

return M
