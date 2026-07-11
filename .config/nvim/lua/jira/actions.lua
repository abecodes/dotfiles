local client = require('jira.client')
local config = require('jira.config')
local log    = require('logger')

local M = {}

-- Pre-flight so `M.start` bails before any remote mutation when the caller's
-- cwd isn't a git worktree (e.g. `origin_cwd` fell back to `vim.fn.getcwd()`
-- from a scratch/picker buffer in a non-repo dir). Without this we'd assign
-- and transition in Jira, then fail at `git checkout -b` with a partial state.
local function verify_worktree(cwd, cb)
  vim.system({ 'git', 'rev-parse', '--is-inside-work-tree' }, {
    text = true,
    cwd  = cwd,
  }, function(res)
    vim.schedule(function()
      if res.code ~= 0 then
        cb('not inside a git worktree: ' .. cwd)
      else
        cb(nil)
      end
    end)
  end)
end

local function ensure_me(cb)
  local id = config.get_my_account_id()
  if id then cb(nil, id); return end
  client.myself(function(err, me)
    if err or not me then cb(err or 'empty response to /myself', nil); return end
    config.set_my_account_id(me.accountId)
    cb(nil, me.accountId)
  end)
end

local function find_transition(transitions, name)
  local target = (name or ''):lower()
  if target == '' then return nil end
  for _, t in ipairs(transitions) do
    if (t.name or ''):lower() == target then return t end
  end
  return nil
end

-- Locale-independent: Jira's status category 'indeterminate' is the universal
-- bucket for in-progress states. Workflows can have several (In Progress, In
-- Review, In Testing, …); Jira returns transitions in workflow definition
-- order, so the first one is almost always the canonical "start work" step.
-- If that's wrong for a workflow, set `in_progress = '<exact name>'` in setup.
local function find_in_progress_by_category(transitions)
  for _, t in ipairs(transitions) do
    if t.to and t.to.statusCategory and t.to.statusCategory.key == 'indeterminate' then
      return t
    end
  end
  return nil
end

-- Loose subset of `git check-ref-format` — stops accidents from interactive
-- input (e.g. '--help' parsed as a git flag, whitespace, reserved chars).
local FORBIDDEN_BRANCH_CHARS = { '~', '^', ':', '?', '*', '[', '\\' }
local function invalid_branch_reason(name)
  if name:sub(1, 1) == '-' then return 'starts with -' end
  if name:find('%s') or name:find('%c') then return 'has whitespace or control chars' end
  if name:find('..', 1, true) then return 'contains ".."' end
  for _, ch in ipairs(FORBIDDEN_BRANCH_CHARS) do
    if name:find(ch, 1, true) then return 'contains "' .. ch .. '"' end
  end
  if name:find('@{', 1, true) then return 'contains "@{"' end
  local last = name:sub(-1)
  if last == '/' or last == '.' then return 'ends with "' .. last .. '"' end
  if name:sub(-5) == '.lock' then return 'ends with ".lock"' end
  return nil
end

local function pick_transition(transitions, cb)
  if #transitions == 0 then cb('no transitions available', nil); return end
  vim.ui.select(transitions, {
    prompt      = 'Transition',
    format_item = function(t) return t.name end,
  }, function(choice)
    if not choice then cb('cancelled', nil); return end
    cb(nil, choice)
  end)
end

local function refresh(key, cb)
  client.get_issue(key, cb)
end

M.priority = function(issue, cb)
  client.get_priorities(function(err, priorities)
    if err then cb(err, nil); return end
    if type(priorities) ~= 'table' or #priorities == 0 then
      cb('no priorities available', nil); return
    end
    vim.ui.select(priorities, {
      prompt      = 'Priority',
      format_item = function(p) return p.name end,
    }, function(chosen)
      if not chosen then cb('cancelled', nil); return end
      client.set_priority(issue.key, chosen.id, function(err2)
        if err2 then cb(err2, nil); return end
        refresh(issue.key, cb)
      end)
    end)
  end)
end

M.transition = function(issue, cb)
  client.get_transitions(issue.key, function(err, transitions)
    if err then cb(err, nil); return end
    pick_transition(transitions, function(err2, chosen)
      if err2 then cb(err2, nil); return end
      client.do_transition(issue.key, chosen.id, function(err3)
        if err3 then cb(err3, nil); return end
        refresh(issue.key, cb)
      end)
    end)
  end)
end

M.comment = function(issue, cb)
  require('ui.textarea')({
    prompt   = 'Comment on ' .. issue.key,
    filetype = 'markdown',
  }, function(text)
    if not text or text == '' then cb('cancelled', nil); return end
    client.add_comment(issue.key, text, function(err)
      if err then cb(err, nil); return end
      refresh(issue.key, cb)
    end)
  end)
end

M.assign = function(issue, cb)
  require('ui.live_select')({
    prompt      = 'Assignee',
    min_chars   = 2,
    format_item = function(u)
      return ('%s (%s)'):format(u.displayName or '?', u.emailAddress or '')
    end,
    fetch = function(query, items_cb)
      client.search_assignable(issue.key, query, function(err, users)
        if err then log.warn('jira: ' .. err); items_cb({}); return end
        items_cb(users or {})
      end)
    end,
  }, function(chosen)
    if not chosen then cb('cancelled', nil); return end
    client.assign(issue.key, chosen.accountId, function(err)
      if err then cb(err, nil); return end
      refresh(issue.key, cb)
    end)
  end)
end

-- The `start` flow mutates remote state step-by-step with no rollback. If a
-- later step fails, the user needs to know which earlier steps already ran —
-- otherwise Jira and the local working copy silently drift out of sync.
-- `stitch` prefixes each error with the highest step that completed before
-- it: "" → "assigned but " → "transitioned but ".
local function stitch(progress, body)
  if progress.transitioned then return 'transitioned but ' .. body end
  if progress.assigned     then return 'assigned but '     .. body end
  return body
end

-- Called after the transition succeeded but a later local-only step failed
-- (user cancelled the branch prompt, typed an invalid name, or git refused).
-- The remote (Jira) state is already progressed, so we still refresh the
-- issue so the preview/picker reflect reality, and surface the wart via a
-- warning rather than failing the whole flow.
local function partial_success(body, issue, cb)
  log.warn('jira: start — ' .. body)
  refresh(issue.key, cb)
end

local function do_checkout(issue, branch, cwd, progress, cb)
  vim.system({ 'git', 'checkout', '-b', branch }, {
    text = true,
    cwd  = cwd,
  }, function(res)
    vim.schedule(function()
      if res.code ~= 0 then
        local msg = (res.stderr and res.stderr ~= '') and res.stderr or ('git exit ' .. res.code)
        partial_success(stitch(progress, 'git checkout failed: ' .. msg), issue, cb)
        return
      end
      log.info('jira: branch ' .. branch .. ' created')
      refresh(issue.key, cb)
    end)
  end)
end

local function prompt_branch(issue, cwd, progress, cb)
  vim.ui.input({
    prompt  = 'Branch',
    default = 'feature/' .. issue.key .. '_',
  }, function(branch)
    if not branch or branch == '' then
      partial_success(stitch(progress, 'no branch created (cancelled)'), issue, cb)
      return
    end
    local bad = invalid_branch_reason(branch)
    if bad then
      partial_success(stitch(progress, 'invalid branch name (' .. bad .. ')'), issue, cb)
      return
    end
    do_checkout(issue, branch, cwd, progress, cb)
  end)
end

local function apply_transition(issue, target, cwd, progress, cb)
  client.do_transition(issue.key, target.id, function(err)
    if err then
      cb(stitch(progress, 'transition failed: ' .. tostring(err)), nil)
      return
    end
    progress.transitioned = true
    prompt_branch(issue, cwd, progress, cb)
  end)
end

local function choose_and_transition(issue, transitions, cwd, progress, cb)
  local cfg = config.get()
  local target = (cfg and find_transition(transitions, cfg.in_progress))
    or find_in_progress_by_category(transitions)
  if target then
    apply_transition(issue, target, cwd, progress, cb)
    return
  end
  pick_transition(transitions, function(err, chosen)
    if err then cb(stitch(progress, 'transition pick failed: ' .. tostring(err)), nil); return end
    apply_transition(issue, chosen, cwd, progress, cb)
  end)
end

local function fetch_and_transition(issue, cwd, progress, cb)
  client.get_transitions(issue.key, function(err, transitions)
    if err then
      cb(stitch(progress, 'transition lookup failed: ' .. tostring(err)), nil)
      return
    end
    choose_and_transition(issue, transitions, cwd, progress, cb)
  end)
end

M.start = function(issue, cwd, cb)
  verify_worktree(cwd, function(wt_err)
    if wt_err then cb(wt_err, nil); return end

    ensure_me(function(err, me)
      if err then cb(err, nil); return end

      local current_assignee = issue.fields and issue.fields.assignee and issue.fields.assignee.accountId
      local progress = { assigned = false, transitioned = false }

      if current_assignee == me then
        fetch_and_transition(issue, cwd, progress, cb)
        return
      end

      client.assign(issue.key, me, function(err_assign)
        if err_assign then
          -- Original code prefixed assign-failure errors with "assigned but …";
          -- that was a bug — assign didn't succeed. Report bare.
          cb('assign failed: ' .. tostring(err_assign), nil)
          return
        end
        progress.assigned = true
        fetch_and_transition(issue, cwd, progress, cb)
      end)
    end)
  end)
end

return M
