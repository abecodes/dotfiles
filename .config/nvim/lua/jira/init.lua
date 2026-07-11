local config   = require('jira.config')
local client   = require('jira.client')
local ui       = require('jira.ui')
local log      = require('logger')
local cmd_util = require('utils.cmd')

local M = {}

local CUSTOM_LABEL = '<custom JQL…>'

local last_jql
local last_issues
local request_seq = 0

local open_picker
local run_jql

-- Capture where the user invoked the command from BEFORE any jira UI takes
-- over the current window. `vim.fn.getcwd()` resolves against whatever
-- window is current at call time — once the picker/float opens, that's the
-- jira UI, which inherits the global cwd (potentially a different repo than
-- the buffer the user is actually working in).
local function origin_cwd()
  local bufname = vim.api.nvim_buf_get_name(0)
  if bufname ~= '' then
    local dir = vim.fn.fnamemodify(bufname, ':p:h')
    if vim.fn.isdirectory(dir) == 1 then return dir end
  end
  return vim.fn.getcwd()
end

local function on_back(cwd)
  return function(dirty)
    if dirty then
      run_jql(last_jql, cwd)
    elseif last_issues then
      open_picker(last_issues, cwd)
    end
  end
end

open_picker = function(issues, cwd)
  local tele = require('jira.telescope')
  local on_choice  = function(issue) ui.preview(issue, on_back(cwd), cwd) end
  local on_refresh = function() if last_jql then run_jql(last_jql, cwd) end end
  if tele.is_available() then
    tele.pick_issue(issues, on_choice, on_refresh)
  else
    ui.pick_issue(issues, on_choice, on_refresh)
  end
end

run_jql = function(jql, cwd)
  last_jql = jql
  request_seq = request_seq + 1
  local my_seq = request_seq
  local close_loading = require('ui.loading').show('Jira: loading…')
  local closed = false
  local function close_once()
    if closed then return end
    closed = true
    close_loading()
  end
  client.search(jql, function(err, issues)
    if my_seq ~= request_seq then
      close_once()
      return
    end
    close_once()
    if err then
      log.error('jira: ' .. err)
      return
    end
    last_issues = issues
    open_picker(issues, cwd)
  end)
end

local function prompt_custom_jql(cwd)
  vim.ui.input({ prompt = 'JQL' }, function(value)
    if not value or value == '' then return end
    run_jql(value, cwd)
  end)
end

M.list = function(filter_name)
  local cfg = config.get()
  if not cfg then return end

  local cwd = origin_cwd()

  if filter_name and filter_name ~= '' then
    local jql = cfg.filters[filter_name]
    if not jql then
      log.error(('jira: no filter named %q'):format(filter_name))
      return
    end
    run_jql(jql, cwd)
    return
  end

  local names = vim.tbl_keys(cfg.filters or {})
  table.sort(names)
  table.insert(names, CUSTOM_LABEL)

  vim.ui.select(names, { prompt = 'Jira filter' }, function(choice)
    if not choice then return end
    if choice == CUSTOM_LABEL then
      prompt_custom_jql(cwd)
      return
    end
    run_jql(cfg.filters[choice], cwd)
  end)
end

M.open = function(key)
  if not key or not key:match('^[A-Z][A-Z0-9_]*%-[0-9]+$') then
    log.error('jira: :JiraOpen requires a valid issue key (e.g. ABC-123)')
    return
  end
  local cwd = origin_cwd()
  client.get_issue(key, function(err, issue)
    if err then
      log.error('jira: ' .. err)
      return
    end
    ui.preview(issue, nil, cwd)
  end)
end

local commands_registered = false
local function register_commands()
  if commands_registered then return end
  commands_registered = true

  cmd_util.new_cmd('JiraList', function(cmd)
    M.list(cmd.args)
  end, {
    nargs    = '?',
    complete = function()
      local cfg = config.get()
      if not cfg then return {} end
      local names = vim.tbl_keys(cfg.filters or {})
      table.sort(names)
      return names
    end,
  })

  cmd_util.new_cmd('JiraOpen', function(cmd)
    M.open(cmd.args)
  end, { nargs = 1 })
end

M.setup = function(opts)
  if not config.set(opts) then return end
  register_commands()
end

return M
