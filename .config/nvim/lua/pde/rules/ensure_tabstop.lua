-- STATUS: DISABLED. Registration in `lua/hooks.lua` is commented out.
--
-- WHY DISABLED
-- Wired on `*` at BufWinEnter this hook forced `noexpandtab tabstop=2` on
-- every buffer regardless of filetype. The problems that causes:
--
--   * YAML — the YAML 1.2 spec forbids tab characters for block-structure
--     indentation. Every mainstream parser (PyYAML, ruamel, go-yaml, k8s
--     client, GitHub Actions, Ansible) rejects tab-indented YAML with a
--     parse error. Forcing noexpandtab means any new indentation typed
--     into a YAML buffer produces files no tool will load.
--   * Python — PEP-8 mandates 4-space. Python 3's tokenizer raises TabError
--     on blocks that mix tabs and spaces. Also: leading whitespace inside
--     triple-quoted strings is part of the string value, so any indent
--     rewriting silently mutates __doc__ / breaks doctests and string
--     equality tests.
--   * JSON — legal with tabs, but prettier / jq / VS Code defaults / most
--     team style configs reformat back to spaces; you fight the tooling in
--     CI forever.
--
-- WHAT EACH OPTION ACTUALLY DOES
--   tabstop     — render width of a literal `\t`. DISPLAY-ONLY; does
--                 nothing to space-indented content.
--   shiftwidth  — columns inserted/removed by `>>`, `<<`, and autoindent.
--                 Usually equal to tabstop.
--   softtabstop — Tab-key behavior in insert mode. -1 = follow shiftwidth;
--                 0 = insert a literal tab; positive N = pretend Tab is N
--                 columns wide even when tabstop differs.
--   expandtab   — when true, Tab inserts spaces (count = softtabstop or
--                 shiftwidth). When false, inserts a real `\t`.
--   smartindent — heuristic C-like autoindent. Obsolete once treesitter
--                 indent is active for the filetype.
--
-- CURRENT APPROACH
-- Global `tabstop=2` and `shiftwidth=2` in `lua/settings.lua` so tab-indented
-- files (Go, Makefiles, this dotfiles repo) render at 2-column indent.
-- `expandtab` is intentionally left to each ftplugin so space-indented
-- languages keep their native on-disk format.
--
-- The function below is kept as reference / in case you want to re-enable it
-- scoped to an allowlist of filetypes you personally own.

local utils = require('utils')

return function()
  if utils.ui_buffer.is_ui_buffer(0) then
    return
  end

  if vim.api.nvim_get_option_value('tabstop', {}) == 2 and
      vim.api.nvim_get_option_value('shiftwidth', {}) == 2 and
      vim.api.nvim_get_option_value('softtabstop', {}) == -1 and
      vim.api.nvim_get_option_value('smartindent', {}) == true and
      vim.api.nvim_get_option_value('expandtab', {}) == false then
    return
  end

  vim.opt_local.tabstop = 2
  vim.opt_local.softtabstop = -1
  vim.opt_local.shiftwidth = 2
  vim.opt_local.smartindent = true
  vim.opt_local.expandtab = false
  -- Intentionally no :retab — existing content keeps its disk-native
  -- whitespace. We set options so *new* typing follows the convention;
  -- mass-converting existing lines on every buffer open makes the buffer
  -- drift from disk on mere view, corrupts DiffOrig / git diffs, and
  -- fights language-native formatters (gofmt, etc.).
  -- if vim.bo.modifiable then
  --   vim.cmd('retab')
  -- end
end
