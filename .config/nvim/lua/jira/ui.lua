local adf   = require('jira.adf')
local float = require('ui.float')
local str   = require('utils.str')

local M = {}

local function field(issue, path, default)
  local cur = issue.fields
  for _, key in ipairs(path) do
    if type(cur) ~= 'table' then return default end
    cur = cur[key]
  end
  if cur == nil or cur == vim.NIL then return default end
  return cur
end

local function priority_short(name)
  if not name or name == '' or name == 'TBD' then return '?' end
  return name:sub(1, 1)
end

local CAT_DISPLAY = { new = 'new', indeterminate = 'wip', done = 'done' }

M.format_item = function(issue)
  local key      = (issue.key or '?'):sub(1, 9)
  local priority = priority_short(field(issue, { 'priority', 'name' }, nil))
  local cat_key  = field(issue, { 'status', 'statusCategory', 'key' }, '?')
  local cat      = CAT_DISPLAY[cat_key] or cat_key
  local summary  = field(issue, { 'summary' }, '')
  return ('%-9s  %-1s  %-4s  %s'):format(key, priority, cat, summary)
end

local function append_split(lines, text)
  for _, line in ipairs(vim.split(text, '\n', { plain = true })) do
    table.insert(lines, line)
  end
end

M.build_lines = function(issue)
  local lines = {
    '# ' .. (issue.key or '?') .. ' — ' .. field(issue, { 'summary' }, ''),
    '',
    '- Status:   ' .. field(issue, { 'status', 'name' },          '?'),
    '- Type:     ' .. field(issue, { 'issuetype', 'name' },       '?'),
    '- Priority: ' .. field(issue, { 'priority', 'name' },        '?'),
    '- Assignee: ' .. field(issue, { 'assignee', 'displayName' }, 'unassigned'),
    '- Reporter: ' .. field(issue, { 'reporter', 'displayName' }, '?'),
    '',
    '---',
    '',
  }
  append_split(lines, adf.flatten(issue.fields and issue.fields.description or nil))

  local comments = issue.fields and issue.fields.comment and issue.fields.comment.comments or {}
  if #comments > 0 then
    table.insert(lines, '')
    table.insert(lines, '---')
    table.insert(lines, '')
    table.insert(lines, ('## Comments (%d)'):format(#comments))
    for _, c in ipairs(comments) do
      local author  = (c.author and c.author.displayName) or '?'
      local created = str.format_timestamp(c.created)
      table.insert(lines, '')
      table.insert(lines, ('**%s** — %s'):format(author, created))
      table.insert(lines, '')
      append_split(lines, adf.flatten(c.body))
    end
  end

  return lines
end

M.pick_issue = function(issues, on_choice, on_refresh)
  if #issues == 0 then
    vim.notify('jira: no issues matched', vim.log.levels.INFO)
    return
  end

  require('ui.picker')(issues, {
    prompt           = 'Jira',
    format_item      = M.format_item,
    preview          = M.build_lines,
    preview_filetype = 'markdown',
    on_refresh       = on_refresh,
  }, function(choice)
    if choice and on_choice then on_choice(choice) end
  end)
end

local function render_into(buf, lines)
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
end

local function status_category(issue)
  local s = issue.fields and issue.fields.status
  local sc = s and s.statusCategory
  return sc and sc.key
end

local function can_start(issue)
  return status_category(issue) == 'new'
end

local function build_footer(issue)
  local parts = {}
  if can_start(issue) then table.insert(parts, '<s>tart') end
  table.insert(parts, '<t>ransition')
  table.insert(parts, '<a>ssign')
  table.insert(parts, '<c>omment')
  table.insert(parts, '<p>riority')
  table.insert(parts, '<BS>:back')
  return ' ' .. table.concat(parts, '  ') .. ' '
end

local function fit_height(lines)
  return math.min(math.floor(vim.o.lines * 0.7), math.max(#lines, 15))
end

---@param issue table
---@param on_back? fun(dirty: boolean)  invoked from the preview when user wants to return to the picker; receives whether any action mutated the issue
---@param origin_cwd? string  the repo dir the command was invoked from — used by `start` so `git checkout -b` runs there, not in the jira float's inherited cwd
M.preview = function(issue, on_back, origin_cwd)
  local buf   = float.scratch_buf({ buftype = 'nofile', filetype = 'markdown' })
  local lines = M.build_lines(issue)
  render_into(buf, lines)

  local width    = math.min(math.floor(vim.o.columns * 0.7), 120)
  local height   = fit_height(lines)
  local row, col = float.center(width, height)

  local win = vim.api.nvim_open_win(buf, true, {
    relative   = 'editor',
    width      = width,
    height     = height,
    row        = row,
    col        = col,
    style      = 'minimal',
    border     = float.border(),
    title      = ' ' .. (issue.key or 'Jira') .. ' ',
    title_pos  = 'left',
    footer     = build_footer(issue),
    footer_pos = 'left',
  })
  vim.wo[win].wrap       = true
  vim.wo[win].linebreak  = true
  vim.wo[win].cursorline = true

  local state = { issue = issue, dirty = false }

  -- Comments are excluded from the picker's search payload to keep results
  -- light. Lazy-fetch the full issue (which adds `comment`) once the preview
  -- opens, then re-render in place and re-fit the window height — without
  -- the re-fit, long comment threads stay clipped to the original height
  -- that was computed before comments existed.
  if not (issue.fields and issue.fields.comment) then
    require('jira.client').get_issue(issue.key, function(err, full)
      if err or not full then
        if err then require('logger').warn('jira: lazy load failed: ' .. tostring(err)) end
        return
      end
      vim.schedule(function()
        if not vim.api.nvim_buf_is_valid(buf) then return end
        -- An action fired between fetch start and resolve — its response is
        -- canonical; drop the stale pre-action payload to avoid visual revert.
        if state.dirty then return end
        state.issue = full
        local full_lines = M.build_lines(full)
        render_into(buf, full_lines)
        if vim.api.nvim_win_is_valid(win) then
          local new_height = fit_height(full_lines)
          local new_row    = select(1, float.center(width, new_height))
          pcall(vim.api.nvim_win_set_config, win, {
            relative = 'editor',
            width    = width,
            height   = new_height,
            row      = new_row,
            col      = col,
          })
        end
      end)
    end)
  end

  local function close()
    if not vim.api.nvim_win_is_valid(win) then return end
    -- Stop treesitter explicitly: leaving it to the BufWipeout-triggered
    -- markdown parser teardown was adding ~500ms of perceived lag on close.
    pcall(vim.treesitter.stop, buf)
    vim.api.nvim_win_close(win, true)
  end

  -- Tracks which action key has an outstanding request so rapid double-taps
  -- (e.g. `tt`) don't stack UI prompts or fire overlapping HTTP calls.
  local in_flight = {}

  local function on_action_result(label, action_opts)
    action_opts = action_opts or {}
    return function(err, updated)
      vim.schedule(function()
        in_flight[label] = nil
        if err then
          require('logger').error('jira: ' .. label .. ' failed: ' .. err)
          return
        end
        if not updated then return end
        state.issue = updated
        state.dirty = true
        if action_opts.close_after then
          close()
          require('logger').info('jira: ' .. label .. ' done')
          return
        end
        if vim.api.nvim_buf_is_valid(buf) then
          render_into(buf, M.build_lines(updated))
          if vim.api.nvim_win_is_valid(win) then
            pcall(vim.api.nvim_win_set_config, win, {
              title  = ' ' .. updated.key .. ' ',
              footer = build_footer(updated),
            })
          end
        end
        require('logger').info('jira: ' .. label .. ' done')
      end)
    end
  end

  local function guarded(label, fn)
    return function()
      if in_flight[label] then return end
      in_flight[label] = true
      fn()
    end
  end

  vim.keymap.set('n', 'q',     close, { buffer = buf, nowait = true })
  vim.keymap.set('n', '<Esc>', close, { buffer = buf, nowait = true })

  if on_back then
    vim.keymap.set('n', '<BS>', function()
      local dirty = state.dirty
      close()
      on_back(dirty)
    end, { buffer = buf, nowait = true, desc = 'Jira: back to picker' })
  end

  vim.keymap.set('n', 's', guarded('start', function()
    if not can_start(state.issue) then
      in_flight['start'] = nil
      require('logger').warn('jira: start not available for status ' .. (status_category(state.issue) or '?'))
      return
    end
    require('jira.actions').start(state.issue, origin_cwd, on_action_result('start', { close_after = true }))
  end), { buffer = buf, nowait = true, desc = 'Jira: start work (assign + transition + branch)' })

  vim.keymap.set('n', 't', guarded('transition', function()
    require('jira.actions').transition(state.issue, on_action_result('transition'))
  end), { buffer = buf, nowait = true, desc = 'Jira: pick transition' })

  vim.keymap.set('n', 'a', guarded('assign', function()
    require('jira.actions').assign(state.issue, on_action_result('assign'))
  end), { buffer = buf, nowait = true, desc = 'Jira: assign' })

  vim.keymap.set('n', 'c', guarded('comment', function()
    require('jira.actions').comment(state.issue, on_action_result('comment'))
  end), { buffer = buf, nowait = true, desc = 'Jira: add comment' })

  vim.keymap.set('n', 'p', guarded('priority', function()
    require('jira.actions').priority(state.issue, on_action_result('priority'))
  end), { buffer = buf, nowait = true, desc = 'Jira: set priority' })
end

return M
