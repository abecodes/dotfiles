-- Headless smoke tests for the jira module. No network, no UI — every
-- outward call (vim.system / logger / etc.) is monkey-patched.
--
-- Run from the nvim config root:
--   nvim --headless -u NONE -l tests/jira/smoke.lua
--
-- Or from anywhere with an absolute path:
--   nvim --headless -u NONE -l <abs>/tests/jira/smoke.lua
--
-- Exits 0 on success, 1 if any assertion fails.

local script      = debug.getinfo(1, 'S').source:sub(2)
local config_root = vim.fn.fnamemodify(script, ':p:h:h:h')
vim.opt.rtp:prepend(config_root)

-- Silence + capture logger before anything that requires it.
local log = require('logger')
local logs = { error = {}, warn = {}, info = {}, debug = {} }
log.error = function(msg) table.insert(logs.error, msg) end
log.warn  = function(msg) table.insert(logs.warn,  msg) end
log.info  = function(msg) table.insert(logs.info,  msg) end
log.debug = function(msg) table.insert(logs.debug, msg) end

----------------------------------------------------------------------
-- Test harness
----------------------------------------------------------------------

local failed, total, passed = false, 0, 0

local function record(ok, label, note)
  total = total + 1
  if ok then passed = passed + 1 else failed = true end
  local tag = ok and 'PASS' or 'FAIL'
  io.write(('%s  %s%s\n'):format(tag, label, (not ok and note) and ('  — ' .. note) or ''))
end

local function check(label, ok, note) record(ok and true or false, label, note) end

local function assert_eq(label, got, want)
  local ok
  if type(got) == 'table' and type(want) == 'table' then
    ok = vim.deep_equal(got, want)
  else
    ok = got == want
  end
  record(ok, label, not ok and ('got=' .. vim.inspect(got) .. '  want=' .. vim.inspect(want)) or nil)
end

local function section(name) io.write('\n=== ' .. name .. ' ===\n') end

local function has_line(lines, needle)
  for _, l in ipairs(lines) do if l == needle then return true end end
  return false
end

local function has_match(lines, pat)
  for _, l in ipairs(lines) do if l:find(pat) then return true end end
  return false
end

----------------------------------------------------------------------
-- 1. Module loading
----------------------------------------------------------------------
section('modules load')

local ui     = require('jira.ui')
local telem  = require('jira.telescope')
local client = require('jira.client')
local config = require('jira.config')
local adf    = require('jira.adf')
local acts   = require('jira.actions')
local init   = require('jira')

check('ui.format_item exported',          type(ui.format_item) == 'function')
check('ui.build_lines exported',          type(ui.build_lines) == 'function')
check('ui.preview exported',              type(ui.preview) == 'function')
check('ui.pick_issue exported',           type(ui.pick_issue) == 'function')
check('telescope.pick_issue exported',    type(telem.pick_issue) == 'function')
check('telescope.is_available exported',  type(telem.is_available) == 'function')
check('telescope has no format_item',     rawget(telem, 'format_item') == nil)
check('telescope has no priority_short',  rawget(telem, 'priority_short') == nil)
check('telescope has no CAT_DISPLAY',     rawget(telem, 'CAT_DISPLAY') == nil)
check('actions loaded',                   type(acts) == 'table')
check('init loaded',                      type(init) == 'table')
check('adf.flatten exported',             type(adf.flatten) == 'function')

----------------------------------------------------------------------
-- 2. ui.format_item
----------------------------------------------------------------------
section('ui.format_item')

local function fmt(key, priority, cat, summary)
  return ('%-9s  %-1s  %-4s  %s'):format(key, priority, cat, summary)
end

assert_eq('populated issue',
  ui.format_item({
    key = 'ABC-123',
    fields = {
      summary  = 'hello',
      priority = { name = 'High' },
      status   = { statusCategory = { key = 'indeterminate' } },
    },
  }),
  fmt('ABC-123', 'H', 'wip', 'hello'))

assert_eq('status new maps to new',
  ui.format_item({ key = 'X', fields = { status = { statusCategory = { key = 'new' } }, summary = 's' } }),
  fmt('X', '?', 'new', 's'))

assert_eq('status done maps to done',
  ui.format_item({ key = 'X', fields = { status = { statusCategory = { key = 'done' } }, summary = 's' } }),
  fmt('X', '?', 'done', 's'))

assert_eq('unknown statusCategory passes through',
  ui.format_item({ key = 'X', fields = { status = { statusCategory = { key = 'weird' } }, summary = 's' } }),
  fmt('X', '?', 'weird', 's'))

assert_eq('priority TBD becomes ?',
  ui.format_item({ key = 'X', fields = { priority = { name = 'TBD' } } }),
  fmt('X', '?', '?', ''))

assert_eq('priority empty string becomes ?',
  ui.format_item({ key = 'X', fields = { priority = { name = '' } } }),
  fmt('X', '?', '?', ''))

assert_eq('priority absent becomes ?',
  ui.format_item({ key = 'X', fields = {} }),
  fmt('X', '?', '?', ''))

assert_eq('key longer than 9 is truncated',
  ui.format_item({ key = 'ABCDEFGHIJK', fields = { summary = 's' } }),
  fmt('ABCDEFGHI', '?', '?', 's'))

local row_nil_ok, row_nil = pcall(ui.format_item, {
  key = 'X',
  fields = { summary = vim.NIL, priority = vim.NIL, status = vim.NIL },
})
check('vim.NIL fields do not crash',
  row_nil_ok and type(row_nil) == 'string' and row_nil:find('X%s+%?%s+%?') ~= nil,
  not row_nil_ok and tostring(row_nil) or nil)

local row_bare_ok, row_bare = pcall(ui.format_item, { key = 'Y' })
check('missing fields table does not crash', row_bare_ok and type(row_bare) == 'string')

local row_nokey = ui.format_item({ fields = { summary = 's' } })
check('missing key falls back to ?', row_nokey:sub(1, 1) == '?')

----------------------------------------------------------------------
-- 3. ui.build_lines
----------------------------------------------------------------------
section('ui.build_lines')

local lines_full = ui.build_lines({
  key = 'JIRA-1',
  fields = {
    summary   = 'Do the thing',
    status    = { name = 'In Progress', statusCategory = { key = 'indeterminate' } },
    issuetype = { name = 'Task' },
    priority  = { name = 'High' },
    assignee  = { displayName = 'Alice' },
    reporter  = { displayName = 'Bob' },
    description = { type = 'doc', version = 1, content = {
      { type = 'paragraph', content = { { type = 'text', text = 'desc line' } } },
    } },
    comment = { comments = {
      { author = { displayName = 'Carol' }, created = '2026-04-18T10:23:45.123+0000',
        body = { type = 'doc', version = 1, content = {
          { type = 'paragraph', content = { { type = 'text', text = 'first comment' } } },
        } } },
      { author = { displayName = 'Dave' }, created = '2026-04-19T11:00:00.000+0000',
        body = { type = 'doc', version = 1, content = {
          { type = 'paragraph', content = { { type = 'text', text = 'second comment' } } },
        } } },
    } },
  },
})

check('header with key and summary',    lines_full[1] == '# JIRA-1 — Do the thing')
check('status line',                    has_line(lines_full, '- Status:   In Progress'))
check('type line',                      has_line(lines_full, '- Type:     Task'))
check('priority line',                  has_line(lines_full, '- Priority: High'))
check('assignee line',                  has_line(lines_full, '- Assignee: Alice'))
check('reporter line',                  has_line(lines_full, '- Reporter: Bob'))
check('description body rendered',      has_line(lines_full, 'desc line'))
check('comments header counts comments',has_line(lines_full, '## Comments (2)'))
check('comment 1 author + timestamp',   has_line(lines_full, '**Carol** — 2026-04-18 10:23'))
check('comment 2 author + timestamp',   has_line(lines_full, '**Dave** — 2026-04-19 11:00'))
check('comment 1 body',                 has_line(lines_full, 'first comment'))
check('comment 2 body',                 has_line(lines_full, 'second comment'))

local lines_nocomment = ui.build_lines({ key = 'X', fields = { summary = 's' } })
check('no comments section when absent', not has_match(lines_nocomment, '## Comments'))

local lines_bare = ui.build_lines({ key = 'Z' })
check('defaults: status = ?',         has_line(lines_bare, '- Status:   ?'))
check('defaults: type = ?',           has_line(lines_bare, '- Type:     ?'))
check('defaults: priority = ?',       has_line(lines_bare, '- Priority: ?'))
check('defaults: assignee unassigned',has_line(lines_bare, '- Assignee: unassigned'))
check('defaults: reporter = ?',       has_line(lines_bare, '- Reporter: ?'))

local lines_nil = ui.build_lines({ key = 'Z', fields = { assignee = vim.NIL, status = vim.NIL } })
check('vim.NIL assignee → unassigned', has_line(lines_nil, '- Assignee: unassigned'))

----------------------------------------------------------------------
-- 4. adf.flatten
----------------------------------------------------------------------
section('adf.flatten')

local function doc(...) return { type = 'doc', version = 1, content = { ... } } end
local function para(...) return { type = 'paragraph', content = { ... } } end
local function txt(s, marks) return { type = 'text', text = s, marks = marks } end

assert_eq('string passes through',   adf.flatten('hi'), 'hi')
assert_eq('nil returns empty',        adf.flatten(nil), '')
assert_eq('number returns empty',     adf.flatten(42), '')
assert_eq('table without content',    adf.flatten({ type = 'doc' }), '')

assert_eq('paragraph plain text',
  adf.flatten(doc(para(txt('hello')))),
  'hello')

assert_eq('code mark wraps in backticks',
  adf.flatten(doc(para(txt('x', { { type = 'code' } })))),
  '`x`')

assert_eq('link mark appends href',
  adf.flatten(doc(para(txt('click', { { type = 'link', attrs = { href = 'http://x' } } })))),
  'click (http://x)')

assert_eq('hardBreak inserts newline',
  adf.flatten(doc(para(txt('a'), { type = 'hardBreak' }, txt('b')))),
  'a\nb')

assert_eq('mention renders attrs.text',
  adf.flatten(doc(para({ type = 'mention', attrs = { text = '@alice' } }))),
  '@alice')

assert_eq('emoji prefers attrs.text',
  adf.flatten(doc(para({ type = 'emoji', attrs = { shortName = ':smile:', text = ':)' } }))),
  ':)')

assert_eq('inlineCard renders url',
  adf.flatten(doc(para({ type = 'inlineCard', attrs = { url = 'http://card' } }))),
  'http://card')

assert_eq('heading level 2',
  adf.flatten(doc({ type = 'heading', attrs = { level = 2 }, content = { txt('h2') } })),
  '## h2')

assert_eq('heading default level 1',
  adf.flatten(doc({ type = 'heading', content = { txt('top') } })),
  '# top')

assert_eq('bulletList',
  adf.flatten(doc({ type = 'bulletList', content = {
    { type = 'listItem', content = { para(txt('a')) } },
    { type = 'listItem', content = { para(txt('b')) } },
  } })),
  '- a\n- b')

assert_eq('orderedList numbering',
  adf.flatten(doc({ type = 'orderedList', content = {
    { type = 'listItem', content = { para(txt('x')) } },
    { type = 'listItem', content = { para(txt('y')) } },
  } })),
  '1. x\n2. y')

assert_eq('codeBlock fences with language',
  adf.flatten(doc({ type = 'codeBlock', attrs = { language = 'lua' }, content = { txt('print(1)') } })),
  '```lua\nprint(1)\n```')

assert_eq('rule renders ---', adf.flatten(doc({ type = 'rule' })), '---')

assert_eq('blockquote prefixes lines',
  adf.flatten(doc({ type = 'blockquote', content = { para(txt('q')) } })),
  '> q')

assert_eq('unknown node falls through to children',
  adf.flatten(doc({ type = 'unknownWrapper', content = { para(txt('inner')) } })),
  'inner')

----------------------------------------------------------------------
-- 5. config — pre-set state
----------------------------------------------------------------------
section('config pre-set')

logs.error = {}
check('config.get returns nil when unset', config.get() == nil)
check('config.get logs the error',
  #logs.error == 1 and logs.error[1]:find('not configured') ~= nil)

check('auth_header nil when unset', config.auth_header() == nil)

-- set validation
logs.error = {}
check('set rejects missing base_url', config.set({ email = 'x' }) == false)
check('set rejects empty base_url',   config.set({ base_url = '', email = 'x' }) == false)
check('set rejects missing email',    config.set({ base_url = 'https://x' }) == false)
check('set rejects empty email',      config.set({ base_url = 'https://x', email = '' }) == false)
check('rejection keeps state unset',  config.get() == nil)

----------------------------------------------------------------------
-- 6. client pre-setup guard — every public method surfaces 'not configured'
----------------------------------------------------------------------
section('client pre-setup guard')

local function expect_not_configured(label, call)
  local captured
  call(function(err) captured = err end)
  check(label, captured == 'not configured', 'got=' .. tostring(captured))
end

expect_not_configured('myself',            function(cb) client.myself(cb) end)
expect_not_configured('get_transitions',   function(cb) client.get_transitions('A-1', cb) end)
expect_not_configured('do_transition',     function(cb) client.do_transition('A-1', '1', cb) end)
expect_not_configured('assign',            function(cb) client.assign('A-1', 'id', cb) end)
expect_not_configured('get_priorities',    function(cb) client.get_priorities(cb) end)
expect_not_configured('set_priority',      function(cb) client.set_priority('A-1', '1', cb) end)
expect_not_configured('add_comment',       function(cb) client.add_comment('A-1', 'hi', cb) end)
expect_not_configured('search_assignable', function(cb) client.search_assignable('A-1', 'q', cb) end)
expect_not_configured('get_issue',         function(cb) client.get_issue('A-1', cb) end)
expect_not_configured('search',            function(cb) client.search('q', cb) end)

----------------------------------------------------------------------
-- 7. config.set happy path + defaults
----------------------------------------------------------------------
section('config.set + defaults')

check('set trims trailing slashes',
  config.set({ base_url = 'https://example.atlassian.net///', email = 'me@x' }) == true)
assert_eq('base_url trimmed', config.get().base_url, 'https://example.atlassian.net')

local cfg = config.get()
check('default max_results is 50',  cfg.max_results == 50)
check('default token_env',          cfg.token_env == 'JIRA_TOKEN')
check('default fields: 7 entries',  type(cfg.fields) == 'table' and #cfg.fields == 7)
check('default filters is table',   type(cfg.filters) == 'table')
check('in_progress default nil',    cfg.in_progress == nil)

check('get_my_account_id nil initially', config.get_my_account_id() == nil)
config.set_my_account_id('acct-1')
check('set/get_my_account_id roundtrip', config.get_my_account_id() == 'acct-1')
config.set({ base_url = 'https://example.atlassian.net', email = 'me@x' })
check('my_account_id cleared on config.set', config.get_my_account_id() == nil)
config.set_my_account_id('acct-1')

----------------------------------------------------------------------
-- 8. auth_header
----------------------------------------------------------------------
section('auth_header')

vim.env.JIRA_TOKEN = ''
logs.error = {}
check('auth_header nil when token empty', config.auth_header() == nil)
check('auth_header logs on empty token',
  #logs.error >= 1 and logs.error[#logs.error]:find('JIRA_TOKEN') ~= nil)

vim.env.JIRA_TOKEN = 'tok'
assert_eq('auth_header format',
  config.auth_header(),
  'Basic ' .. vim.base64.encode('me@x:tok'))

----------------------------------------------------------------------
-- 9. client URL construction (monkey-patched vim.system)
----------------------------------------------------------------------
section('client URL construction')

local system_resp      = { code = 0, stdout = '{}', stderr = '' }
local captured_args    = {}
local captured_stdins  = {}
local orig_system      = vim.system

---@diagnostic disable-next-line: duplicate-set-field, redundant-parameter
vim.system = function(args, opts, cb)
  table.insert(captured_args, args)
  table.insert(captured_stdins, opts and opts.stdin or nil)
  cb(system_resp)
  return { pid = 0, wait = function() return system_resp end, kill = function() end }
end

local function capture_one(call)
  captured_args   = {}
  captured_stdins = {}
  local done = false
  call(function() done = true end)
  vim.wait(500, function() return done end)
  return captured_args[1]
end

local function url_of(args) return args and args[#args] or nil end

local function body_of(args)
  for i, a in ipairs(args or {}) do
    if a == '--data-binary' then return args[i + 1] end
  end
  return nil
end

local base = 'https://example.atlassian.net'

assert_eq('myself URL',
  url_of(capture_one(function(cb) client.myself(cb) end)),
  base .. '/rest/api/3/myself')

assert_eq('get_transitions URL',
  url_of(capture_one(function(cb) client.get_transitions('ABC-1', cb) end)),
  base .. '/rest/api/3/issue/ABC-1/transitions')

assert_eq('do_transition URL',
  url_of(capture_one(function(cb) client.do_transition('ABC-1', '5', cb) end)),
  base .. '/rest/api/3/issue/ABC-1/transitions')

assert_eq('assign URL',
  url_of(capture_one(function(cb) client.assign('ABC-1', 'acct', cb) end)),
  base .. '/rest/api/3/issue/ABC-1/assignee')

assert_eq('get_priorities URL',
  url_of(capture_one(function(cb) client.get_priorities(cb) end)),
  base .. '/rest/api/3/priority')

assert_eq('set_priority URL',
  url_of(capture_one(function(cb) client.set_priority('ABC-1', '3', cb) end)),
  base .. '/rest/api/3/issue/ABC-1')

assert_eq('add_comment URL',
  url_of(capture_one(function(cb) client.add_comment('ABC-1', 'hi', cb) end)),
  base .. '/rest/api/3/issue/ABC-1/comment')

assert_eq('search_assignable URL with query',
  url_of(capture_one(function(cb) client.search_assignable('ABC-1', 'ali', cb) end)),
  base .. '/rest/api/3/user/assignable/search?issueKey=ABC-1&query=ali&maxResults=20')

assert_eq('search URL',
  url_of(capture_one(function(cb) client.search('project = ABC', cb) end)),
  base .. '/rest/api/3/search/jql')

assert_eq('get_issue URL includes comment field',
  url_of(capture_one(function(cb) client.get_issue('ABC-1', cb) end)),
  base .. '/rest/api/3/issue/ABC-1?fields=summary,status,assignee,description,issuetype,priority,reporter,comment')

-- Headers include auth + JSON accept.
local function has_arg_pair(args, a, b)
  for i = 1, #args - 1 do
    if args[i] == a and args[i + 1] == b then return true end
  end
  return false
end

local args_sample  = capture_one(function(cb) client.myself(cb) end)
local stdin_sample = captured_stdins[1]

-- Auth travels via curl `-K -` (config from stdin) so the token never lands
-- in argv / /proc/<pid>/cmdline / ps. Both halves of the contract are pinned:
check('argv does NOT contain Authorization (hardening)',
  type(args_sample) == 'table'
    and not vim.iter(args_sample):any(function(a)
      return type(a) == 'string' and a:find('Authorization:', 1, true) ~= nil
    end))
check('request uses -K - to read config from stdin',
  has_arg_pair(args_sample, '-K', '-'))
check('stdin carries Authorization header in curl config format',
  type(stdin_sample) == 'string'
    and stdin_sample:find(
      'header = "Authorization: Basic ' .. vim.base64.encode('me@x:tok') .. '"',
      1, true) ~= nil)
check('request sets Accept: application/json',
  has_arg_pair(args_sample, '-H', 'Accept: application/json'))
check('request uses curl --fail-with-body',
  vim.tbl_contains(args_sample, '--fail-with-body'))

----------------------------------------------------------------------
-- 10. Request body shape
----------------------------------------------------------------------
section('client request body shape')

local ac_args = capture_one(function(cb) client.add_comment('K', 'line one\n\nline three', cb) end)
local ac_body = vim.json.decode(body_of(ac_args))
check('add_comment body: ADF doc',
  ac_body.body and ac_body.body.type == 'doc' and ac_body.body.version == 1)
check('add_comment body: 3 paragraphs',
  type(ac_body.body.content) == 'table' and #ac_body.body.content == 3)
check('add_comment paragraph 1 text',
  ac_body.body.content[1].content and ac_body.body.content[1].content[1].text == 'line one')
check('add_comment paragraph 2 empty',
  ac_body.body.content[2].content == nil or ac_body.body.content[2].content == vim.NIL)
check('add_comment paragraph 3 text',
  ac_body.body.content[3].content and ac_body.body.content[3].content[1].text == 'line three')

local dt_body = vim.json.decode(body_of(capture_one(function(cb) client.do_transition('K', 7, cb) end)))
assert_eq('do_transition body', dt_body, { transition = { id = '7' } })

local sp_body = vim.json.decode(body_of(capture_one(function(cb) client.set_priority('K', 3, cb) end)))
assert_eq('set_priority body', sp_body, { fields = { priority = { id = '3' } } })

local as_body = vim.json.decode(body_of(capture_one(function(cb) client.assign('K', 'acc-1', cb) end)))
assert_eq('assign body', as_body, { accountId = 'acc-1' })

local sr_body = vim.json.decode(body_of(capture_one(function(cb) client.search('project = ABC', cb) end)))
check('search body jql',        sr_body.jql == 'project = ABC')
check('search body maxResults', sr_body.maxResults == 50)
check('search body fields count', type(sr_body.fields) == 'table' and #sr_body.fields == 7)

----------------------------------------------------------------------
-- 11. request response branches
----------------------------------------------------------------------
section('client request response branches')

local function one_response(resp, call)
  system_resp = resp
  local done, out_err, out_decoded = false, nil, nil
  call(function(e, d) out_err, out_decoded, done = e, d, true end)
  vim.wait(500, function() return done end)
  return out_err, out_decoded
end

assert_eq('nonzero exit with stderr surfaces stderr',
  ({ one_response({ code = 1, stdout = '', stderr = 'boom' },
    function(cb) client.myself(cb) end) })[1],
  'boom')

assert_eq('nonzero exit without stderr surfaces curl exit',
  ({ one_response({ code = 42, stdout = '', stderr = '' },
    function(cb) client.myself(cb) end) })[1],
  'curl exit 42')

local e3, d3 = one_response({ code = 0, stdout = '', stderr = '' },
  function(cb) client.myself(cb) end)
check('empty stdout on success returns (nil, {})',
  e3 == nil and type(d3) == 'table' and vim.tbl_isempty(d3))

local e4 = one_response({ code = 0, stdout = 'not json', stderr = '' },
  function(cb) client.myself(cb) end)
check('invalid JSON surfaces invalid JSON error',
  type(e4) == 'string' and e4:find('^invalid JSON:') ~= nil)

----------------------------------------------------------------------
-- 12. client.search pagination
----------------------------------------------------------------------
section('client.search pagination')

local search_calls   = 0
local search_bodies  = {}

---@diagnostic disable-next-line: duplicate-set-field, redundant-parameter
vim.system = function(args, _opts, cb)
  search_calls = search_calls + 1
  table.insert(search_bodies, vim.json.decode(body_of(args)))
  local resp
  if search_calls == 1 then
    resp = { code = 0, stderr = '',
      stdout = vim.json.encode({ issues = { { key = 'A-1' } }, nextPageToken = 't2' }) }
  else
    resp = { code = 0, stderr = '',
      stdout = vim.json.encode({ issues = { { key = 'A-2' } } }) }
  end
  cb(resp)
  return { pid = 0, wait = function() return resp end, kill = function() end }
end

local done, search_err, search_issues = false, nil, nil
client.search('project = X', function(err, issues)
  search_err, search_issues, done = err, issues, true
end)
vim.wait(500, function() return done end)

check('search made 2 calls',    search_calls == 2)
check('search returned no err', search_err == nil)
check('search concatenated 2 issues in order',
  type(search_issues) == 'table' and #search_issues == 2
    and search_issues[1].key == 'A-1' and search_issues[2].key == 'A-2')
check('second page body carries nextPageToken',
  search_bodies[2] and search_bodies[2].nextPageToken == 't2')
check('first page body has no nextPageToken',
  search_bodies[1] and search_bodies[1].nextPageToken == nil)

-- Restore vim.system.
vim.system = orig_system

----------------------------------------------------------------------
-- 13. actions happy paths
----------------------------------------------------------------------
section('actions happy paths')

-- Originals for restore at section end.
local orig_ui_select  = vim.ui.select
local orig_ui_input   = vim.ui.input
local orig_textarea   = package.loaded['ui.textarea']
local orig_live_sel   = package.loaded['ui.live_select']
local orig_client     = {}
for _, name in ipairs({
  'get_priorities', 'set_priority',
  'get_transitions', 'do_transition',
  'add_comment', 'search_assignable',
  'assign', 'myself', 'get_issue',
}) do
  orig_client[name] = client[name]
end

local function stub_client(overrides)
  for name, fn in pairs(overrides) do client[name] = fn end
end

-- Canned refresh: assertions use identity comparison.
local REFRESHED = { key = 'ABC-1', fields = { summary = 'refreshed' } }

local act_capture

-- priority ------------------------------------------------------------
act_capture = {}
---@diagnostic disable-next-line: duplicate-set-field
vim.ui.select = function(items, _, cb) cb(items[1]) end
stub_client({
  get_priorities = function(cb) cb(nil, { { id = '1', name = 'Low' }, { id = '2', name = 'High' } }) end,
  set_priority   = function(key, id, cb)
    act_capture.priority_set = { key = key, id = id }
    cb(nil, {})
  end,
  get_issue      = function(_, cb) cb(nil, REFRESHED) end,
})

local p_done, p_err, p_refreshed = false, nil, nil
acts.priority({ key = 'ABC-1', fields = {} }, function(err, d)
  p_err, p_refreshed, p_done = err, d, true
end)
vim.wait(500, function() return p_done end)

check('priority: set_priority called with chosen id',
  act_capture.priority_set and act_capture.priority_set.key == 'ABC-1'
    and act_capture.priority_set.id == '1')
check('priority: callback fires with no error',       p_err == nil)
check('priority: callback receives refreshed issue', p_refreshed == REFRESHED)

-- transition ----------------------------------------------------------
act_capture = {}
---@diagnostic disable-next-line: duplicate-set-field
vim.ui.select = function(items, _, cb) cb(items[1]) end
stub_client({
  get_transitions = function(_, cb) cb(nil, { { id = '5', name = 'In Progress' } }) end,
  do_transition   = function(key, id, cb)
    act_capture.transition = { key = key, id = id }
    cb(nil, {})
  end,
  get_issue       = function(_, cb) cb(nil, REFRESHED) end,
})

local t_done, t_err, t_refreshed = false, nil, nil
acts.transition({ key = 'ABC-1' }, function(err, d)
  t_err, t_refreshed, t_done = err, d, true
end)
vim.wait(500, function() return t_done end)

check('transition: do_transition called with chosen id',
  act_capture.transition and act_capture.transition.key == 'ABC-1'
    and act_capture.transition.id == '5')
check('transition: callback fires with no error',       t_err == nil)
check('transition: callback receives refreshed issue', t_refreshed == REFRESHED)

-- comment -------------------------------------------------------------
act_capture = {}
package.loaded['ui.textarea'] = function(_, cb) cb('canned comment body') end
stub_client({
  add_comment = function(key, text, cb)
    act_capture.comment = { key = key, text = text }
    cb(nil, {})
  end,
  get_issue   = function(_, cb) cb(nil, REFRESHED) end,
})

local c_done, c_err, c_refreshed = false, nil, nil
acts.comment({ key = 'ABC-1' }, function(err, d)
  c_err, c_refreshed, c_done = err, d, true
end)
vim.wait(500, function() return c_done end)

check('comment: add_comment called with input text',
  act_capture.comment and act_capture.comment.key == 'ABC-1'
    and act_capture.comment.text == 'canned comment body')
check('comment: callback fires with no error',       c_err == nil)
check('comment: callback receives refreshed issue', c_refreshed == REFRESHED)

-- assign --------------------------------------------------------------
act_capture = {}
package.loaded['ui.live_select'] = function(opts, cb)
  -- Drive one fetch round, then pick the first result.
  opts.fetch('ali', function(items) cb(items[1]) end)
end
stub_client({
  search_assignable = function(key, query, cb)
    act_capture.search = { key = key, query = query }
    cb(nil, { { accountId = 'a1', displayName = 'Alice', emailAddress = 'a@x' } })
  end,
  assign            = function(key, accountId, cb)
    act_capture.assign = { key = key, accountId = accountId }
    cb(nil, {})
  end,
  get_issue         = function(_, cb) cb(nil, REFRESHED) end,
})

local a_done, a_err, a_refreshed = false, nil, nil
acts.assign({ key = 'ABC-1' }, function(err, d)
  a_err, a_refreshed, a_done = err, d, true
end)
vim.wait(500, function() return a_done end)

check('assign: search_assignable fired',
  act_capture.search and act_capture.search.key == 'ABC-1' and act_capture.search.query == 'ali')
check('assign: assign called with chosen accountId',
  act_capture.assign and act_capture.assign.key == 'ABC-1' and act_capture.assign.accountId == 'a1')
check('assign: callback fires with no error',       a_err == nil)
check('assign: callback receives refreshed issue', a_refreshed == REFRESHED)

-- start ---------------------------------------------------------------
-- config.set_my_account_id('acct-1') was set earlier (section 7), so the
-- cached id skips client.myself. We reuse that id here as `me`.
local ME = 'acct-1'
local git_calls = {}
---@diagnostic disable-next-line: duplicate-set-field, redundant-parameter
vim.system = function(args, _opts, cb)
  local resp = { code = 0, stdout = '', stderr = '' }
  if args and args[1] == 'git' then
    table.insert(git_calls, args)
  end
  cb(resp)
  return { pid = 0, wait = function() return resp end, kill = function() end }
end

-- Common client stubs for all three start sub-cases.
stub_client({
  myself          = function(cb) cb(nil, { accountId = ME }) end,
  assign          = function(key, accountId, cb)
    act_capture.assign = { key = key, accountId = accountId }
    cb(nil, {})
  end,
  get_transitions = function(_, cb)
    cb(nil, { { id = '5', name = 'In Progress',
               to = { statusCategory = { key = 'indeterminate' } } } })
  end,
  do_transition   = function(key, id, cb)
    act_capture.transition = { key = key, id = id }
    cb(nil, {})
  end,
  get_issue       = function(_, cb) cb(nil, REFRESHED) end,
})

-- Sub-case 1: already assigned to me, valid branch name.
act_capture  = {}
git_calls    = {}
---@diagnostic disable-next-line: duplicate-set-field
vim.ui.input = function(_, cb) cb('feature/ABC-1_init') end

local s1_done, s1_err, s1_refreshed = false, nil, nil
acts.start(
  { key = 'ABC-1', fields = { assignee = { accountId = ME } } },
  '/tmp/fake-repo',
  function(err, d) s1_err, s1_refreshed, s1_done = err, d, true end)
vim.wait(500, function() return s1_done end)

check('start[assigned]: no assign call (already me)', act_capture.assign == nil)
check('start[assigned]: do_transition called',
  act_capture.transition and act_capture.transition.key == 'ABC-1'
    and act_capture.transition.id == '5')
check('start[assigned]: worktree pre-flight invoked',
  #git_calls >= 1 and git_calls[1][2] == 'rev-parse'
    and git_calls[1][3] == '--is-inside-work-tree')
check('start[assigned]: git checkout -b invoked after pre-flight',
  #git_calls == 2 and git_calls[2][2] == 'checkout' and git_calls[2][3] == '-b'
    and git_calls[2][4] == 'feature/ABC-1_init')
check('start[assigned]: callback fires with refreshed issue',
  s1_err == nil and s1_refreshed == REFRESHED)

-- Sub-case 2: NOT assigned to me — client.assign should run first.
act_capture = {}
git_calls   = {}

local s2_done, s2_err, s2_refreshed = false, nil, nil
acts.start(
  { key = 'ABC-1', fields = { assignee = { accountId = 'someone-else' } } },
  '/tmp/fake-repo',
  function(err, d) s2_err, s2_refreshed, s2_done = err, d, true end)
vim.wait(500, function() return s2_done end)

check('start[unassigned]: assign called with me',
  act_capture.assign and act_capture.assign.accountId == ME)
check('start[unassigned]: do_transition still called',
  act_capture.transition and act_capture.transition.id == '5')
check('start[unassigned]: git checkout -b invoked after pre-flight',
  #git_calls == 2 and git_calls[1][2] == 'rev-parse'
    and git_calls[2][2] == 'checkout' and git_calls[2][4] == 'feature/ABC-1_init')
check('start[unassigned]: callback fires with refreshed issue',
  s2_err == nil and s2_refreshed == REFRESHED)

-- Sub-case 3: invalid branch name — Jira already transitioned, so the flow
-- must NOT skip refresh. Expect: no git checkout, a warning logged, and the
-- callback still receives the refreshed issue (no hard error).
act_capture  = {}
git_calls    = {}
logs.warn    = {}
---@diagnostic disable-next-line: duplicate-set-field
vim.ui.input = function(_, cb) cb('bad~name') end

local s3_done, s3_err, s3_refreshed = false, nil, nil
acts.start(
  { key = 'ABC-1', fields = { assignee = { accountId = ME } } },
  '/tmp/fake-repo',
  function(err, d) s3_err, s3_refreshed, s3_done = err, d, true end)
vim.wait(500, function() return s3_done end)

check('start[invalid branch]: no git checkout call',
  #git_calls == 1 and git_calls[1][2] == 'rev-parse')
check('start[invalid branch]: log.warn captured',
  #logs.warn >= 1 and logs.warn[#logs.warn]:find('invalid branch name', 1, true) ~= nil)
check('start[invalid branch]: callback still fires with refreshed issue',
  s3_err == nil and s3_refreshed == REFRESHED)

-- Sub-case 4: cwd is NOT a git worktree — pre-flight fails BEFORE any Jira
-- mutation. Expect no assign, no transition, no checkout, error surfaced.
act_capture = {}
git_calls   = {}
---@diagnostic disable-next-line: duplicate-set-field, redundant-parameter
vim.system = function(args, _opts, cb)
  local resp
  if args and args[1] == 'git' and args[2] == 'rev-parse' then
    table.insert(git_calls, args)
    resp = { code = 128, stdout = '', stderr = 'fatal: not a git repository' }
  else
    resp = { code = 0, stdout = '', stderr = '' }
    if args and args[1] == 'git' then table.insert(git_calls, args) end
  end
  cb(resp)
  return { pid = 0, wait = function() return resp end, kill = function() end }
end

local s4_done, s4_err, s4_refreshed = false, nil, nil
acts.start(
  { key = 'ABC-1', fields = { assignee = { accountId = ME } } },
  '/tmp/not-a-repo',
  function(err, d) s4_err, s4_refreshed, s4_done = err, d, true end)
vim.wait(500, function() return s4_done end)

check('start[no worktree]: only rev-parse fired, no checkout',
  #git_calls == 1 and git_calls[1][2] == 'rev-parse')
check('start[no worktree]: no assign call',         act_capture.assign == nil)
check('start[no worktree]: no transition call',     act_capture.transition == nil)
check('start[no worktree]: err surfaces cwd',
  type(s4_err) == 'string' and s4_err:find('not inside a git worktree', 1, true) ~= nil
    and s4_err:find('/tmp/not-a-repo', 1, true) ~= nil)
check('start[no worktree]: no refreshed issue', s4_refreshed == nil)

-- Restore.
vim.system                       = orig_system
vim.ui.select                    = orig_ui_select
vim.ui.input                     = orig_ui_input
package.loaded['ui.textarea']    = orig_textarea
package.loaded['ui.live_select'] = orig_live_sel
for name, fn in pairs(orig_client) do client[name] = fn end

----------------------------------------------------------------------
-- Exit
----------------------------------------------------------------------

io.write(('\n%d / %d checks passed\n'):format(passed, total))
if failed then
  io.write('FAILED\n')
  os.exit(1)
end
io.write('OK\n')
