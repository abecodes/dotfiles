-- Startup ABI/query validation probe.
--
-- Neovim's built-in tree-sitter runtime ships a specific ABI; installed .so
-- files compiled against an older ABI fail to load with "ABI version
-- mismatch". We surface this at startup (not in the middle of editing) with
-- a clear recovery hint.
--
-- `:checkhealth treesitter` reports: pinned registry commit, installed
-- parsers, per-parser ABI check, recovery hint if any failed.

local log = require('logger')
local paths = require('treesitter.paths')

local M = {}

-- One parser per event-loop tick. Each vim.treesitter.language.add is a
-- sync C call (dlopen + symbol resolve + metadata read) on the main
-- thread, and with many parsers installed the cold-cache cost (macOS
-- signature check etc.) adds up. By re-scheduling via vim.schedule
-- between parsers we let the event loop service input/redraw between
-- each probe, so the UI stays responsive throughout startup.
function M.probe()
  local langs = paths.installed_parsers()
  local i = 1
  local function step()
    if i > #langs then return end
    local lang = langs[i]
    i = i + 1
    local path = paths.parser_path(lang)
    local ok, err = pcall(vim.treesitter.language.add, lang, { path = path })
    if not ok then
      log.warn(('[treesitter] %s: ABI probe failed — run :TSUpdate %s (error: %s)')
        :format(lang, lang, err))
    end
    vim.schedule(step)
  end
  vim.schedule(step)
end

function M.health()
  local health = vim.health
  local registry = require('treesitter.registry')
  local install = require('treesitter.install')

  health.start('treesitter (in-tree)')
  health.info(('Registry pinned to %s'):format(registry.pinned_commit()))

  local installed = install.list_installed()
  if #installed == 0 then
    health.warn('No parsers installed. Run :TSInstall sync (after populating config.baseline)')
    return
  end
  health.info(('%d parser(s) installed: %s'):format(#installed, table.concat(installed, ', ')))

  local any_fail = false
  for _, lang in ipairs(installed) do
    local path = paths.parser_path(lang)
    local ok, err = pcall(vim.treesitter.language.add, lang, { path = path })
    if ok then
      health.ok(lang .. ': parser loads')
    else
      health.error(lang .. ': ABI probe failed — ' .. tostring(err))
      any_fail = true
    end
  end
  if any_fail then
    health.warn('Recovery: run :TSUpdate to recompile mismatched parsers')
  end
end

return M
