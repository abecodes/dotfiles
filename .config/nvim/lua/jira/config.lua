local log = require('logger')
local str = require('utils.str')

local M = {}

local state = nil

local defaults = {
  token_env   = 'JIRA_TOKEN',
  max_results = 50,
  -- Default fields for the picker (search). `comment` is intentionally excluded
  -- here because comments are by far the heaviest payload; they're loaded
  -- lazily by `client.get_issue` only when the full preview opens.
  fields      = { 'summary', 'status', 'assignee', 'description', 'issuetype', 'priority', 'reporter' },
  filters     = {},
  in_progress = nil,  -- optional override; nil = auto-detect via statusCategory.key == 'indeterminate'
}

local my_account_id = nil

M.set = function(opts)
  opts = opts or {}

  if type(opts.base_url) ~= 'string' or opts.base_url == '' then
    log.error('jira: setup requires base_url (e.g. https://acme.atlassian.net)')
    return false
  end
  if type(opts.email) ~= 'string' or opts.email == '' then
    log.error('jira: setup requires email')
    return false
  end

  local merged = vim.tbl_deep_extend('force', {}, defaults, opts)
  merged.base_url = str.trim_trailing_slash(merged.base_url)

  state = merged
  my_account_id = nil
  return true
end

M.get = function()
  if not state then
    log.error('jira: not configured; call require("jira").setup({...}) first')
    return nil
  end
  return state
end

M.set_my_account_id = function(id)
  my_account_id = id
end

M.get_my_account_id = function()
  return my_account_id
end

M.auth_header = function()
  local cfg = M.get()
  if not cfg then return nil end

  local token = vim.env[cfg.token_env]
  if not token or token == '' then
    log.error(('jira: env var $%s is empty'):format(cfg.token_env))
    return nil
  end

  return 'Basic ' .. vim.base64.encode(cfg.email .. ':' .. token)
end

return M
